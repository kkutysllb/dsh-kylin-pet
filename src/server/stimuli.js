/**
 * 把真宿主事件翻译成诱因。
 *
 * 事件名/模式/载荷全部来自运行时自带的机器可读目录
 * (<kcoder-runtime>/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js)，
 * 2026-10-11 在 dsh 0.2.1-alpha.2 上实读：
 *
 *   agent/turn-stopping      serial     { agent, turn, signal }
 *   agent/error              emit       { agent, turn, step, error }
 *   approval/request         waterfall  (req, next) => Promise<ApprovalOutcome>
 *   user-questions/request   waterfall  (request, next) => Promise<AskUserQuestionAnswer>
 *
 * 两条 waterfall 必须原样交棒：我们是旁观者，吞掉 next() 会把审批挂死。
 */

/** [宿主事件名, 诱因 kind] —— 一对一直译的那些。 */
export const DIRECT = Object.freeze([
  ['agent/turn-stopping', 'turn-ok'],
  ['agent/error', 'turn-fail'],
])

/** 需要交棒的等待类事件（waterfall）。 */
export const RELAY = Object.freeze(['approval/request', 'user-questions/request'])

/** 把错误对象压成一行人话，喂给诱因的 detail。 */
export function describeError(err) {
  if (err === undefined || err === null) return 'unknown'
  if (typeof err === 'string') return err.slice(0, 200)
  const name = err.name || (err.constructor && err.constructor.name) || 'Error'
  const msg = err.message === undefined ? String(err) : String(err.message)
  return (name + ': ' + msg).slice(0, 200)
}

/**
 * 装监听。返回幂等 disposer。
 * @param {{on: (name: string, fn: Function) => any}} ctx 只用到 ctx.on —— 测试给个假 ctx 就够
 * @param {ReturnType<import('./state.js').createBoard>} board
 */
export function installStimuli(ctx, board) {
  const disposers = []
  const keep = (d) => { disposers.push(typeof d === 'function' ? d : () => {}) }

  for (const pair of DIRECT) {
    const name = pair[0]
    const kind = pair[1]
    keep(ctx.on(name, (payload) => {
      const detail = kind === 'turn-fail' ? describeError(payload && payload.error) : ''
      try { board.push(kind, detail) } catch (err) { /* 板子出问题不该影响宿主 */ }
    }))
  }

  for (const name of RELAY) {
    keep(ctx.on(name, (_payload, next) => {
      try { board.push('waiting', name) } catch (err) { /* 同上 */ }
      // 旁观者交棒：必须把控制权原样交回，否则审批/提问永远等不到答案。
      return typeof next === 'function' ? next() : undefined
    }))
  }

  let done = false
  return () => {
    if (done) return
    done = true
    for (const d of disposers) { try { d() } catch (err) { /* 卸载失败不该抛 */ } }
  }
}
