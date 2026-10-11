import test from 'node:test'
import assert from 'node:assert/strict'
import { installStimuli, describeError, DIRECT, RELAY, CLASS_COOLDOWN_MS } from '../src/server/stimuli.js'
import { createBoard } from '../src/server/state.js'
import { classifyTool } from '../src/shared/contract.js'

// 假 ctx：记录每个事件的监听器，并能按事件名派发
function fakeCtx() {
  const map = new Map()
  return {
    on(name, fn) {
      const list = map.get(name) || []
      list.push(fn)
      map.set(name, list)
      return () => {}
    },
    emit(name, payload, next) {
      const fns = map.get(name) || []
      return fns.length ? fns[0](payload, next) : undefined
    },
    listeners: (name) => (map.get(name) || []).length,
  }
}
// 上面这块是计划原文里的假 ctx（逐字保留）。注意它的 on() 返回的是空 disposer —— 只记不摘，
// 所以它能验「派发与计数」，验不了「卸载后不再产诱因」。真 ctx 的 on() 返回摘除器，故另给一块：
function removableCtx() {
  const map = new Map()
  return {
    on(name, fn) {
      const list = map.get(name) || []
      list.push(fn)
      map.set(name, list)
      return () => { map.set(name, (map.get(name) || []).filter((f) => f !== fn)) }
    },
    emit(name, payload, next) {
      const fns = map.get(name) || []
      return fns.length ? fns[0](payload, next) : undefined
    },
    listeners: (name) => (map.get(name) || []).length,
  }
}

test('agent/turn-stopping -> turn-ok，detail 为空串', () => {
  // v0.1.1：turn-stopping 因 aborted 判别单独装监听，DIRECT 只剩 agent/error 一对一。
  assert.deepEqual(DIRECT.map((p) => p[0]), ['agent/error'])
  assert.deepEqual(RELAY, ['approval/request', 'user-questions/request'])
  const ctx = fakeCtx()
  const board = createBoard({ now: () => 7 })
  installStimuli(ctx, board)
  ctx.emit('agent/turn-stopping', { agent: {}, turn: 3, signal: null }, () => {})
  assert.equal(board.all.length, 1)
  assert.equal(board.all[0].kind, 'turn-ok')
  assert.equal(board.all[0].detail, '')
  assert.equal(board.all[0].at, 7)
})

test('黄12：用户中止的回合（signal.aborted）不记 turn-ok', () => {
  const ctx = fakeCtx()
  const board = createBoard()
  installStimuli(ctx, board)
  ctx.emit('agent/turn-stopping', { agent: {}, turn: 3, signal: { aborted: true } }, () => {})
  ctx.emit('agent/turn-stopping', { agent: {}, turn: 4, signal: { aborted: false } }, () => {})
  assert.equal(board.all.length, 1, '中止的静默，正常收工的照记')
  assert.equal(board.all[0].kind, 'turn-ok')
})

test('agent/error -> turn-fail，detail 含错误名与消息', () => {
  assert.equal(describeError(undefined), 'unknown')
  assert.equal(describeError(null), 'unknown')
  assert.equal(describeError('plain text'), 'plain text')
  const ctx = fakeCtx()
  const board = createBoard()
  installStimuli(ctx, board)
  ctx.emit('agent/error', { agent: {}, turn: 3, step: 1, error: new Error('boom') })
  assert.equal(board.all.length, 1)
  assert.equal(board.all[0].kind, 'turn-fail')
  assert.ok(board.all[0].detail.includes('Error'), board.all[0].detail)
  assert.ok(board.all[0].detail.includes('boom'), board.all[0].detail)
})

test('approval/request -> waiting，且 next 被调用恰好一次', () => {
  const ctx = fakeCtx()
  const board = createBoard()
  installStimuli(ctx, board)
  let calls = 0
  const out = ctx.emit('approval/request', { id: 'a1' }, () => { calls += 1; return 'approved' })
  assert.equal(calls, 1, 'waterfall 旁观者必须原样交棒：next 恰好一次')
  assert.equal(out, 'approved', 'next 的返回值必须原样透出')
  assert.equal(board.all.length, 1)
  assert.equal(board.all[0].kind, 'waiting')
  assert.equal(board.all[0].detail, 'approval/request')
})

test('user-questions/request -> waiting，且 next 被调用恰好一次', () => {
  const ctx = fakeCtx()
  const board = createBoard()
  installStimuli(ctx, board)
  let calls = 0
  const out = ctx.emit('user-questions/request', { questions: [] }, () => { calls += 1; return { answers: [] } })
  assert.equal(calls, 1, 'waterfall 旁观者必须原样交棒：next 恰好一次')
  assert.deepEqual(out, { answers: [] })
  assert.equal(board.all.length, 1)
  assert.equal(board.all[0].kind, 'waiting')
  assert.equal(board.all[0].detail, 'user-questions/request')
})

test('disposer 幂等：重复卸载不抛', () => {
  const ctx = fakeCtx()
  const board = createBoard()
  const uninstall = installStimuli(ctx, board)
  assert.equal(typeof uninstall, 'function')
  uninstall()
  assert.doesNotThrow(() => uninstall())
  assert.doesNotThrow(() => uninstall())
})

test('卸载后不再产诱因', () => {
  const ctx = removableCtx()
  const board = createBoard()
  const uninstall = installStimuli(ctx, board)
  ctx.emit('agent/turn-stopping', {}, () => {})
  assert.equal(board.all.length, 1)
  assert.equal(ctx.listeners('agent/turn-stopping'), 1)
  uninstall()
  assert.equal(ctx.listeners('agent/turn-stopping'), 0)
  ctx.emit('agent/turn-stopping', {}, () => {})
  ctx.emit('agent/error', { error: new Error('after uninstall') })
  ctx.emit('approval/request', {}, () => {})
  assert.equal(board.all.length, 1, '卸载后监听器必须已摘除')
})

test('板子抛错不影响事件处理（宿主优先）', () => {
  const ctx = fakeCtx()
  const bad = { push() { throw new Error('board down') }, since() { return [] }, cursor: 0, all: [] }
  installStimuli(ctx, bad)
  assert.doesNotThrow(() => ctx.emit('agent/turn-stopping', {}, () => {}))
  assert.doesNotThrow(() => ctx.emit('agent/error', { error: new Error('x') }))
  let calls = 0
  assert.doesNotThrow(() => ctx.emit('approval/request', {}, () => { calls += 1 }))
  assert.equal(calls, 1, '板子坏掉也必须交棒')
})

// ── V5：执行期的「在忙」面（A1–A7）─────────────────────────────────────
// 时钟：地板冷却必须能被控制，否则只能靠 sleep —— 那既慢又抖。
function clock(t0 = 1000) {
  let t = t0
  return { now: () => t, advance: (ms) => { t += ms } }
}

test('A1/A2 agent/status：running 出 working，idle 出 working-done', () => {
  const ctx = fakeCtx()
  const c = clock()
  const board = createBoard({ now: c.now })
  installStimuli(ctx, board, { now: c.now })
  ctx.emit('agent/status', { agent: {}, status: 'running' })
  assert.equal(board.all.length, 1)
  assert.equal(board.all[0].kind, 'working')
  assert.equal(board.all[0].detail, 'other', '一次工具都没见过时只说「在忙」，不猜类别')
  ctx.emit('agent/status', { agent: {}, status: 'idle' })
  assert.equal(board.all.length, 2)
  assert.equal(board.all[1].kind, 'working-done')
  assert.equal(board.all[1].detail, '')
  // 其它 status（未来宿主加了新值）一律不产诱因 —— 不认识的词不当信号用。
  ctx.emit('agent/status', { agent: {}, status: 'paused' })
  assert.equal(board.all.length, 2)
})

test('A3 同类连续工具调用只出一条（合并真的生效）', () => {
  const ctx = fakeCtx()
  const c = clock()
  const board = createBoard({ now: c.now })
  installStimuli(ctx, board, { now: c.now })
  for (let i = 0; i < 5; i++) {
    c.advance(10)
    ctx.emit('tools/pre-execute', { name: 'Read' }, () => 'next')
  }
  assert.equal(board.all.length, 1, '5 个 Read 只该出一条，实际 ' + JSON.stringify(board.all.map((b) => b.detail)))
  assert.equal(board.all[0].kind, 'working')
  assert.equal(board.all[0].detail, 'read')
})

test('A4 换类产出新的一条，detail 依次', () => {
  const ctx = fakeCtx()
  const c = clock()
  const board = createBoard({ now: c.now })
  installStimuli(ctx, board, { now: c.now })
  ctx.emit('tools/pre-execute', { name: 'Read' }, () => 'next')
  c.advance(5000)
  ctx.emit('tools/pre-execute', { name: 'Bash' }, () => 'next')
  assert.deepEqual(board.all.map((b) => b.detail), ['read', 'exec'])
})

test('A5 地板冷却：换类但间隔 < 3s ⇒ 不产出；且被挡后同类再来仍算「换类」', () => {
  const ctx = fakeCtx()
  const c = clock()
  const board = createBoard({ now: c.now })
  installStimuli(ctx, board, { now: c.now })
  ctx.emit('tools/pre-execute', { name: 'Read' }, () => 'next')
  assert.equal(board.all.length, 1)
  c.advance(CLASS_COOLDOWN_MS - 1)
  ctx.emit('tools/pre-execute', { name: 'Bash' }, () => 'next')
  assert.equal(board.all.length, 1, '间隔 < 3s 的换类不许产出')
  // 关键：被挡下**不该更新 lastClass** —— 否则 'exec' 会被永久吞掉。
  c.advance(2)
  ctx.emit('tools/pre-execute', { name: 'Bash' }, () => 'next')
  assert.equal(board.all.length, 2, '过了地板之后，同一个换类必须补上')
  assert.equal(board.all[1].detail, 'exec')
})

test('A6 tools/pre-execute 必须原样交棒（waterfall，吞掉会把工具调用挂死）', () => {
  const ctx = fakeCtx()
  const c = clock()
  const board = createBoard({ now: c.now })
  installStimuli(ctx, board, { now: c.now })
  let calls = 0
  const out = ctx.emit('tools/pre-execute', { name: 'Read' }, () => { calls += 1; return 'next' })
  assert.equal(calls, 1, 'next 必须被调用**恰好一次**')
  assert.equal(out, 'next', 'next 的返回值必须原样传回去')
  // 没有 next 时不能抛（假 ctx / 非 waterfall 调用面）
  assert.doesNotThrow(() => ctx.emit('tools/pre-execute', { name: 'Read' }))
})

test('A7 未知工具落 other，不猜', () => {
  const ctx = fakeCtx()
  const c = clock()
  const board = createBoard({ now: c.now })
  installStimuli(ctx, board, { now: c.now })
  ctx.emit('tools/pre-execute', { name: 'TotallyNewTool' }, () => 'next')
  assert.equal(board.all.length, 1)
  assert.equal(board.all[0].detail, 'other')
})

test('classifyTool：分类表逐项正确；未知/空/非字符串一律 other', () => {
  assert.equal(classifyTool('Read'), 'read')
  assert.equal(classifyTool('Grep'), 'read')
  assert.equal(classifyTool('Edit'), 'write')
  assert.equal(classifyTool('Bash'), 'exec')
  assert.equal(classifyTool('WebSearch'), 'web')
  assert.equal(classifyTool('web_fetch'), 'web')
  assert.equal(classifyTool('Task'), 'agent')
  for (const bad of ['TotallyNewTool', '', undefined, null, 42, {}, []]) {
    assert.equal(classifyTool(bad), 'other', JSON.stringify(bad) + ' 应当落 other')
  }
})


// ── v0.1.1 F1：会话跟随 ──────────────────────────────────────────────────

test('F1 首条用户消息前不过滤（兼容口径），activity 立起 focus 后只认当前会话', () => {
  const ctx = fakeCtx()
  const board = createBoard()
  installStimuli(ctx, board)
  // focus 未立：谁的动作都上板（v0.1.0 行为）
  ctx.emit('agent/status', { agent: { id: 'sessionA' }, status: 'running' })
  assert.equal(board.all.length, 1)
  // 立起 focus = sessionA
  ctx.emit('api-session/activity', 'sessionA', 1)
  ctx.emit('agent/status', { agent: { id: 'sessionB' }, status: 'running' })
  assert.equal(board.all.length, 1, '别的会话开跑不得惊动桌宠')
  ctx.emit('agent/status', { agent: { id: 'sessionA' }, status: 'running' })
  assert.equal(board.all.length, 2, '当前会话开跑照常上板')
  ctx.emit('agent/turn-stopping', { agent: { id: 'sessionB' }, turn: 1, signal: null }, () => {})
  assert.equal(board.all.length, 2, '别的会话收工也不是「稳了」')
  ctx.emit('agent/turn-stopping', { agent: { id: 'sessionA' }, turn: 1, signal: null }, () => {})
  assert.equal(board.all.length, 3)
})

test('F1 focus 立起后：无主来源被过滤；审批/提问 relay 认不出会话时放行', () => {
  const ctx = fakeCtx()
  const board = createBoard()
  installStimuli(ctx, board)
  ctx.emit('api-session/activity', 'sessionA', 1)
  ctx.emit('tools/pre-execute', { name: 'Read' }, () => 'next')
  assert.equal(board.all.length, 0, '认不出会话的「在忙」不上板')
  let calls = 0
  ctx.emit('approval/request', { id: 'x' }, () => { calls += 1; return 'ok' })
  assert.equal(calls, 1, 'waterfall 必须照常交棒')
  assert.equal(board.all.length, 1, '认不出会话的审批要放行（用户必须看见「在呢」）')
  assert.equal(board.all[0].kind, 'waiting')
  // 带得出会话的 relay 照过滤
  ctx.emit('approval/request', { agent: { id: 'sessionB' } }, () => 'ok')
  assert.equal(board.all.length, 1, '别的会话的审批不上板')
  ctx.emit('approval/request', { agent: { id: 'sessionA' } }, () => 'ok')
  assert.equal(board.all.length, 2, '当前会话的审批上板')
})

test('F1 上板诱因带 session 字段（留证）', () => {
  const ctx = fakeCtx()
  const board = createBoard()
  installStimuli(ctx, board)
  ctx.emit('api-session/activity', 's1', 1)
  ctx.emit('agent/status', { agent: { id: 's1' }, status: 'running' })
  assert.equal(board.all[0].session, 's1')
})

test('F2 todo_write：首见 task-start、进度 task-progress、全完成 task-done、重复签名不上板', () => {
  const ctx = fakeCtx()
  const board = createBoard()
  installStimuli(ctx, board)
  const todos = (statuses) => ({ agent: { id: 's1' }, name: 'todo_write', arguments: { todos: statuses.map((s, i) => ({ content: 't' + i, status: s })) } })
  ctx.emit('tools/pre-execute', todos(['in_progress', 'pending']), () => 'next')
  assert.deepEqual(board.all.map((b) => [b.kind, b.detail]), [['task-start', '0/2']])
  ctx.emit('tools/pre-execute', todos(['in_progress', 'pending']), () => 'next')
  assert.equal(board.all.length, 1, '签名没变不得刷屏')
  ctx.emit('tools/pre-execute', todos(['completed', 'in_progress']), () => 'next')
  assert.deepEqual(board.all[1].detail, '1/2')
  assert.equal(board.all[1].kind, 'task-progress')
  ctx.emit('tools/pre-execute', todos(['completed', 'completed']), () => 'next')
  assert.equal(board.all[2].kind, 'task-done')
  assert.equal(board.all[2].detail, '2/2')
})

test('F2 换会话的待办清单重新起手；别的会话的待办被 focus 过滤', () => {
  const ctx = fakeCtx()
  const board = createBoard()
  installStimuli(ctx, board)
  const ev = (sid) => ({ agent: { id: sid }, name: 'todo_write', arguments: { todos: [{ content: 'a', status: 'completed' }] } })
  ctx.emit('tools/pre-execute', ev('s1'), () => 'next')
  assert.equal(board.all[0].kind, 'task-done', '首见即全完成 → task-done')
  ctx.emit('tools/pre-execute', ev('s2'), () => 'next')
  // 换会话 = 首见：清单首见即全完成，如实的通报就是「收工」——它没在开工，别硬说接活。
  assert.equal(board.all[1].kind, 'task-done', '换会话首见即全完成 → task-done')
  ctx.emit('api-session/activity', 's1', 1)
  ctx.emit('tools/pre-execute', ev('s2'), () => 'next')
  assert.equal(board.all.length, 2, '非当前会话的待办不上板')
})

test('F2 后台任务：registered/settled 上板、无主跳过、kill 带后缀', () => {
  let listener = null
  const jobs = { events: { subscribe: (_f, fn) => { listener = fn; return () => {} } } }
  const ctx = fakeCtx()
  ctx.get = (name) => (name === 'jobs' ? jobs : undefined)
  const board = createBoard()
  installStimuli(ctx, board)
  listener({ type: 'progress', job: { label: 'x', owner: 's1' } })
  assert.equal(board.all.length, 0, 'progress/stopping/output 是刷屏源')
  listener({ type: 'registered', job: { label: '编译', owner: 's1' } })
  assert.deepEqual(board.all.map((b) => [b.kind, b.detail, b.session]), [['task-start', '编译', 's1']])
  listener({ type: 'settled', job: { label: '编译', owner: 's1' }, cause: 'producer', awaited: true })
  assert.equal(board.all[1].kind, 'task-done')
  assert.equal(board.all[1].detail, '编译', '正常完成不带后缀')
  listener({ type: 'registered', job: { label: '下载', owner: undefined } })
  assert.equal(board.all.length, 2, '无主任务是部署级杂音，不上板')
  listener({ type: 'settled', job: { label: '下载', owner: 's1' }, cause: 'kill' })
  assert.equal(board.all[2].detail, '下载·kill')
})

test('F2 没有 jobs 服务时优雅降级（ctx.get 缺席也不抛）', () => {
  const ctx = fakeCtx()
  const board = createBoard()
  assert.doesNotThrow(() => installStimuli(ctx, board))
  ctx.get = () => undefined
  assert.doesNotThrow(() => installStimuli(ctx, board))
})
