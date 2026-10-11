import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/** JSON 归一化 + 键排序：跨 realm 对象不能直接 deepStrictEqual（原型不等会误判）。 */
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

/** 演员替身：只提供导演真正消费的四样（pet.id / held / busy / play）。 */
function mkActor(id, x, y) {
  const a = {
    pet: { id: id }, held: false, busy: false, x: x, y: y, plays: [],
    play: (clip) => { a.plays.push(clip) },
  }
  return a
}

/** 一组装好的导演 + 可观测的注入面（model / onStimulus / minds 都是可查的桩）。 */
function mkScene() {
  const A = mkActor('kylinzi', 0, 0)
  const B = mkActor('xisha', 100, 0)
  const world = { actors: [A, B], pairKey: 'kylinzi|xisha' }
  const minds = {}
  for (const a of world.actors) {
    const m = C.createMind(a.pet.id)
    m.bond = { affinity: 0, familiarity: 0 }
    m.x = a.x
    m.y = a.y
    minds[a.pet.id] = m
  }
  const model = { bond: { affinity: 0, familiarity: 0 } }
  const stuck = []
  const director = C.createDirector({
    world: world, minds: minds, model: model, rng: () => 0.5,
    onStimulus: (evs) => { stuck.push(evs) },
  })
  return { A: A, B: B, world: world, minds: minds, model: model, stuck: stuck, d: director }
}

test('动作槽：同一时刻只允许一场合演（第二次 open 回 null）', () => {
  const s = mkScene()
  const first = s.d.open(s.A, s.B, 'greet', 0)
  assert.ok(first)
  assert.equal(s.d.open(s.A, s.B, 'gift', 1), null, '动作槽已占用，第二次必须回 null')
  assert.equal(s.d.duet.kind, 'greet')
  assert.equal(s.A.busy, true)
  assert.equal(s.B.busy, true)
  assert.equal(canon(first), canon({
    kind: 'greet', initiator: 'kylinzi', responder: 'xisha',
    phase: 'approach', deadline: C.TUNING.PHASE_TIMEOUT_SEC.approach, outcome: null, at: 0,
  }))
})

test('settle：按效果表改账本，affinity 两端都夹取、familiarity 只增', () => {
  const s = mkScene()
  s.d.open(s.A, s.B, 'reconcile', 0)
  const ev = s.d.settle('reconcile', s.A, s.B, 'reconcile', 10)
  assert.equal(s.model.bond.affinity, 8, 'reconcile 是最大增量 8')
  assert.equal(s.model.bond.familiarity, 2)
  assert.equal(canon(ev), canon({
    pair: 'kylinzi|xisha', kind: 'reconcile', affinityDelta: 8, familiarityDelta: 2, at: 10,
  }))
  s.model.bond = { affinity: -99, familiarity: 0 }
  s.d.settle('tease', s.A, s.B, 'tease', 11)
  assert.equal(s.model.bond.affinity, -100, '低下界必须夹住')
  assert.ok(s.model.bond.familiarity >= 0, 'familiarity 不为负')
})

test('settle：双方各上一条冷却与一条记忆，并清掉 busy（计划注释②）', () => {
  const s = mkScene()
  s.d.open(s.A, s.B, 'greet', 0)
  assert.equal(s.A.busy, true, 'open 后必须在演')
  s.d.settle('greet', s.A, s.B, 'greet', 5)
  for (const id of ['kylinzi', 'xisha']) {
    const m = s.minds[id]
    assert.equal(m.cooldown.greet, C.TUNING.COOLDOWN_SEC.greet)
    assert.equal(m.recent.length, 1)
    assert.equal(m.recent[0].kind, 'greet')
    assert.equal(m.recent[0].delta, 2)
    assert.equal(m.mood, 0.2, '正向效果给 mood +0.2')
  }
  assert.equal(s.A.busy, false, 'settle 也必须清 busy，否则宠永久卡住')
  assert.equal(s.B.busy, false)
  assert.equal(s.d.memories.length, 1)
})

test('settle：账本写入经由注入的 onStimulus（导演不自己发请求）', () => {
  const s = mkScene()
  assert.equal(s.stuck.length, 0)
  s.d.settle('gift', s.A, s.B, 'gift', 7)
  assert.equal(s.stuck.length, 1, '必须恰好调一次')
  assert.equal(s.stuck[0].length, 1)
  assert.equal(s.stuck[0][0].pair, 'kylinzi|xisha')
  assert.equal(s.stuck[0][0].kind, 'gift')
  assert.equal(s.stuck[0][0].affinityDelta, 3)
  assert.equal(s.stuck[0][0].familiarityDelta, 1)
  assert.equal(s.stuck[0][0].at, 7)
})

test('abort：拎走路径写记忆、清掉全部 busy、释放动作槽', () => {
  const s = mkScene()
  s.d.open(s.A, s.B, 'chase', 3)
  const done = s.d.abort('partner-held')
  assert.equal(done.outcome, 'abort:partner-held')
  assert.equal(s.d.duet, null)
  assert.equal(s.A.busy, false)
  assert.equal(s.B.busy, false)
  assert.equal(s.d.memories.length, 1)
  assert.equal(s.d.memories[0].aborted, 'partner-held')
  for (const id of ['kylinzi', 'xisha']) {
    const m = s.minds[id]
    assert.equal(m.recent.length, 1)
    assert.equal(m.recent[0].aborted, 'partner-held')
    assert.equal(m.recent[0].delta, 0)
  }
})

test('abort：超时路径同样清掉 busy；没有合演时是 no-op', () => {
  const s = mkScene()
  s.d.open(s.A, s.B, 'greet', 0)
  const done = s.d.abort('timeout')
  assert.equal(done.outcome, 'abort:timeout')
  assert.equal(s.A.busy, false)
  assert.equal(s.B.busy, false)
  assert.equal(s.d.abort('timeout'), null)
  assert.equal(s.d.memories.length, 1, 'no-op 不该再写一条')
})

test('priority：|affinity| 大者胜（同 mind、同新鲜度）', () => {
  const lo = mkScene()
  lo.model.bond = { affinity: 2, familiarity: 0 }
  const hi = mkScene()
  hi.model.bond = { affinity: 50, familiarity: 0 }
  const m = C.createMind('kylinzi')
  m.energy = 0.5
  assert.ok(hi.d.priority('greet', m, 0) > lo.d.priority('greet', m, 0))
  const neg = mkScene()
  neg.model.bond = { affinity: -50, familiarity: 0 }
  assert.equal(neg.d.priority('greet', m, 0), hi.d.priority('greet', m, 0), '看的是绝对值')
})

test('priority：同 affinity 时 energy 高者胜；同剧本越久没做越新鲜', () => {
  const s = mkScene()
  s.model.bond = { affinity: 10, familiarity: 0 }
  const sleepy = C.createMind('kylinzi')
  sleepy.energy = 0.2
  const awake = C.createMind('xisha')
  awake.energy = 0.9
  assert.ok(s.d.priority('greet', awake, 0) > s.d.priority('greet', sleepy, 0))
  const fresh = C.createMind('kylinzi')
  fresh.energy = 0.9
  const stale = C.createMind('xisha')
  stale.energy = 0.9
  stale.recent = [{ kind: 'greet', at: 0, delta: 0 }]
  assert.ok(Math.abs(s.d.priority('greet', stale, 0) - 0.9) < 1e-12, '刚做过：新鲜度为 0')
  assert.ok(s.d.priority('greet', stale, 0) < s.d.priority('greet', fresh, 0))
})

test('freePartner：跳过被拎起 / busy 的宠，且不会返回自己', () => {
  const s = mkScene()
  assert.equal(s.d.freePartner(s.A), s.B, '不能把自己当对手')
  assert.equal(s.d.freePartner(s.B), s.A)
  s.B.held = true
  assert.equal(s.d.freePartner(s.A), null)
  s.B.held = false
  s.B.busy = true
  assert.equal(s.d.freePartner(s.A), null)
  s.B.busy = false
  assert.equal(s.d.freePartner(s.A), s.B)
})
