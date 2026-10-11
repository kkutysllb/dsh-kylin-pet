import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { TOOL_CLASS } from '../src/shared/contract.js'

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
    onStimulus: (ev) => { stuck.push(ev) },   // 单对象，不是数组
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

test('deliverStimulus：turn-fail 改心智 + 出气泡（黄9），仍然不点播', () => {
  const actors = [mkActor('kylinzi', 0, 0), mkActor('xisha', 200, 0)]
  const minds = mkMinds(actors)
  const touched = C.deliverStimulus(minds, actors, { kind: 'turn-fail' }, CONFIG)
  assert.equal(canon(touched), canon(['xisha']))          // 出厂表里只有 xisha 是 fail 档
  assert.equal(minds.xisha.mood, -0.45, 'mood 必须被推动')
  assert.equal(minds.kylinzi.mood, 0, '不在名单里的宠不许被碰')
  assert.equal(actors[0].plays.length, 0)
  assert.equal(actors[1].plays.length, 0, '核心证据：不点播档位的红线不动 —— 气泡不是档位')
  assert.equal(actors[1].clip, null)
  // v0.1.1 黄9：回合成败必须可见 —— turn-fail 说「让我想想」（waiting 先例：诱因可以说）。
  assert.equal(actors[1].says.length, 1)
  assert.equal(actors[1].says[0], '让我想想')
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

test('deliverStimulus：waiting 是双方探头 —— 只冒气泡，不点播；attention 死字段已删（黄9）', () => {
  const actors = [mkActor('kylinzi', 0, 0), mkActor('xisha', 200, 0)]
  const minds = mkMinds(actors)
  const touched = C.deliverStimulus(minds, actors, { kind: 'waiting' }, CONFIG)
  assert.equal(canon(touched), canon(['kylinzi', 'xisha']))
  for (const a of actors) {
    assert.equal(a.plays.length, 0, '探头不是换档')
    assert.equal(a.says.length, 1)
  }
  assert.equal(actors[0].says[0], '在呢')
  // attention 原先只写不读（V3b 起「drawn」没有任何消费者）—— 死字段比死代码更贵，删除。
  assert.equal(minds.kylinzi.attention, undefined)
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
  assert.ok(!Array.isArray(s.stuck[0]), 'onStimulus 必须收到**单个事件对象**，不是数组')
  const ev = s.stuck[0]
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

test('deliverStimulus(null / 未知 kind) 不抛：缺了守卫会让 since 不推进、整批诱因反复重投', () => {
  const C = loadContract()
  const actors = [{ pet: { id: 'kylinzi' }, held: false, plays: [], says: [] }]
  const minds = { kylinzi: C.createMind('kylinzi') }
  // V2 的 react() 有这个守卫，Task 5 的 deliverStimulus 一度丢了它。
  assert.equal(canon(C.deliverStimulus(minds, actors, null, {})), canon([]))
  assert.equal(canon(C.deliverStimulus(minds, actors, undefined, {})), canon([]))
  assert.equal(canon(C.deliverStimulus(minds, actors, { kind: 'nope' }, {})), canon([]))
  // 未知 kind 不该动心智
  assert.equal(minds.kylinzi.mood, 0)
})


// ── V5：执行期的「在忙」面（client 侧）───────────────────────────────
// 替身只带被测代码真正会读的字段。**刻意不抄整套 actor/mind** —— 抄一份完整替身
// 等于把实现抄一遍，实现改了替身还是绿的（本片之前为此栽过一次）。
function v5Actor(id, over) {
  const a = {
    pet: { id: id }, held: false, busy: false, target: null, said: [],
    say(text) { if (text) this.said.push(text) },
  }
  return Object.assign(a, over || {})
}
function v5Mind(over) {
  return Object.assign({
    petId: 'kylinzi', mood: 0, energy: 1, attention: 'free', working: false,
    cooldown: {}, bond: { affinity: 0, familiarity: 0 }, recent: [],
  }, over || {})
}
const V5CFG = {
  cast: [{ id: 'kylinzi' }, { id: 'xisha' }],
  directing: { workStatus: { kylinzi: ['ok'], xisha: ['fail'] } },
}

test('V5c pickDifferent：点击反应不许连播同一段（参考实现 pick(pool, current) 同语义）', () => {
  const pool = C.CLICKS
  assert.equal(C.pickDifferent(pool, '点击开心', () => 0), '开心跳跃', '过滤掉当前段后按 rng 取')
  for (let i = 0; i < 200; i++) {
    const name = C.pickDifferent(pool, '点击开心', Math.random)
    assert.ok(pool.includes(name), '必须出自档位池：' + name)
    assert.notEqual(name, '点击开心', '不许返回正在播的那一段')
  }
  const seen = new Set(Array.from({ length: 80 }, () => C.pickDifferent(pool, '点击开心', Math.random)))
  assert.ok(seen.size >= 2, '多次点击应能播到不同反应（实际只见过 ' + [...seen].join('/') + '）')
  // 档位只有一段：没有别的可选，原样返回（参考实现同样退化，不炸）
  assert.equal(C.pickDifferent(['被拎起'], '被拎起', Math.random), '被拎起')
  // current 为空：全池可挑
  assert.ok(pool.includes(C.pickDifferent(pool, null, () => 0)))
})

test('A8 busyClipOf：只有在忙、没被拎起、且不在合演时才给「状态忙碌」', () => {
  const m = v5Mind({ working: true })
  assert.equal(C.busyClipOf(m, v5Actor('kylinzi')), C.BUSY_CLIP)
  assert.equal(C.busyClipOf(m, v5Actor('kylinzi', { held: true })), null, '被拎起时该播「被拎起」')
  assert.equal(C.busyClipOf(m, v5Actor('kylinzi', { busy: true })), null, '合演中由导演点播，忙碌不该盖掉它')
  assert.equal(C.busyClipOf(v5Mind({ working: false }), v5Actor('kylinzi')), null)
  assert.equal(C.busyClipOf(null, v5Actor('kylinzi')), null)
  assert.equal(C.busyClipOf(v5Mind(), null), null)
  // 素材表里那一段**真的存在** —— 名字写错 = 永远播不出来，而 play 的失败是静默的。
  assert.ok(C.CLIPS.walk.indexOf(C.BUSY_CLIP) >= 0, 'BUSY_CLIP 必须在 walk 档里')
  assert.ok(C.LOOPING.indexOf('walk') >= 0, '忙碌段是循环档：长时间重复播它是预期，不是卡帧')
})

test('A8 deliverStimulus：working 让**全员**进入忙碌态，但只有主讲开口', () => {
  const minds = { kylinzi: v5Mind({ petId: 'kylinzi' }), xisha: v5Mind({ petId: 'xisha' }) }
  const actors = [v5Actor('kylinzi'), v5Actor('xisha')]
  const touched = C.deliverStimulus(minds, actors, { kind: 'working', detail: 'read' }, V5CFG)
  // `touched` 是 **vm 里**造的数组，原型与外层不同 —— deepStrictEqual 会判不等。
  // 同文件其它跨 realm 断言一律走 canon()，这里也一样。
  assert.deepEqual(canon(touched), canon(['kylinzi']), '开口的只有主讲')
  assert.equal(minds.kylinzi.working, true)
  assert.equal(minds.xisha.working, true, '忙碌是**全员**的：两只都在同一台机器上干活')
  assert.deepEqual(actors[0].said, ['在翻文件'])
  assert.deepEqual(actors[1].said, [], '在忙期间另一只不说话（那会变成两条气泡互相刷）')
})

test('A9 deliverStimulus：working-done 清忙碌、主讲说「干完了」、另一只应「嗯」', () => {
  const minds = { kylinzi: v5Mind({ petId: 'kylinzi', working: true }), xisha: v5Mind({ petId: 'xisha', working: true }) }
  const actors = [v5Actor('kylinzi'), v5Actor('xisha')]
  C.deliverStimulus(minds, actors, { kind: 'working-done', detail: '' }, V5CFG)
  assert.equal(minds.kylinzi.working, false)
  assert.equal(minds.xisha.working, false)
  assert.deepEqual(actors[0].said, [C.LINES_STIMULUS['working-done']])
  assert.deepEqual(actors[1].said, [C.ECHO_DONE], '另一只在**收工这一下**应一声')
})

test('qualified：执行期主讲 = workStatus 挂 ok 的那只；没分工就都算主讲', () => {
  assert.deepEqual(C.qualified('working', V5CFG), ['kylinzi'])
  assert.deepEqual(C.qualified('working-done', V5CFG), ['kylinzi'])
  const bare = { cast: [{ id: 'kylinzi' }, { id: 'xisha' }] }
  assert.deepEqual(C.qualified('working', bare).slice().sort(), ['kylinzi', 'xisha'], '没配 workStatus 时不能谁都不说话')
})

test('文案表覆盖 classifyTool 的每一个落点（漏一个就是那类工具永远只会说「在忙着」）', () => {
  for (const cls of Object.keys(TOOL_CLASS)) {
    assert.equal(typeof C.LINES_WORKING[cls], 'string', '类别 ' + cls + ' 没有台词')
  }
  assert.equal(C.LINES_WORKING.other, '在忙着')
  for (const [k, v] of Object.entries(C.LINES_WORKING)) assert.ok(v.length > 0, k + ' 的台词为空')
})


test('V5 socialGate：任务执行期间不开新合演（自己忙、对方忙都要挡住）', () => {
  const free = v5Mind({ petId: 'kylinzi' })
  const mate = v5Mind({ petId: 'xisha' })
  const working = v5Mind({ petId: 'kylinzi', working: true })
  assert.equal(C.socialGate('greet', working, mate, 100), 'working', '自己在忙时不该开新合演')
  assert.equal(C.socialGate('greet', free, working, 100), 'partner-working', '对方在忙时也不该开')
  // 回归：都不忙时必须放行 —— 别把合演一起禁了。
  assert.equal(C.socialGate('greet', free, mate, 100), null)
})

test('V5 deliverStimulus：任务开始时停下手里的事（清 target），收工不清', () => {
  const minds = { kylinzi: v5Mind({ petId: 'kylinzi' }), xisha: v5Mind({ petId: 'xisha' }) }
  const actors = [v5Actor('kylinzi', { target: { x: 500, y: 400 } }), v5Actor('xisha', { target: { x: 300, y: 300 } })]
  C.deliverStimulus(minds, actors, { kind: 'working', detail: 'exec' }, V5CFG)
  assert.equal(actors[0].target, null, '听到有活要停下手里的散步，否则忙碌档要等它走到站才出现')
  assert.equal(actors[1].target, null)
  actors[0].target = { x: 1, y: 2 }
  C.deliverStimulus(minds, actors, { kind: 'working-done', detail: '' }, V5CFG)
  assert.deepEqual(actors[0].target, { x: 1, y: 2 }, '收工不该动 target（那时它该自由活动）')
})

// ── v0.1.1 F2/S4：任务跟随气泡 + 梗图回退 ────────────────────────────────

test('F2 task 三态：接活 / 进度(3/7) / 收工，只有主讲开口，仍然不点播', () => {
  const actors = [mkActor('kylinzi', 0, 0), mkActor('xisha', 200, 0)]
  const minds = mkMinds(actors)
  C.deliverStimulus(minds, actors, { kind: 'task-start', detail: '0/7' }, CONFIG)
  assert.deepEqual(actors[0].says, ['接活了'])
  C.deliverStimulus(minds, actors, { kind: 'task-progress', detail: '3/7' }, CONFIG)
  assert.equal(actors[0].says[1], '3/7', '进度直接说 detail')
  C.deliverStimulus(minds, actors, { kind: 'task-done', detail: '7/7' }, CONFIG)
  assert.equal(actors[0].says[2], '收工！')
  assert.ok(minds.kylinzi.mood > 0, '收工抬心情')
  for (const a of actors) assert.equal(a.plays.length, 0, '诱因不点播的红线不动')
  assert.equal(canon(C.deliverStimulus(minds, actors, { kind: 'task-done', detail: '7/7' }, CONFIG)), canon(['kylinzi']), '主讲 = workStatus ok 线')
})

test('S4 memeUrlOf：清单没拉到（空）一律回 null 走文字；非 cast 的宠也 null', () => {
  assert.equal(C.memeUrlOf('kylinzi', '稳了'), null)
  assert.equal(C.memeUrlOf('nobody', '稳了'), null)
})

test('S4 LINES_TASK 逐字钉住（原创文案，不许漂；跨 realm 用 canon 比较）', () => {
  assert.equal(canon(C.LINES_TASK), canon({ 'task-start': '接活了', 'task-done': '收工！' }))
})
