import test from 'node:test'
import assert from 'node:assert/strict'
import { installStimuli, describeError, DIRECT, RELAY } from '../src/server/stimuli.js'
import { createBoard } from '../src/server/state.js'

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
  assert.deepEqual(DIRECT.map((p) => p[0]), ['agent/turn-stopping', 'agent/error'])
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
