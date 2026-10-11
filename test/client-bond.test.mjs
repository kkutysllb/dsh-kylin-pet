import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { createBondStore, pairId as hostPairId } from '../src/server/bond.js'

/**
 * 跨 realm 归一化：vm 里产出的数组/对象与字面量**原型不同**，
 * 直接 deepStrictEqual 会误判（V2 的 KINDS 就栽在这条上）。
 */
function canon(value) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, walk(v[k])]))
    }
    return v
  }
  return JSON.stringify(walk(JSON.parse(JSON.stringify(value))))
}

/**
 * 在裸 realm 里跑 client.js：把纯函数与实时状态接口从 __kylinContract 拿出来直接调。
 * IO 可注入 —— 计时器与 fetch 只在 queueBondEvent / flushBondQueue 被调用时才用得上。
 */
function loadClient(io = {}) {
  const src = readFileSync(new URL('../src/stage/client.js', import.meta.url), 'utf8')
  let captured = null
  const win = {
    __ModuleLoader__: {
      load: (mod) => {
        assert.equal(mod.id, 'dsh-kylin-pet')
        captured = mod.factory(() => { throw new Error('client 不该在装载期 require 任何模块') })
      },
    },
  }
  vm.runInNewContext(src, {
    window: win,
    console: console,
    performance: performance,
    setTimeout: io.setTimeout || (() => 0),
    clearTimeout: io.clearTimeout || (() => {}),
    fetch: io.fetch || (() => Promise.reject(new Error('本用例不联网'))),
  })
  assert.ok(captured, 'client.js 必须调用 window.__ModuleLoader__.load')
  return captured
}

const contract = () => loadClient().__kylinContract

test('pairId：对称，且与 host 的 bond.js 逐字一致', () => {
  const c = contract()
  assert.equal(c.pairId('xisha', 'kylinzi'), 'kylinzi|xisha')
  assert.equal(c.pairId('kylinzi', 'xisha'), 'kylinzi|xisha')
  assert.equal(c.pairId('xisha', 'kylinzi'), hostPairId('kylinzi', 'xisha'))
  assert.equal(c.BOND.PAIR_SEP, '|')
})

test('applyBondEvents：本地施加一笔，四个字段全对；空输入不崩', () => {
  const c = contract()
  const ev = { pair: 'kylinzi|xisha', kind: 'bump', affinityDelta: 2, familiarityDelta: 1, at: 1791700000000 }
  const out = c.applyBondEvents({ affinity: 3, familiarity: 4, lastAt: 100, history: [] }, [ev])
  assert.equal(out.affinity, 5)
  assert.equal(out.familiarity, 5)
  assert.equal(out.lastAt, 1791700000000)
  assert.equal(out.history.length, 1)
  assert.equal(canon(out.history[0]), canon({ kind: 'bump', at: 1791700000000, affinityDelta: 2, familiarityDelta: 1 }))
  // 坏输入只降级：永不抛
  assert.equal(canon(c.applyBondEvents(null, null)), canon({ affinity: 0, familiarity: 0, lastAt: 0, history: [] }))
})

test('applyBondEvents：affinity 夹 [-100,100]、familiarity 只增、history 环形 50', () => {
  const c = contract()
  let p = c.applyBondEvents({ affinity: 0, familiarity: 0, lastAt: 0, history: [] }, [{ affinityDelta: 1000, familiarityDelta: 3, at: 1 }])
  assert.equal(p.affinity, 100)
  p = c.applyBondEvents(p, [{ affinityDelta: -1000, familiarityDelta: -5, at: 2 }])
  assert.equal(p.affinity, -100)
  assert.equal(p.familiarity, 3)            // 只增：负增量被丢弃
  const many = []
  for (let i = 0; i < 55; i++) many.push({ kind: 'bump', affinityDelta: 0, familiarityDelta: 1, at: i + 1 })
  const ring = c.applyBondEvents({ affinity: 0, familiarity: 0, lastAt: 0, history: [] }, many)
  assert.equal(ring.history.length, 50)
  assert.equal(ring.history[0].at, 6)       // 最早保留下来的那笔（不是第 1 笔）
  assert.equal(ring.familiarity, 55)
})

test('applyBondEvents 与 host 的 bond.js 同语义（逐字段对照，禁止漂移）', () => {
  const c = contract()
  const dir = mkdtempSync(join(tmpdir(), 'kylin-bond-client-'))
  try {
    const store = createBondStore({ path: join(dir, 'bond.json'), now: () => 0 })
    const events = [
      { pair: 'kylinzi|xisha', kind: 'bump', affinityDelta: 2, familiarityDelta: 1, at: 10 },
      { pair: 'kylinzi|xisha', kind: 'bump', affinityDelta: 1000, familiarityDelta: -5, at: 12 },
      { pair: 'kylinzi|xisha', kind: 'bump', affinityDelta: -2000, familiarityDelta: 4, at: 11 },
    ]
    store.apply(events)
    const mine = c.applyBondEvents({ affinity: 0, familiarity: 0, lastAt: 0, history: [] }, events)
    assert.equal(canon(mine), canon(store.snapshot().pairs['kylinzi|xisha']), '客户端本地施加与 host 漂移了')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tierOf：边界命中档位，解析不出数字一律 null（不猜）', () => {
  const c = contract()
  assert.equal(c.tierOf('100'), '充裕')
  assert.equal(c.tierOf('99.99'), '健康')
  assert.equal(c.tierOf('50'), '健康')
  assert.equal(c.tierOf('20'), '正常')
  assert.equal(c.tierOf('5'), '偏低')
  assert.equal(c.tierOf('1'), '告急')
  assert.equal(c.tierOf('0'), '见底')
  assert.equal(c.tierOf(110), '充裕')
  assert.equal(c.tierOf('abc'), null)
  assert.equal(c.tierOf(''), null)
  assert.equal(c.tierOf('   '), null)
  assert.equal(c.tierOf(null), null)
  assert.equal(c.tierOf(undefined), null)
})

test('balanceCue：kind=ok 时只在档位变化时播（首播 / 换档 / 同档不重复）', () => {
  const c = contract()
  assert.equal(c.balanceCue({ kind: 'ok', total: '110.00', tier: '充裕' }, null), '充裕')
  assert.equal(c.balanceCue({ kind: 'ok', total: '110.00', tier: '充裕' }, '充裕'), null)
  assert.equal(c.balanceCue({ kind: 'ok', total: '60.00', tier: '健康' }, '充裕'), '健康')
})

test('balanceCue：tier=null 或 kind=unavailable 一律不播（绝不伪造数字）', () => {
  const c = contract()
  assert.equal(c.balanceCue({ kind: 'ok', total: 'abc', tier: null }, null), null)
  assert.equal(c.balanceCue({ kind: 'ok', total: '', tier: '' }, null), null)
  assert.equal(c.balanceCue({ kind: 'ok', total: '110.00', tier: null }, '充裕'), null)
  assert.equal(c.balanceCue({ kind: 'unavailable', reason: 'not-configured', detail: 'DEEPSEEK_API_KEY', at: 1 }, null), null)
  assert.equal(c.balanceCue(null, null), null)
})

test('tierClip：档位名精确映射到「余额X」那段素材；没有的档位不播', () => {
  const c = contract()
  assert.equal(canon(c.tierClip('充裕')), canon(['happy', '余额充裕']))
  assert.equal(canon(c.tierClip('见底')), canon(['sad', '余额见底']))
  assert.equal(c.tierClip('未知档'), null)
  assert.equal(c.tierClip(null), null)
})

test('readBond 是实时快照：本地先记，不等 PUT', () => {
  const calls = []
  const client = loadClient({
    fetch: (url, opt) => { calls.push([url, opt]); return Promise.reject(new Error('offline')) },
    setTimeout: () => 0,
  })
  const c = client.__kylinContract
  assert.equal(canon(c.readBond()), canon({ pairKey: '', affinity: 0, familiarity: 0 }))
  c.queueBondEvent({ pair: 'kylinzi|xisha', kind: 'bump', affinityDelta: 2, familiarityDelta: 1, at: 10 })
  assert.equal(canon(c.readBond()), canon({ pairKey: 'kylinzi|xisha', affinity: 2, familiarity: 1 }))
  c.queueBondEvent({ pair: 'kylinzi|xisha', kind: 'bump', affinityDelta: 2, familiarityDelta: 1, at: 11 })
  assert.equal(c.readBond().affinity, 4)   // 立刻生效（好奇概率），不等 host 回执
  assert.equal(calls.length, 0)            // 防抖窗口内一次都没发
})

test('queueBondEvent 防抖 2s：连发合并成一次 PUT；失败保留队列并在下一个窗口重试', async () => {
  const timers = []
  const puts = []
  let fail = true
  const fetchStub = (url, opt) => {
    if (!opt || opt.method !== 'PUT') return Promise.reject(new Error('本用例只该发 PUT：' + url))
    puts.push(JSON.parse(opt.body))
    if (fail) return Promise.reject(new Error('offline'))
    // 橙6：真 host 的回账是「施加后的完整快照」，必含刚落的那一对 —— 桩按真实形状回，
    // 顺带钉住「无条件采纳」不会把刚落的关系抹掉；而 pairs 为空（reset）时它就是归零路径。
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ version: 1, pairs: { 'kylinzi|xisha': { affinity: 6, familiarity: 3, lastAt: 3, history: [] } } }) })
  }
  const client = loadClient({
    fetch: fetchStub,
    setTimeout: (fn, ms) => { timers.push({ fn: fn, ms: ms }); return timers.length },
  })
  const c = client.__kylinContract
  c.queueBondEvent({ pair: 'kylinzi|xisha', kind: 'bump', affinityDelta: 2, familiarityDelta: 1, at: 1 })
  c.queueBondEvent({ pair: 'kylinzi|xisha', kind: 'bump', affinityDelta: 2, familiarityDelta: 1, at: 2 })
  c.queueBondEvent({ pair: 'kylinzi|xisha', kind: 'bump', affinityDelta: 2, familiarityDelta: 1, at: 3 })
  assert.equal(timers.length, 1, '同一个防抖窗口只该有一个计时器')
  assert.equal(timers[0].ms, 2000)
  assert.equal(puts.length, 0, '防抖窗口内不该发 PUT')

  await timers[0].fn()                     // 窗口到点：host 不可达
  assert.equal(puts.length, 1)
  assert.equal(puts[0].events.length, 3, '连发要合并成一批')
  assert.equal(timers.length, 2, '失败后必须排下一次重试')

  fail = false
  await timers[1].fn()
  assert.equal(puts.length, 2)
  assert.equal(puts[1].events.length, 3, '失败不能清空队列：重试要带着原来那三笔')
  assert.equal(c.readBond().affinity, 6)
})
