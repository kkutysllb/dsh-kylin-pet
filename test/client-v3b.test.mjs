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
const SOLO = Array.from(C.INTENTS.solo)
const SOCIAL = Array.from(C.INTENTS.social)

/** 出厂导演表：qualified 只读 cast[].id 与 directing.workStatus。 */
const CONFIG = {
  cast: [{ id: 'kylinzi' }, { id: 'xisha' }],
  directing: { workStatus: { kylinzi: ['ok'], xisha: ['fail'] } },
}

/** 演员替身：deliverStimulus 与导演真正消费的那几样；play/say 都带调用计数。 */
function mkActor(id, x, y) {
  const a = {
    pet: { id: id }, held: false, busy: false, x: x, y: y, facing: 1, target: null, clip: null,
    plays: [], says: [],
    play: (clip) => { a.clip = clip; a.plays.push(clip) },
    setFacing: (f) => { a.facing = f },
    say: (text) => { a.says.push(text) },
  }
  return a
}

/** 心智表：bond 与 x/y 都要在（少了前者抛、少了后者 dist 恒 NaN）。 */
function mkMinds(actors, bond) {
  const b = bond || { affinity: 0, familiarity: 0 }
  const minds = {}
  for (const a of actors) {
    const m = C.createMind(a.pet.id)
    m.bond = { affinity: b.affinity, familiarity: b.familiarity }
    m.x = a.x
    m.y = a.y
    minds[a.pet.id] = m
  }
  return minds
}

/** 一组装好的导演 + 可观测注入面（stuck 是 onStimulus 的桩）。 */
function mkScene(bond) {
  const b = bond || { affinity: 0, familiarity: 0 }
  const A = mkActor('kylinzi', 0, 0)
  const B = mkActor('xisha', 60, 0)
  const world = { actors: [A, B], pairKey: 'kylinzi|xisha' }
  const minds = mkMinds(world.actors, b)
  const model = { bond: { affinity: b.affinity, familiarity: b.familiarity } }
  const stuck = []
  const d = C.createDirector({
    world: world, minds: minds, model: model, rng: () => 0.5,
    onStimulus: (evs) => { stuck.push(evs) },
  })
  return { A: A, B: B, world: world, minds: minds, model: model, stuck: stuck, d: d }
}

test('createMind：默认 bond 让「尚未赋 bond 的心智」不抛，社交候选按 locked 淘汰', () => {
  const self = C.createMind('kylinzi')
  const other = C.createMind('xisha')
  self.x = 0; self.y = 0
  other.x = 60; other.y = 0
  assert.equal(canon(self.bond), canon({ affinity: 0, familiarity: 0 }), '默认必须是中性关系')
  const r = C.chooseIntent(self, other, () => 0.5)   // 没有额外赋 bond，这里不许抛
  assert.ok(SOLO.concat(SOCIAL).indexOf(r.intent) >= 0, '必须返回一个合法意图：' + r.intent)
  const byIntent = {}
  for (const c of Array.from(r.all)) byIntent[c.intent] = c
  for (const c of ['gift', 'tease', 'shoulder', 'reconcile']) {
    assert.equal(byIntent[c].gate, 'locked', c + ' 在 0/0 关系下必须被解锁门淘汰（而不是异常）')
  }
})

test('deliverStimulus：turn-fail 只改心智 —— 没有任何 actor.play 被同步调用', () => {
  const actors = [mkActor('kylinzi', 0, 0), mkActor('xisha', 200, 0)]
  const minds = mkMinds(actors)
  const touched = C.deliverStimulus(minds, actors, { kind: 'turn-fail' }, CONFIG)
  assert.equal(canon(touched), canon(['xisha']))          // 出厂表里只有 xisha 是 fail 档
  assert.equal(minds.xisha.mood, -0.45, 'mood 必须被推动')
  assert.equal(minds.kylinzi.mood, 0, '不在名单里的宠不许被碰')
  assert.equal(actors[0].plays.length, 0)
  assert.equal(actors[1].plays.length, 0, '核心证据：V2 会立刻 play，V3b 必须为 0')
  assert.equal(actors[1].clip, null)
  assert.equal(actors[1].says.length, 0, 'turn-fail 不改气泡')
})

test('deliverStimulus：turn-ok 抬 mood/energy 且夹取，仍然不点播', () => {
  const actors = [mkActor('kylinzi', 0, 0), mkActor('xisha', 200, 0)]
  const minds = mkMinds(actors)
  minds.kylinzi.mood = 0.9
  minds.kylinzi.energy = 0.5
  const touched = C.deliverStimulus(minds, actors, { kind: 'turn-ok' }, CONFIG)
  assert.equal(canon(touched), canon(['kylinzi']))
  assert.equal(minds.kylinzi.mood, 1, '0.9 + 0.35 必须夹到 1')
  assert.ok(Math.abs(minds.kylinzi.energy - 0.6) < 1e-12)
  assert.equal(minds.xisha.mood, 0)
  assert.equal(actors[0].plays.length, 0)
  assert.equal(actors[1].plays.length, 0)
})

test('deliverStimulus：waiting 是双方探头 —— 只置 attention 与气泡，不点播', () => {
  const actors = [mkActor('kylinzi', 0, 0), mkActor('xisha', 200, 0)]
  const minds = mkMinds(actors)
  const touched = C.deliverStimulus(minds, actors, { kind: 'waiting' }, CONFIG)
  assert.equal(canon(touched), canon(['kylinzi', 'xisha']))
  for (const a of actors) {
    assert.equal(a.plays.length, 0, '探头不是换档')
    assert.equal(a.says.length, 1)
  }
  assert.equal(actors[0].says[0], '在呢')
  assert.equal(minds.kylinzi.attention, 'drawn')
  assert.equal(minds.xisha.attention, 'drawn')
})

test('deliverStimulus：被拎起或没有心智的宠不消化诱因', () => {
  const actors = [mkActor('kylinzi', 0, 0), mkActor('xisha', 200, 0)]
  const minds = mkMinds(actors)
  actors[1].held = true
  assert.equal(canon(C.deliverStimulus(minds, actors, { kind: 'turn-fail' }, CONFIG)), canon([]))
  assert.equal(minds.xisha.mood, 0, '被拎起 ⇒ 连心智都不许碰')
  assert.equal(canon(C.deliverStimulus({}, actors, { kind: 'turn-fail' }, CONFIG)), canon([]))
})

test('curiosityOf：0 → 0.5，越界与坏值都被夹住/降级', () => {
  // ⚠️ 计划 Step 5 第 2 条写的期望是 +100 → 0.95、-100 → 0.05；V3 已落地的实现夹在 [0.25, 0.9]
  // （client.js: clamp(0.5 + affinity/200, 0.25, 0.9)），实测 0.9 / 0.25。按实测断言，已上报。
  assert.equal(C.curiosityOf(0), 0.5)
  assert.equal(C.curiosityOf(100), 0.9, '上界是 0.9（不是计划写的 0.95）')
  assert.equal(C.curiosityOf(-100), 0.25, '下界是 0.25（不是计划写的 0.05）')
  assert.equal(C.curiosityOf(1e9), 0.9, '越界必须夹在 affinity 边界内')
  assert.equal(C.curiosityOf(-1e9), 0.25)
  assert.equal(C.curiosityOf('abc'), 0.5, '解析不出的值降级成中性 0.5')
  assert.equal(C.curiosityOf(undefined), 0.5)
})

test('freePartner：对方被拎起或忙碌时不配对，且不会返回自己', () => {
  const s = mkScene()
  assert.equal(s.d.freePartner(s.A), s.B, '不能把自己当对手')
  s.B.held = true
  assert.equal(s.d.freePartner(s.A), null, '被拎起的不能配对')
  s.B.held = false
  s.B.busy = true
  assert.equal(s.d.freePartner(s.A), null, '正在合演的不能配对')
  s.B.busy = false
  assert.equal(s.d.freePartner(s.B), s.A)
})

test('settle：账本写入只经由注入的 onStimulus（导演不自己发请求）', () => {
  const s = mkScene()
  s.d.open(s.A, s.B, 'greet', 0)
  s.d.settle('greet', s.A, s.B, 'greet', 5)
  assert.equal(s.stuck.length, 1, '必须恰好调一次')
  assert.equal(s.stuck[0].length, 1)
  const ev = s.stuck[0][0]
  assert.equal(ev.pair, s.world.pairKey, '参数里必须有 pair')
  assert.equal(ev.kind, 'greet')
  assert.equal(ev.affinityDelta, 2)
  assert.equal(ev.familiarityDelta, 1)
  assert.equal(ev.at, 5)
  assert.equal(canon(s.model.bond), canon({ affinity: 2, familiarity: 1 }), '导演的镜像账本同步在写')
})

test('冷却：同一剧本 settle 两次，第二次被 socialGate 以 cooldown 淘汰', () => {
  const s = mkScene()
  const self = s.minds.kylinzi
  const other = s.minds.xisha
  assert.equal(C.socialGate('greet', self, other, 60), null, '冷却为空时必须放行')
  s.d.open(s.A, s.B, 'greet', 0)
  s.d.settle('greet', s.A, s.B, 'greet', 0)
  assert.equal(C.socialGate('greet', self, other, 60), 'cooldown')
  assert.equal(self.cooldown.greet, C.TUNING.COOLDOWN_SEC.greet)
  C.stepMind(self, C.TUNING.COOLDOWN_SEC.greet)   // 把冷却走完
  assert.equal(C.socialGate('greet', self, other, 60), null, '冷却归零后必须重新放行')
})

test('心智必须带位置：缺 x/y 时 dist 恒 NaN，社交候选永不入选', () => {
  const bare = C.createMind('kylinzi')
  const bareOther = C.createMind('xisha')
  const r1 = C.chooseIntent(bare, bareOther, () => 0.5)   // 两者都没有 x/y
  assert.equal(r1.family, 'solo', 'NaN 距离下社交候选不该入选，否则 dist 检查是假的')

  const self = C.createMind('kylinzi')
  const other = C.createMind('xisha')
  self.x = 0; self.y = 0
  other.x = 60; other.y = 0
  self.bond = { affinity: 50, familiarity: 0 }
  const r2 = C.chooseIntent(self, other, () => 0.5)
  assert.equal(r2.family, 'social', '带位置、关系够时才可能开出社交意图：' + r2.intent)
  assert.ok(SOCIAL.indexOf(r2.intent) >= 0)
})
