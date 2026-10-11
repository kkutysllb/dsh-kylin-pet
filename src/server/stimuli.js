/**
 * 把真宿主事件翻译成诱因。
 *
 * 事件名/模式/载荷全部来自运行时自带的机器可读目录
 * (<kcoder-runtime>/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js)，
 * 2026-10-11 在 dsh 0.2.1-alpha.2 上实读：
 *
 *   agent/turn-stopping      serial     { agent, turn, signal }   —— signal.aborted = 用户中止
 *   agent/error              emit       { agent, turn, step, error }
 *   approval/request         waterfall  (req, next) => Promise<ApprovalOutcome>
 *   user-questions/request   waterfall  (request, next) => Promise<AskUserQuestionAnswer>
 *   agent/status             emit       { agent, status: 'idle' | 'running' }
 *   tools/pre-execute        waterfall  (exec: ToolExecutionInput, next) => ...
 *   api-session/activity     emit       (sessionId, updatedAt) —— **只有用户写的消息才发**
 *   jobs.events.subscribe({owners})     JobEvent: registered/progress/stopping/removed/settled/output
 *
 * 关键事实（catalog :4520 / :7876 / :3928 / :5583 / :5648）：
 *   Agent = { readonly id: SessionId } —— agent.id 就是会话 id；
 *   ToolExecutionInput = { name, arguments(已解析), agent?: Agent, signal }；
 *   JobSettleCause = 'producer' | 'kill' | 'teardown'（producer = 正常完成）。
 *
 * waterfall 必须原样交棒：我们是旁观者，吞掉 next() 会把审批/工具调用挂死。
 *
 * ── v0.1.1 会话跟随（F1）────────────────────────────────────────────────
 * 「当前会话」= 最近一条被用户写消息的会话（api-session/activity 的语义就是
 * 「One user-authored durable message advanced Session list activity」，
 * 子代理与定时任务永远不会发它）。跟随的兼容口径：
 *   · focusId === null（本进程还没见过任何用户消息）⇒ 不过滤，行为与 v0.1.0 一致；
 *   · 第一条用户消息落地后 ⇒ 只有来源会话 === focusId 的诱因才上板，
 *     子代理 / 后台会话的忙碌与收工从此不再惊动桌宠。
 * 审批/提问 relay 例外：载荷里认不出会话就放行 —— 等待是用户必须看见的面，
 * 因为过滤而漏报「在呢」比多报一次更糟。
 */

import { classifyTool } from '../shared/contract.js'

/** 换类的最小间隔：防「读-写-读-写」把气泡刷成跑马灯。 */
export const CLASS_COOLDOWN_MS = 3000

/** [宿主事件名, 诱因 kind] —— 一对一直译的那些。（turn-stopping 因 aborted 判别单独装，见下） */
export const DIRECT = Object.freeze([['agent/error', 'turn-fail']])

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
 * @param {{on: (name: string, fn: Function) => any, get?: (name: string) => unknown}} ctx
 *   只用到 ctx.on；ctx.get 用于探测 jobs 服务（可选，缺席即不跟后台任务）。
 * @param {ReturnType<import('./state.js').createBoard>} board
 */
export function installStimuli(ctx, board, opts = {}) {
  const disposers = []
  const keep = (d) => { disposers.push(typeof d === 'function' ? d : () => {}) }
  const now = typeof opts.now === 'function' ? opts.now : Date.now

  // ── 会话跟随（F1）─────────────────────────────────────────────────────
  let focusId = null

  /** 这条来源会话的诱因当前该不该上板（见模块头的兼容口径）。 */
  function admits(sid) {
    if (focusId === null) return true
    return (sid === undefined || sid === null ? '' : String(sid)) === focusId
  }

  /** 过滤 + 上板。focus 没立起来时一律放行；立起来后只认当前会话。 */
  function emit(kind, detail, sid, opts2) {
    if (!admits(sid)) {
      const blank = sid === undefined || sid === null || sid === ''
      if (!(opts2 && opts2.passUnknown && blank)) return
    }
    board.push(kind, detail, sid)
  }

  keep(ctx.on('api-session/activity', (sessionId) => {
    // 签名 (sessionId, updatedAt)。非字符串/空串不认 —— 不猜。
    try { if (typeof sessionId === 'string' && sessionId !== '') focusId = sessionId } catch (err) { /* 跟随失败不该影响宿主 */ }
  }))

  // ── 回合边界 ──────────────────────────────────────────────────────────
  keep(ctx.on('agent/turn-stopping', (payload) => {
    try {
      // 黄12：signal.aborted = 用户主动中止 —— 那不是「稳了」，静默。
      const sig = payload && payload.signal
      if (sig && typeof sig === 'object' && sig.aborted === true) return
      emit('turn-ok', '', payload && payload.agent && payload.agent.id)
    } catch (err) { /* 板子出问题不该影响宿主 */ }
  }))

  for (const pair of DIRECT) {
    const name = pair[0]
    const kind = pair[1]
    keep(ctx.on(name, (payload) => {
      const detail = kind === 'turn-fail' ? describeError(payload && payload.error) : ''
      try { emit(kind, detail, payload && payload.agent && payload.agent.id) } catch (err) { /* 板子出问题不该影响宿主 */ }
    }))
  }

  for (const name of RELAY) {
    keep(ctx.on(name, (payload, next) => {
      try {
        // 审批/提问的 req 若带得出 agent 就按会话过滤；认不出（老形状/无 agent）就放行 ——
        // 「在呢」必须让用户看见，这是 passUnknown 的唯一用途。
        emit('waiting', name, payload && payload.agent && payload.agent.id, { passUnknown: true })
      } catch (err) { /* 同上 */ }
      // 旁观者交棒：必须把控制权原样交回，否则审批/提问永远等不到答案。
      return typeof next === 'function' ? next() : undefined
    }))
  }

  // ── 执行期的「在忙」面（V5）─────────────────────────────────────────
  // 合并逻辑**刻意放 host 侧**：① tools/pre-execute 每次工具调用都触发，不设门会把
  // /state 刷爆；② 合并要知道「上一次是什么类」，这在 host 侧是天然的一段闭包状态。
  let lastClass = null
  let lastAt = 0

  // ── 任务跟随（F2）：待办清单 ─────────────────────────────────────────
  // todo_write 的参数是**已解析**的（ToolExecutionInput.arguments），签名全量比对：
  // 同一批待办重复提交（模型常见的「确认式重写」）不得刷屏。
  let todoTrack = null   // { sid, sig, done, total }

  function trackTodos(sid, args) {
    const list = args && Array.isArray(args.todos) ? args.todos : null
    if (!list) return
    const items = []
    for (const t of list) items.push({ c: String((t && t.content) || ''), s: String((t && t.status) || '') })
    const sig = JSON.stringify(items)
    const done = items.reduce((n, it) => n + (it.s === 'completed' ? 1 : 0), 0)
    const total = items.length
    const prev = todoTrack !== null && todoTrack.sid === sid ? todoTrack : null
    if (prev !== null && prev.sig === sig) return
    todoTrack = { sid: sid, sig: sig, done: done, total: total }
    const label = done + '/' + total
    if (prev === null) { emit(total > 0 && done === total ? 'task-done' : 'task-start', label, sid); return }
    if (total > 0 && done === total) { emit('task-done', label, sid); return }
    if (done !== prev.done || total !== prev.total) emit(done > prev.done ? 'task-progress' : 'task-start', label, sid)
  }

  // 总开关：回合进 running 报「在忙」，回 idle 报「收工」。
  keep(ctx.on('agent/status', (payload) => {
    const status = payload && payload.status
    const sid = payload && payload.agent && payload.agent.id
    try {
      if (status === 'running') {
        if (!admits(sid)) return
        // detail 取**上一回合已知的类别**；一次都没见过就说 other（「在忙」）。
        // 并把地板清零：新回合的第一件事值得立刻说，不该被残留计时挡住。
        lastAt = 0
        board.push('working', lastClass || 'other', sid)
      } else if (status === 'idle') {
        emit('working-done', '', sid)
      }
    } catch (err) { /* 板子出问题不该影响宿主 */ }
  }))

  // 正在调哪类工具 + 待办边界。**这是 waterfall，必须原样交棒**。
  keep(ctx.on('tools/pre-execute', (exec, next) => {
    try {
      if (exec && exec.name === 'todo_write') {
        // 待办边界自己就是更有信息量的通报（接活了/3/7/收工），
        // 同一拍不再补一条「在忙着」，否则一次提交出两条气泡。
        try { trackTodos(exec.agent && exec.agent.id, exec.arguments) } catch (err) { /* 待办失败不影响工具 */ }
        return typeof next === 'function' ? next() : undefined
      }
      const sid = exec && exec.agent && exec.agent.id
      if (admits(sid)) {
        const cls = classifyTool(exec && exec.name)
        const at = now()
        // 只在**类别真的变了**、**且过了地板**时才吭声。被挡下时不更新 lastClass。
        // lastAt === 0 = 「还没有过上一次」⇒ 永远允许（生产 Date.now 十位数成立，
        // 测试的小时钟里也成立 —— 不靠 at-0 恰好很大）。
        if (cls !== lastClass && (lastAt === 0 || at - lastAt >= CLASS_COOLDOWN_MS)) {
          lastClass = cls
          lastAt = at
          board.push('working', cls, sid)
        }
      }
    } catch (err) { /* 热路径：绝不在这里抛，也绝不 await/IO */ }
    return typeof next === 'function' ? next() : undefined
  }))

  // ── 任务跟随（F2）：后台任务 ─────────────────────────────────────────
  // ctx.get 探测（与 commands 同款优雅降级，绝不进 inject）：服务在就订阅，不在就只跟待办。
  // 只认有主的任务；无主任务（owner 空）是部署级杂音，不属于「当前会话的任务」。
  try {
    const jobsSvc = typeof ctx.get === 'function' ? ctx.get('jobs') : undefined
    if (jobsSvc && jobsSvc.events && typeof jobsSvc.events.subscribe === 'function') {
      const off = jobsSvc.events.subscribe({ owners: 'all' }, (ev) => {
        try {
          if (!ev || !ev.job) return
          if (ev.type !== 'registered' && ev.type !== 'settled') return   // progress/stopping/output 是刷屏源
          const owner = ev.job.owner === undefined || ev.job.owner === null ? '' : String(ev.job.owner)
          if (owner === '') return
          const label = String(ev.job.label || '后台任务')
          if (ev.type === 'registered') emit('task-start', label, owner)
          else emit('task-done', ev.cause && ev.cause !== 'producer' ? label + '·' + String(ev.cause) : label, owner)
        } catch (err) { /* 任务事件绝不影响宿主 */ }
      })
      keep(off)
    }
  } catch (err) { /* jobs 服务探测失败：只跟待办，不跟后台任务 */ }

  let done = false
  return () => {
    if (done) return
    done = true
    for (const d of disposers) { try { d() } catch (err) { /* 卸载失败不该抛 */ } }
  }
}
