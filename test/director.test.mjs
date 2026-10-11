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
    // `box` 与 `setFacing` 是**世界依赖**：`enterPhase` 会读 actor.box.w，判胜负时也会用。
    // 替身缺了它们，一个本来与被测行为无关的用例会以 TypeError 红 —— 而红的原因
    // 看起来像「实现坏了」。**enterPhase 每加一处世界依赖，就要同步补进替身。**
    box: { w: 280, h: 157.5 },
    setFacing: () => {},
    play: (clip, exact) => { a.plays.push(exact || clip) },
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
    onStimulus: (ev) => { stuck.push(ev) },   // 单对象，不是数组
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
  assert.ok(!Array.isArray(s.stuck[0]), 'onStimulus 必须收到**单个事件对象**，不是数组')
  assert.equal(s.stuck[0].pair, 'kylinzi|xisha')
  assert.equal(s.stuck[0].kind, 'gift')
  assert.equal(s.stuck[0].affinityDelta, 3)
  assert.equal(s.stuck[0].familiarityDelta, 1)
  assert.equal(s.stuck[0].at, 7)
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

test('Task5c·6 导演尊重 world 的 a.next：没轮到时**一次都不点播**（每帧抢 ⇒ 屏幕闪烁）', () => {
  // 真浏览器取证（用户报「屏幕闪烁」）：3 秒内 **18 次真实 src 变更**，档位在
  // 「状态整理」（idle 档）与「状态张望」（walk 档）之间每 2 帧翻一次 ——
  // 因为导演每帧重挑意图、每帧 play，把 idleChain 刚点播的「转身」立刻盖回去。
  const s = mkScene()
  s.B.held = true          // 没有可配对的对手 ⇒ 稳定走「独处」那条路
  s.A.next = 5             // 远未到点
  for (let i = 0; i < 90; i++) s.d.step(1 / 60)
  assert.equal(s.A.plays.length, 0, 'a.next 还远未到点，导演不该点播（实际 ' + s.A.plays.length + ' 次）')
  // 到点后必须能动作，否则上面那条是「导演压根不工作」的假绿
  s.A.next = 0
  s.d.step(1 / 60)
  assert.ok(s.A.plays.length > 0, '到点后必须能排动作')
})

test('Task5c·7 freePartner 不招募正在干活的宠（否则合演会把忙碌画面掀掉）', () => {
  // 口径说明：`socialGate` 里已有 `if (self.working) return 'working'`，且有既有测试
  // （V5 socialGate）守着 —— 撤销它该测试会红，本轮实测确认过。
  // 这里补的是**另一条**：`freePartner` 从**对方**那一侧也不能把在忙的宠拽进合演。
  const s = mkScene()
  s.minds.xisha.working = true
  assert.equal(s.d.freePartner(s.A), null, '在忙的宠不能被招募为合演对手')
  s.minds.xisha.working = false
  assert.equal(s.d.freePartner(s.A), s.B, '不忙了就要能招募 —— 否则上一条只是「永远返回 null」的假绿')
  // 导演这一侧：在忙的宠既不被点播、也不被设 target
  const s2 = mkScene()
  s2.minds.kylinzi.working = true
  s2.A.next = 0            // 打开 a.next 闸：否则「没有点播」是被它挡住的，与 working 无关
  for (let i = 0; i < 30; i++) s2.d.step(1 / 60)
  assert.equal(s2.A.plays.length, 0, '在忙的宠不该被点播（实际 ' + s2.A.plays.length + '）')
  assert.equal(s2.A.target, undefined, '也不该被设 target（设了 idleChain 就早退，忙碌档播不出来）')
})

