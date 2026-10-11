import test from 'node:test'
import assert from 'node:assert/strict'
import { createBoard, CAPACITY } from '../src/server/state.js'

test('push 返回递增 seq，cursor 跟着走', () => {
  const b = createBoard()
  assert.equal(b.cursor, 0)
  assert.equal(b.push('turn-ok', ''), 1)
  assert.equal(b.push('turn-fail', ''), 2)
  assert.equal(b.push('waiting', ''), 3)
  assert.equal(b.cursor, 3)
  assert.deepEqual(b.all.map((s) => s.seq), [1, 2, 3])
})

test('since 只给严格大于水位的（边界 since === seq 不给）', () => {
  const b = createBoard()
  b.push('turn-ok', 'a')
  b.push('turn-fail', 'b')
  assert.deepEqual(b.since(0).map((s) => s.seq), [1, 2])
  assert.deepEqual(b.since(1).map((s) => s.seq), [2])
  assert.deepEqual(b.since(2), [])
})

test('起步查询：undefined / 空串 / 非数字 / 负数 一律空数组', () => {
  const b = createBoard()
  b.push('turn-ok', '')
  b.push('turn-ok', '')
  for (const v of [undefined, '', 'abc', -1]) {
    assert.deepEqual(b.since(v), [], '起步查询 ' + JSON.stringify(v) + ' 必须不给历史')
  }
  assert.equal(b.cursor, 2, '起步查询只是不给历史，水位照旧')
})

test('容量：只留最新 CAPACITY 条，最旧的被挤掉', () => {
  const b = createBoard()
  for (let i = 0; i < CAPACITY + 5; i++) b.push('turn-ok', '')
  assert.equal(b.all.length, CAPACITY)
  assert.equal(b.all[0].seq, 6)
  assert.equal(b.all[b.all.length - 1].seq, CAPACITY + 5)
  assert.equal(b.cursor, CAPACITY + 5)
})

test('未知 kind 抛错（静默丢弃会让「宠没反应」变悬案）', () => {
  const b = createBoard()
  assert.throws(() => b.push('turn-hmm', ''), /unknown stimulus kind: turn-hmm/)
  assert.equal(b.cursor, 0, '抛错不得推进水位')
})

test('detail 被字符串化、缺省为空串', () => {
  const b = createBoard()
  b.push('turn-ok')
  b.push('turn-fail', 42)
  b.push('waiting', { a: 1 })
  assert.equal(b.all[0].detail, '')
  assert.equal(b.all[1].detail, '42')
  assert.equal(b.all[2].detail, '[object Object]')
})

test('at 走注入时钟', () => {
  const b = createBoard({ now: () => 42 })
  b.push('turn-ok', '')
  assert.equal(b.all[0].at, 42)
})
