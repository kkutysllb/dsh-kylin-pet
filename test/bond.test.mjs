import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BOND } from '../src/shared/contract.js'
import { pairId, createBondStore } from '../src/server/bond.js'

/** 临时 home：绝不碰真账本（<dsh家目录>/dsh-kylin-pet/bond.json）。 */
function tmpPath() {
  return join(mkdtempSync(join(tmpdir(), 'kylin-bond-')), 'bond.json')
}

test('pairId 与谁先发起无关，同一对永远同一个键', () => {
  assert.equal(pairId('xisha', 'kylinzi'), 'kylinzi|xisha')
  assert.equal(pairId('kylinzi', 'xisha'), 'kylinzi|xisha')
  assert.equal(pairId('xisha', 'kylinzi'), pairId('kylinzi', 'xisha'))
})

test('全新路径：空账本、零 warning、不凭空建文件', () => {
  const path = tmpPath()
  const store = createBondStore({ path })
  assert.deepEqual(store.snapshot(), { version: 1, pairs: {} })
  assert.deepEqual(store.warnings, [])
  assert.equal(existsSync(path), false)
})

test('apply 一笔 -> affinity/familiarity/lastAt/history 全对，且真的落盘了', () => {
  const path = tmpPath()
  const store = createBondStore({ path })
  const at = 1791700000000
  store.apply([{ pair: pairId('kylinzi', 'xisha'), kind: 'bump', affinityDelta: 2, familiarityDelta: 1, at }])
  const p = store.snapshot().pairs['kylinzi|xisha']
  assert.equal(p.affinity, 2)
  assert.equal(p.familiarity, 1)
  assert.equal(p.lastAt, at)
  assert.deepEqual(p.history, [{ kind: 'bump', at: at, affinityDelta: 2, familiarityDelta: 1 }])
  assert.ok(existsSync(path), 'apply 必须落盘')
  const reread = createBondStore({ path })
  assert.deepEqual(reread.snapshot(), store.snapshot(), '另起一个 store 必须读回同值')
  assert.deepEqual(reread.warnings, [])
})

test('affinity 被夹在 [-100,100]', () => {
  const path = tmpPath()
  const store = createBondStore({ path })
  const pair = 'kylinzi|xisha'
  store.apply([{ pair: pair, affinityDelta: 1000 }])
  assert.equal(store.ledger.pairs[pair].affinity, BOND.AFFINITY_MAX)
  store.apply([{ pair: pair, affinityDelta: -1000 }])
  assert.equal(store.ledger.pairs[pair].affinity, BOND.AFFINITY_MIN)
})

test('familiarity 只增：负增量被丢弃', () => {
  const path = tmpPath()
  const store = createBondStore({ path })
  const pair = 'kylinzi|xisha'
  store.apply([{ pair: pair, familiarityDelta: 5 }])
  assert.equal(store.ledger.pairs[pair].familiarity, 5)
  store.apply([{ pair: pair, familiarityDelta: -5 }])
  assert.equal(store.ledger.pairs[pair].familiarity, 5, '熟悉度只能涨，不能被扣回去')
  assert.equal(store.ledger.pairs[pair].history.length, 2, '被丢弃的增量也要如实记进 history')
  assert.equal(store.ledger.pairs[pair].history[1].familiarityDelta, -5)
})

test('history 环形上限 50，保留最新的那批（不是最早的）', () => {
  const path = tmpPath()
  const store = createBondStore({ path })
  const pair = 'kylinzi|xisha'
  for (let i = 1; i <= 55; i++) store.apply([{ pair: pair, kind: 'bump', affinityDelta: 1, at: i }])
  const h = store.ledger.pairs[pair].history
  assert.equal(h.length, BOND.HISTORY_MAX)
  assert.equal(h[0].at, 6, '第 1..5 笔应被挤掉，最早保留的是第 6 笔')
  assert.notEqual(h[0].at, 1, '环形保留的绝不是第 1 笔')
  assert.equal(h[h.length - 1].at, 55)
})

test('坏文件：不抛、记恰好一条 warning、绝不覆盖原文件', () => {
  const path = tmpPath()
  const garbage = '{ 这不是 json'
  writeFileSync(path, garbage)
  const before = statSync(path).mtimeMs
  const store = createBondStore({ path })
  assert.deepEqual(store.snapshot(), { version: 1, pairs: {} })
  assert.equal(store.warnings.length, 1)
  assert.equal(store.warnings[0].includes('bond.json'), true)
  assert.equal(readFileSync(path, 'utf8'), garbage, '坏文件必须原样留着给人看')
  assert.equal(statSync(path).mtimeMs, before, '只 load 不写：mtime 不动')
})

test('坏文件在第一批写入前被改名留底（bond.json.suspect）', () => {
  const path = tmpPath()
  const garbage = '{ 这也是坏的'
  writeFileSync(path, garbage)
  const store = createBondStore({ path })
  assert.equal(store.warnings.length, 1)
  store.apply([{ pair: pairId('kylinzi', 'xisha'), kind: 'bump', affinityDelta: 1, at: 7 }])
  const suspect = path + '.suspect'
  assert.ok(existsSync(suspect), '写入前必须把坏文件留底，否则「绝不覆盖」等于没有')
  assert.equal(readFileSync(suspect, 'utf8'), garbage, '留底内容 === 原来的坏内容')
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).pairs['kylinzi|xisha'].affinity, 1, '新账已写入')
  assert.equal(existsSync(path + '.tmp'), false, 'tmp 已被 rename 掉，不留半截')
})

test('apply([]) 合法且不落盘', () => {
  const fresh = tmpPath()
  const s1 = createBondStore({ path: fresh })
  assert.deepEqual(s1.apply([]), { version: 1, pairs: {} }, '回当前账')
  assert.equal(existsSync(fresh), false, '空数组不该凭空建文件')

  const path = tmpPath()
  writeFileSync(path, JSON.stringify({ version: 1, pairs: {} }, null, 2))
  const frozen = 1000000000
  utimesSync(path, frozen, frozen)
  const s2 = createBondStore({ path })
  s2.apply([])
  assert.equal(statSync(path).mtimeMs, frozen * 1000, 'mtime 未动 = 没重写文件')
  assert.deepEqual(s2.snapshot(), { version: 1, pairs: {} })
})

test('reset：清空账本**并落盘**（走同一个 flush 路径，不另写一份写文件逻辑）', () => {
  const path = tmpPath()
  const store = createBondStore({ path })
  store.apply([{ pair: 'kylinzi|xisha', kind: 'greet', affinityDelta: 2, familiarityDelta: 1, at: 1 }])
  assert.equal(store.snapshot().pairs['kylinzi|xisha'].affinity, 2)
  assert.ok(existsSync(path), 'apply 之后磁盘上应当有账本')
  const after = store.reset()
  assert.deepEqual(after, { version: 1, pairs: {} })
  assert.equal(Object.keys(store.snapshot().pairs).length, 0, '内存里也清了')
  // 关键：**磁盘也清了** —— 只看内存会漏掉「reset 没落盘」这一类 bug
  assert.equal(Object.keys(JSON.parse(readFileSync(path, 'utf8')).pairs).length, 0, '磁盘文件必须也被清空')
})


// ── v0.1.1 黄11：事件幂等（PUT 重试窗口双记防护）──────────────────────────

test('幂等：同一 id 的事件重放只记一次；不同 id 照常各记各的', () => {
  const path = tmpPath()
  const store = createBondStore({ path })
  const ev = { id: 'evt-1', pair: 'kylinzi|xisha', kind: 'bump', affinityDelta: 2, familiarityDelta: 1, at: 5 }
  store.apply([ev])
  store.apply([ev])                                   // 原样重放
  store.apply([{ id: 'evt-1', pair: 'kylinzi|xisha', kind: 'bump', affinityDelta: 2, familiarityDelta: 1, at: 6 }])  // 内容变了的同 id
  const p = store.snapshot().pairs['kylinzi|xisha']
  assert.equal(p.affinity, 2, '三连发同 id 只该记一笔')
  assert.equal(p.history.length, 1)
  assert.equal(p.lastAt, 5, '被去重的重放不得推进 lastAt')
  store.apply([{ id: 'evt-2', pair: 'kylinzi|xisha', kind: 'bump', affinityDelta: 2, familiarityDelta: 1, at: 7 }])
  assert.equal(store.snapshot().pairs['kylinzi|xisha'].affinity, 4)
})

test('幂等：无 id 的事件不进去重环（老客户端照常落账）', () => {
  const path = tmpPath()
  const store = createBondStore({ path })
  const ev = { pair: 'kylinzi|xisha', kind: 'bump', affinityDelta: 2, familiarityDelta: 1, at: 5 }
  store.apply([ev])
  store.apply([ev])
  assert.equal(store.snapshot().pairs['kylinzi|xisha'].affinity, 4, '没有幂等键就按老行为逐笔落')
})
