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
 *   agent/status             emit       { agent, status: 'idle' | 'running' }
 *   tools/pre-execute        waterfall  (exec, next) => ...
 *
 * waterfall 必须原样交棒：我们是旁观者，吞掉 next() 会把审批挂死。
 */

import { classifyTool } from '../shared/contract.js'

/** 换类的最小间隔：防「读-写-读-写」把气泡刷成跑马灯。 */
export const CLASS_COOLDOWN_MS = 3000

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
export function installStimuli(ctx, board, opts = {}) {
  const disposers = []
  const keep = (d) => { disposers.push(typeof d === 'function' ? d : () => {}) }
  const now = typeof opts.now === 'function' ? opts.now : Date.now

  // ── 执行期的「在忙」面（V5）─────────────────────────────────────────
  // 合并逻辑**刻意放 host 侧**：① `tools/pre-execute` 每次工具调用都触发，不设门会把
  // `/state` 刷爆；② 合并要知道「上一次是什么类」，这在 host 侧是天然的一段闭包状态，
  // 放 client 侧就得跨请求重建。
  let lastClass = null
  let lastAt = 0

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

  // 总开关：回合进 running 报「在忙」，回 idle 报「收工」。
  keep(ctx.on('agent/status', (payload) => {
    const status = payload && payload.status
    try {
      if (status === 'running') {
        // detail 取**上一回合已知的类别**；一次都没见过就说 other（「在忙」）。
        // 并把地板清零：**新回合的第一件事值得立刻说**，不该被上一回合的残留计时挡住。
        lastAt = 0
        board.push('working', lastClass || 'other')
      } else if (status === 'idle') {
        board.push('working-done', '')
      }
    } catch (err) { /* 板子出问题不该影响宿主 */ }
  }))

  // 正在调哪类工具。**这是 waterfall，必须原样交棒** —— 我们是旁观者，
  // 吞掉 next() 会把工具调用挂死（与 approval/request 同一类错误，A6 钉住它）。
  keep(ctx.on('tools/pre-execute', (exec, next) => {
    try {
      const cls = classifyTool(exec && exec.name)
      const at = now()
      // 只在**类别真的变了**、**且过了地板**时才吭声。
      // 被地板挡下时**不更新 lastClass** —— 这样之后同类再来仍算「换类」，不会被永久吞掉。
      // `lastAt === 0` = 「还没有过上一次」⇒ **永远允许**。
      // 不靠 `at - 0` 恰好很大：那在生产里成立（Date.now 十位数），在测试的小时钟里不成立，
      // 会让「第一次就被地板挡住」这种假红/假绿出现。
      if (cls !== lastClass && (lastAt === 0 || at - lastAt >= CLASS_COOLDOWN_MS)) {
        lastClass = cls
        lastAt = at
        board.push('working', cls)
      }
    } catch (err) { /* 热路径：绝不在这里抛，也绝不 await/IO */ }
    return typeof next === 'function' ? next() : undefined
  }))

  let done = false
  return () => {
    if (done) return
    done = true
    for (const d of disposers) { try { d() } catch (err) { /* 卸载失败不该抛 */ } }
  }
}
