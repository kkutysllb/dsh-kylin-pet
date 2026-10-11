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

/**
 * 演员替身：阶段执行器会碰的每一样都要在（play / setFacing / say / x / y / held / busy / target）。
 * director.test.mjs 那只只够导演的决策面，enterPhase 会 TypeError —— 故本文件另建一只行为正确的替身。
 */
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

/**
 * 场景：两只相邻（dist=60 ≤ NEAR_RADIUS 150）、冷却为空、账本可注入。
 * 心智带 x/y —— chooseIntent 靠它算距离，缺了就 NaN。
 */
function mkScene(bond) {
  const b = bond || { affinity: 0, familiarity: 0 }
  const A = mkActor('kylinzi', 0, 0)
  const B = mkActor('xisha', 60, 0)
  const world = { actors: [A, B], pairKey: 'kylinzi|xisha' }
  const minds = {}
  for (const a of world.actors) {
    const m = C.createMind(a.pet.id)
    m.bond = { affinity: b.affinity, familiarity: b.familiarity }
    m.x = a.x
    m.y = a.y
    minds[a.pet.id] = m
  }
  const model = { bond: { affinity: b.affinity, familiarity: b.familiarity } }
  const stuck = []
  const d = C.createDirector({
    world: world, minds: minds, model: model, rng: () => 0.5,
    onStimulus: (evs) => { stuck.push(evs) },
  })
  return { A: A, B: B, world: world, minds: minds, model: model, stuck: stuck, d: d }
}

/** 逐拍推进直到合演结束。**每一拍都把当时看到的 phase 记下来**（这是「真的走到尾」的唯一证据）。 */
function drive(d, maxFrames) {
  const raw = []
  let frames = 0
  while (d.duet && frames < maxFrames) {
    raw.push(d.duet.phase)
    d.step(1 / 60)
    frames++
  }
  return { raw: raw, frames: frames, ended: d.duet === null }
}

/**
 * 推进到**第一拍结算**为止（不用 deadline 兜底）。
 * 这是「结算是否真的释放了动作槽」唯一能分辨的驱动方式：
 * 只跑到 duet===null 的话，即使 runDuet 忘了 duet = null，
 * 结算阶段的 deadline 也会兜底 abort 把槽位清掉，测试就抓不到。
 */
function driveToSettle(d, maxFrames) {
  const raw = []
  let frames = 0
  let settled = false
  while (d.duet && frames < maxFrames && !settled) {
    raw.push(d.duet.phase)
    const evs = d.step(1 / 60)
    frames++
    for (const e of evs) if (e.type === 'settle') settled = true
  }
  return { raw: raw, frames: frames, settled: settled }
}

/** 游程压缩：只给证据用，不做断言。 */
function rle(list) {
  const out = []
  for (const p of list) {
    if (out.length && out[out.length - 1][0] === p) out[out.length - 1][1]++
    else out.push([p, 1])
  }
  return out
}

test('阶段执行器：一场 greet 真的从 approach 走到 settle（逐拍观测，不是「没抛错」）', () => {
  const s = mkScene()
  assert.ok(s.d.open(s.A, s.B, 'greet', 0), '场景必须能开一场合演')
  const run = drive(s.d, 1000)
  const runs = rle(run.raw)
  console.log('[phase.test] 每拍 duet.phase（greet）游程：' + JSON.stringify(runs))
  console.log('[phase.test] 每一拍：' + run.raw.join(' '))
  assert.equal(run.ended, true, '合演必须在 1000 拍内结束，实际走了 ' + run.frames + ' 拍仍在演')
  const seen = runs.map((e) => e[0])
  assert.equal(canon(seen), canon(['approach', 'open', 'exchange', 'settle']),
    '必须真的按序观察到四个阶段；实际观测到的阶段序列 = ' + JSON.stringify(seen))
  // turned(0.4s) + once(0.6s) + immediate(0.2s) ≈ 72 拍 —— 少于这个数说明阶段是「跳」过去的
  assert.ok(run.frames >= 60, '必须在 open/exchange 阶段真的等够时间，实际只有 ' + run.frames + ' 拍')
})

test('settle 恰好一次：stick 收到 1 条事件，memories 恰好 +1', () => {
  const s = mkScene()
  const before = s.d.memories.length
  s.d.open(s.A, s.B, 'greet', 0)
  drive(s.d, 1000)
  assert.equal(s.stuck.length, 1, '账本写入必须恰好一次')
  assert.equal(s.stuck[0].length, 1)
  assert.equal(s.stuck[0][0].kind, 'greet')
  assert.equal(s.stuck[0][0].affinityDelta, C.TUNING.EFFECT.greet.affinity)
  assert.equal(s.d.memories.length, before + 1)
  assert.equal(s.d.memories[0].aborted, undefined, '正常收尾不该带 aborted')
})

test('结算后 duet 清空、动作槽可复用（不清 => 整局只演一场）', () => {
  const s = mkScene()
  s.d.open(s.A, s.B, 'greet', 0)
  const run = driveToSettle(s.d, 1000)
  assert.equal(run.settled, true, '必须真的走到结算那一拍')
  assert.equal(s.d.duet, null, '结算那一拍之后 runDuet 必须释放动作槽（不许等 deadline 兜底清）')
  assert.equal(s.stuck.length, 1, '结算必须只写一次账本')
  assert.equal(s.A.busy, false)
  assert.equal(s.B.busy, false)
  const again = s.d.open(s.A, s.B, 'greet', 100)
  assert.ok(again, '结算后必须还能再开一场 —— 槽位还占着就整局只演一场')
  assert.equal(again.phase, 'approach')
  assert.equal(s.A.busy, true)
})

test('busy 两条路都清：settle 后与 timeout abort 后都是 false', () => {
  const settled = mkScene()
  settled.d.open(settled.A, settled.B, 'greet', 0)
  drive(settled.d, 1000)
  assert.equal(settled.A.busy, false, 'settle 路径必须清 busy')
  assert.equal(settled.B.busy, false)

  const timed = mkScene()
  timed.d.open(timed.A, timed.B, 'greet', 0)
  timed.d.duet.deadline = 0.01            // 只留最后一拍，逼出 deadline 分支
  const evs = timed.d.step(1 / 60)
  assert.equal(evs.length, 1)
  assert.equal(evs[0].type, 'abort')
  assert.equal(evs[0].detail.outcome, 'abort:timeout')
  assert.equal(timed.A.busy, false, 'abort 路径必须清 busy')
  assert.equal(timed.B.busy, false)
  assert.equal(timed.d.duet, null)
})

test('D3 修正承重：拎起 initiator 与 responder 两条都要立刻 abort', () => {
  for (const which of ['initiator', 'responder']) {
    const s = mkScene()
    s.d.open(s.A, s.B, 'greet', 0)
    const victim = which === 'initiator' ? s.A : s.B
    victim.held = true
    const evs = s.d.step(1 / 60)
    assert.equal(evs.length, 1, which + ' 被拎起必须立刻产生一条事件（修正前 responder 这条会是 []）')
    assert.equal(evs[0].type, 'abort')
    assert.equal(evs[0].detail.outcome, 'abort:partner-held')
    assert.equal(s.d.duet, null)
    assert.equal(s.d.memories[0].aborted, 'partner-held')
  }
})

test('gift 的两条 effect 由关系选：affinity ≥ 0 走 gift，< 0 走 giftIgnored', () => {
  const pos = mkScene()
  pos.d.open(pos.A, pos.B, 'gift', 0)
  drive(pos.d, 1000)
  assert.equal(pos.stuck.length, 1)
  assert.equal(pos.stuck[0][0].kind, 'gift')
  assert.equal(pos.stuck[0][0].affinityDelta, C.TUNING.EFFECT.gift.affinity)
  assert.equal(pos.model.bond.affinity, C.TUNING.EFFECT.gift.affinity)

  const neg = mkScene({ affinity: -5, familiarity: 0 })
  neg.d.open(neg.A, neg.B, 'gift', 0)
  drive(neg.d, 1000)
  assert.equal(neg.stuck.length, 1)
  assert.equal(neg.stuck[0][0].kind, 'gift', 'kind 记的仍是剧本名，不是 effect 名')
  assert.equal(neg.stuck[0][0].affinityDelta, C.TUNING.EFFECT.giftIgnored.affinity)
  assert.equal(neg.model.bond.affinity, -5 + C.TUNING.EFFECT.giftIgnored.affinity)
})

test('超时兜底仍在：阶段谓词永不满足 ⇒ PHASE_TIMEOUT_SEC 后 abort(timeout)', () => {
  const orig = C.ADVANCE.near
  C.ADVANCE.near = () => false            // 只改这一条谓词，跑完立刻还原
  try {
    const s = mkScene()
    s.d.open(s.A, s.B, 'greet', 0)
    const run = drive(s.d, 2000)
    assert.equal(run.ended, true, '不能永久卡死')
    assert.equal(s.d.memories[0].aborted, 'timeout')
    assert.ok(Math.abs(run.frames - 360) <= 1, '6s / (1/60s) ≈ 360 拍，实际 ' + run.frames + ' 拍')
  } finally {
    C.ADVANCE.near = orig
  }
})

test('phaseSpec 缺阶段不抛：abort(no-phase)，不写账本', () => {
  const s = mkScene()
  s.d.open(s.A, s.B, 'greet', 0)
  s.d.duet.phase = 'nope'                 // 剧本在、阶段不在
  const evs = s.d.step(1 / 60)
  assert.equal(evs.length, 1)
  assert.equal(evs[0].type, 'abort')
  assert.equal(evs[0].detail, 'aborted', 'runDuet 的返回值是字符串，不是 duet 对象')
  assert.equal(s.d.duet, null)
  assert.equal(s.d.memories[0].aborted, 'no-phase')
  assert.equal(s.stuck.length, 0, '缺阶段不是结算：绝不写账本')
  assert.equal(s.A.busy, false)
  assert.equal(s.B.busy, false)

  const ghost = mkScene()
  ghost.d.open(ghost.A, ghost.B, 'ghost', 0)   // 剧本名根本不存在
  const g = ghost.d.step(1 / 60)
  assert.equal(g[0].type, 'abort')
  assert.equal(ghost.d.memories[0].aborted, 'no-phase')
})
