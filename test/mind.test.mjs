import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/** JSON 归一化 + 键排序：跨 realm 对象不能直接 deepStrictEqual。 */
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

/** 在裸 realm 里跑 client.js：只提供 window.__ModuleLoader__，不碰 DOM。 */
function loadContract() {
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
  vm.runInNewContext(src, { window: win, console: console, performance: performance })
  assert.ok(captured, 'client.js 必须调用 window.__ModuleLoader__.load')
  assert.ok(captured.__kylinContract, 'client 必须暴露 __kylinContract')
  return captured.__kylinContract
}

const C = loadContract()
const SOCIAL = Array.from(C.INTENTS.social)

test('stepMind：高位衰减、低位转恢复、夹在 [0,1]', () => {
  const m = C.createMind('kylinzi')
  assert.equal(m.energy, 1)
  C.stepMind(m, 1)
  assert.ok(Math.abs(m.energy - (1 - C.TUNING.ENERGY_DRAIN)) < 1e-12, '高位应继续衰减')
  m.energy = 0.1
  C.stepMind(m, 1)
  assert.ok(Math.abs(m.energy - (0.1 + C.TUNING.ENERGY_RECOVER)) < 1e-12, '≤0.15 应转为恢复')
  m.energy = 0
  C.stepMind(m, 1)
  assert.ok(m.energy > 0, '0 也走恢复分支')
  m.energy = 1
  C.stepMind(m, 100)
  assert.ok(m.energy >= 0 && m.energy <= 1, 'energy 必须夹在 [0,1]')
})

test('stepMind：mood 向 0 回归且不越过 0', () => {
  const m = C.createMind('kylinzi')
  m.mood = 0.5
  C.stepMind(m, 10)
  assert.ok(Math.abs(m.mood - 0.4) < 1e-12)
  m.mood = 0.05
  C.stepMind(m, 10)
  assert.equal(m.mood, 0)
  m.mood = -0.5
  C.stepMind(m, 10)
  assert.ok(Math.abs(m.mood + 0.4) < 1e-12)
  m.mood = -0.05
  C.stepMind(m, 10)
  assert.equal(m.mood, 0)
})

test('stepMind：冷却递减，归零即删除（不留 0）', () => {
  const m = C.createMind('kylinzi')
  m.cooldown = { greet: 2, gift: 0.5 }
  C.stepMind(m, 1)
  assert.ok(Math.abs(m.cooldown.greet - 1) < 1e-12)
  assert.ok(!('gift' in m.cooldown), '归零的冷却必须被删除，而不是留一个 0')
  C.stepMind(m, 5)
  assert.ok(!('greet' in m.cooldown))
  assert.deepEqual(Object.keys(m.cooldown), [])
})

test('unlocked：spec §7 的解锁边界，无条件的候选恒可用', () => {
  const mk = (affinity, familiarity) => ({ affinity, familiarity })
  assert.equal(C.unlocked('gift', mk(0, 2)), false)
  assert.equal(C.unlocked('gift', mk(0, 3)), true)
  assert.equal(C.unlocked('tease', mk(0, 4)), false)
  assert.equal(C.unlocked('tease', mk(0, 5)), true)
  assert.equal(C.unlocked('shoulder', mk(19, 0)), false)
  assert.equal(C.unlocked('shoulder', mk(20, 0)), true)
  assert.equal(C.unlocked('reconcile', mk(0, 0)), false)
  assert.equal(C.unlocked('reconcile', mk(-1, 0)), true)
  assert.equal(C.unlocked('greet', mk(0, 0)), true)
  assert.equal(C.unlocked('nap', mk(0, 0)), true)
})

test('socialGate：六种淘汰原因各命中一次', () => {
  const self = { cooldown: {}, bond: { affinity: 0, familiarity: 10 } }
  assert.equal(C.socialGate('greet', { cooldown: { greet: 5 }, bond: { affinity: 0, familiarity: 10 } }, {}, 10), 'cooldown')
  assert.equal(C.socialGate('gift', { cooldown: {}, bond: { affinity: 0, familiarity: 0 } }, {}, 10), 'locked')
  assert.equal(C.socialGate('greet', self, null, Infinity), 'no-partner')
  assert.equal(C.socialGate('greet', self, { held: true }, 10), 'partner-held')
  assert.equal(C.socialGate('greet', self, { busy: true }, 10), 'partner-busy')
  assert.equal(C.socialGate('greet', self, {}, 400), 'too-far')
  assert.equal(C.socialGate('approach', self, {}, 400), null, 'approach 是远距离的兜底，不该被距离淘汰')
})

test('socialGate：淘汰顺序是语义 —— 冷却优先于解锁，解锁优先于对方可响应性', () => {
  const self = { cooldown: { gift: 5 }, bond: { affinity: 0, familiarity: 0 } }   // 同时冷却 + 未解锁
  assert.equal(C.socialGate('gift', self, {}, 10), 'cooldown')
  const self2 = { cooldown: {}, bond: { affinity: 0, familiarity: 0 } }
  assert.equal(C.socialGate('gift', self2, { held: true }, 10), 'locked')
})

test('chooseIntent：对方被拎起时绝不返回社交意图', () => {
  const self = C.createMind('kylinzi'); self.x = 0; self.y = 0
  self.bond = { affinity: 100, familiarity: 100 }
  const other = C.createMind('xisha'); other.x = 10; other.y = 0; other.mood = 0; other.held = true; other.busy = false
  const r = C.chooseIntent(self, other, () => 0.5)
  assert.equal(r.family, 'solo')
  assert.ok(!SOCIAL.includes(r.intent), '不应返回社交意图：' + r.intent)
  const byIntent = {}
  for (const c of Array.from(r.all)) byIntent[c.intent] = c
  for (const c of SOCIAL) assert.ok(byIntent[c].gate !== null, c + ' 应被淘汰，却 gate=null')
  // 无解锁条件的候选因「对方被拎起」被淘汰；reconcile 先撞解锁门（affinity 100 > −1）—— 门控顺序使然。
  assert.equal(byIntent.greet.gate, 'partner-held')
  assert.equal(byIntent.approach.gate, 'partner-held')
  assert.equal(byIntent.reconcile.gate, 'locked')
})

test('chooseIntent：社交全被淘汰时回 idle，all 里能看到各自的 gate 原因', () => {
  const self = C.createMind('kylinzi'); self.x = 0; self.y = 0
  self.bond = { affinity: 0, familiarity: 0 }
  const r = C.chooseIntent(self, null, () => 0.5)
  assert.equal(r.intent, 'idle')
  assert.equal(r.family, 'solo')
  const byIntent = {}
  for (const c of Array.from(r.all)) byIntent[c.intent] = c
  assert.equal(byIntent.gift.gate, 'locked')
  assert.equal(byIntent.approach.gate, 'no-partner')
  assert.equal(byIntent.greet.gate, 'no-partner')
})

test('chooseIntent：注入固定 rng 时结果可复现，且 jitter 不污染 score', () => {
  const mkRng = () => { let s = 20261011; return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s / 0x7fffffff } }
  const mkSelf = () => { const m = C.createMind('kylinzi'); m.x = 0; m.y = 0; m.mood = 0.6; m.energy = 0.4; m.bond = { affinity: 12, familiarity: 6 }; return m }
  const mkOther = () => { const m = C.createMind('xisha'); m.x = 100; m.y = 0; m.mood = -0.5; m.held = false; m.busy = false; return m }
  const a = C.chooseIntent(mkSelf(), mkOther(), mkRng())
  const b = C.chooseIntent(mkSelf(), mkOther(), mkRng())
  assert.equal(a.intent, b.intent)
  assert.equal(a.family, b.family)
  assert.ok(Math.abs(a.score - b.score) < 1e-12)
  const mine = Array.from(a.all).find((c) => c.intent === a.intent)
  assert.equal(a.score, mine.score, 'jitter 只能影响选谁，不得写进返回值')
})

test('chooseIntent 不修改任何状态（决策与推进分离）', () => {
  const self = C.createMind('kylinzi'); self.x = 0; self.y = 0; self.mood = 0.3; self.energy = 0.7; self.bond = { affinity: 5, familiarity: 4 }
  const other = C.createMind('xisha'); other.x = 50; other.y = 20; other.mood = -0.6; other.held = false; other.busy = false
  const before = canon([self, other])
  C.chooseIntent(self, other, () => 0.42)
  assert.equal(canon([self, other]), before)
})
