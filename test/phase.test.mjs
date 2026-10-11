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
 * 场景：两只相邻（默认 dist=60 ≤ NEAR_RADIUS 150）、冷却为空、账本可注入。
 * `gap` 可覆盖距离 —— Task 4c 的「approach 只在远处赢」需要 dist>288 的观测口，
 * 贴近场景里那道门根本不会被走到（会假绿）。
 * 心智带 x/y —— chooseIntent 靠它算距离，缺了就 NaN。
 */
function mkScene(bond, gap) {
  const b = bond || { affinity: 0, familiarity: 0 }
  const span = gap === undefined ? 60 : gap
  const A = mkActor('kylinzi', 0, 0)
  const B = mkActor('xisha', span, 0)
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
/* ==================== Task 4c：意图 ≠ 剧本（Step 3 的五条） ==================== */

/**
 * approach 的打分读口。`socialScore` 不在 `__kylinContract` 里（本 Task 不改契约），
 * `chooseIntent().all` 是唯一能取到候选分数的口 —— 用它，别新增暴露面。
 */
function approachScore(distance) {
  const s = mkScene(undefined, distance)
  const r = C.chooseIntent(s.minds.kylinzi, s.minds.xisha, () => 0.5)
  const hit = Array.from(r.all).find((c) => c.intent === 'approach')
  assert.ok(hit, 'approach 必须在候选表里')
  return hit.score
}

test('Task4c·1 没有剧本的意图不开合演：approach 只走过去，不 open', () => {
  // 距离 340 才让 approach 赢：Step 2 之后它**只在远处**赢，那正是修正的目的
  // （贴近时「想过去」本身没有意义）。贴近场景里 approach 不会被选中 —— 观测不到这道门。
  const s = mkScene(undefined, 340)
  const evs = s.d.step(1 / 60)
  const mine = evs.find((e) => e.type === 'intent' && e.pet === 'kylinzi')
  assert.ok(mine, '这一拍必须有意图事件')
  assert.equal(mine.intent, 'approach', '前置：本拍 approach 必须真的赢，否则断言空转')
  assert.equal(s.d.duet, null, 'approach 在 SCRIPTS 里没有剧本，绝不许 open 一场不存在的合演')
  assert.ok(!evs.some((e) => e.type === 'open'), '不许有 open 事件')
  assert.equal(s.A.clip, 'walk', 'approach 应当走起来')
  assert.equal(canon(s.A.target), canon({ x: s.B.x, y: s.B.y }), 'approach 应当朝对方设 target')
})

test('Task4c·2 不再有 no-phase 空转：近距与远距两种自然游程都是零', () => {
  // 两个距离都要观测：
  //  - 60（贴近）：修正前 approach 用固定 +0.5 赢过 idle(0.4) ⇒ 每两拍一条 abort(no-phase)；
  //  - 340（拉远）：Step 2 之后 approach 只在这类距离赢。贴近场景里那道门根本不会被走到，
  //    所以「删掉门会不会红」只能在远距观测口上验（近距会因 approach 不再被选中而假绿）。
  for (const gap of [60, 340]) {
    const s = mkScene(undefined, gap)
    let opens = 0
    let approaches = 0
    for (let i = 0; i < 2000; i++) {
      for (const e of s.d.step(1 / 60)) {
        if (e.type === 'open') opens++
        if (e.type === 'intent' && e.intent === 'approach') approaches++
      }
    }
    const spins = s.d.memories.filter((m) => m.aborted === 'no-phase')
    assert.equal(spins.length, 0,
      'gap=' + gap + '：出现 ' + spins.length + ' 条 abort(no-phase) 空转，前 3 条 = ' + JSON.stringify(spins.slice(0, 3)))
    assert.equal(opens, 0, 'gap=' + gap + '：没有剧本的意图不许 open（实际 ' + opens + ' 次）')
    if (gap === 340) {
      assert.ok(approaches > 0, 'gap=340 时 approach 必须真的被选中过，否则这条断言是空转的（实际 ' + approaches + ' 次）')
    }
  }
})

test('Task4c·3 approach 的打分与距离同向：从公开出口观测，不直接调 socialScore', () => {
  // 计划 2026-10-11 改：socialScore **不在 __kylinContract 里**，跨 realm 够不到。
  // 改成观测导演真正消费的那个出口（chooseIntent 的返回），比比数值更强。
  const far = mkScene(undefined, 360)
  const farPick = C.chooseIntent(far.minds.kylinzi, far.minds.xisha, () => 0.5)
  const near = mkScene(undefined, 60)
  const nearPick = C.chooseIntent(near.minds.kylinzi, near.minds.xisha, () => 0.5)
  const at0 = approachScore(0)
  const at100 = approachScore(100)
  const at360 = approachScore(360)
  console.log('[phase.test] approach 分数 0/100/360 = ' + [at0, at100, at360].join(' / ') +
    '；距 360 选中=' + farPick.intent + '，距 60 选中=' + nearPick.intent)
  assert.equal(farPick.intent, 'approach', '距离 = SOCIAL_RADIUS 时「过去」应当胜出；实际 = ' + farPick.intent)
  assert.notEqual(nearPick.intent, 'approach', '就在身边就不该还想「过去」；实际 = ' + nearPick.intent)
})

test('Task4c·4 贴近 + aff=20：赢下来的必须是有剧本的意图', () => {
  const s = mkScene({ affinity: 20, familiarity: 0 }, 100)
  const r = C.chooseIntent(s.minds.kylinzi, s.minds.xisha, () => 0.5)
  const kinds = Object.keys(C.SCRIPTS)
  const live = Array.from(r.all).filter((c) => c.family === 'social' && c.gate === null).map((c) => c.intent + '=' + c.score)
  console.log('[phase.test] aff=20 dist=100 选中=' + r.intent + '；放行的社交候选：' + live.join(', '))
  assert.ok(kinds.indexOf(r.intent) >= 0,
    '赢的必须是有剧本的意图（修正前会回 approach）；实际 = ' + r.intent + '，SCRIPTS = ' + JSON.stringify(kinds))
})

test('Task4c·5 端到端：aff=30 自然跑 3000 拍，至少一次正常收尾且 kind 是剧本之一', () => {
  const s = mkScene({ affinity: 30, familiarity: 0 })
  for (let i = 0; i < 3000; i++) s.d.step(1 / 60)
  const good = s.d.memories.filter((m) => m.aborted === undefined)
  const spins = s.d.memories.filter((m) => m.aborted === 'no-phase')
  const seen = []
  for (const m of good) if (seen.indexOf(m.kind) < 0) seen.push(m.kind)
  console.log('[phase.test] aff=30 跑 3000 拍：正常收尾 ' + good.length + ' 次，no-phase 空转 ' + spins.length + ' 次，走通的剧本 = ' + JSON.stringify(seen))
  assert.ok(good.length >= 1, '至少要有一次正常收尾；实际 memories = ' + JSON.stringify(s.d.memories.slice(0, 3)))
  const kinds = Object.keys(C.SCRIPTS)
  for (const m of good) assert.ok(kinds.indexOf(m.kind) >= 0, '正常收尾的 kind 必须是 8 个剧本之一：' + m.kind)
  // 以下两条是计划原文之外补的（原文只用「至少一次正常收尾」判绿，而**修正前它也绿** ——
  // aff=30 时 shoulder(0.6+0.6−0.067=1.133) 本来就压过 approach(0.6+0.5−0.067=1.033)，
  // 于是 pre-fix 会在 shoulder 结算后掉进 approach 空转，但「至少一次」已被 shoulder 满足。
  // 补这两条才有判别力：空转必须为 0、且不止一个剧本真的走通（原文的论点是「8 个里 7 个不可达」）。
  assert.equal(spins.length, 0, '端到端游程里不许有 no-phase 空转（实际 ' + spins.length + ' 次）')
  assert.ok(seen.length >= 2, '至少要有两个不同剧本真的走通（修正前只有 shoulder）；实际 = ' + JSON.stringify(seen))
})

