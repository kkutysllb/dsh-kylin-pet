import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

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
const S = C.SCRIPTS
const SCRIPT_NAMES = Array.from(Object.keys(S))
const SORTED_NAMES = SCRIPT_NAMES.slice().sort()
const PHASES = ['approach', 'open', 'exchange', 'settle']
/** 遍历全部剧本的全部阶段：[剧本名, 阶段名, 阶段表] 三元组。 */
function eachPhase() {
  const out = []
  for (const name of SCRIPT_NAMES) {
    const phases = S[name].phases
    for (const phase of Array.from(Object.keys(phases))) out.push([name, phase, phases[phase]])
  }
  return out
}

test('剧本表：8 个剧本，每个都是 approach -> open -> exchange -> settle 四阶段', () => {
  assert.deepEqual(SORTED_NAMES, ['chase', 'comfort', 'contest', 'gift', 'greet', 'reconcile', 'shoulder', 'tease'])
  for (const name of SCRIPT_NAMES) {
    assert.deepEqual(Array.from(Object.keys(S[name].phases)), PHASES, name + ' 的阶段不全或顺序不对')
  }
})

test('剧本表：effect 是 TUNING.EFFECT 里的名字；只有 gift 是两条 effect 的分支', () => {
  const E = C.TUNING.EFFECT
  for (const name of SCRIPT_NAMES) {
    const eff = S[name].effect
    const list = Array.isArray(eff) ? Array.from(eff) : [eff]
    assert.ok(list.length > 0, name + ' 没有 effect')
    for (const e of list) {
      assert.ok(Object.prototype.hasOwnProperty.call(E, e), name + ' 的 effect=' + e + ' 不在 TUNING.EFFECT 里')
    }
  }
  assert.ok(Array.isArray(S.gift.effect), 'gift 的接受/无视是 Outcome 分支，不是两个剧本')
  assert.deepEqual(Array.from(S.gift.effect), ['gift', 'giftIgnored'])
  for (const name of SCRIPT_NAMES) {
    if (name === 'gift') continue
    assert.equal(typeof S[name].effect, 'string', name + ' 应当是单效果')
  }
})

test('剧本表：遍历全部剧本的全部阶段，clip 必须都在 CLIPS 的 6 档里（表现力天花板）', () => {
  const tiers = Array.from(Object.keys(C.CLIPS))
  assert.deepEqual(tiers.slice().sort(), ['happy', 'held', 'idle', 'sad', 'turn', 'walk'], 'CLIPS 应当是 6 档美术')
  let seen = 0
  for (const [name, phase, st] of eachPhase()) {
    seen++
    assert.equal(typeof st.clip, 'string', name + '.' + phase + ' 缺 clip')
    assert.ok(tiers.indexOf(st.clip) >= 0, name + ' 的 ' + phase + ' 阶段写了 CLIPS 里没有的美术档：' + st.clip)
  }
  assert.equal(seen, 32, '8 剧本 x 4 阶段')
})

test('剧本表：每个 until 都在 ADVANCE 里有定义（拼错名字要被抓住）', () => {
  const keys = Array.from(Object.keys(C.ADVANCE))
  for (const [name, phase, st] of eachPhase()) {
    assert.equal(typeof st.until, 'string', name + '.' + phase + ' 缺 until')
    assert.ok(keys.indexOf(st.until) >= 0, name + '.' + phase + ' 的 until=' + st.until + ' 不在 ADVANCE 里')
  }
})

test('ADVANCE：8 个谓词全部是函数（含 hold3s / hold4s 两档时长）', () => {
  assert.deepEqual(Array.from(Object.keys(C.ADVANCE)).sort(),
    ['arrived', 'hold3s', 'hold4s', 'immediate', 'near', 'once', 'turned', 'veryNear'])
  for (const k of Array.from(Object.keys(C.ADVANCE))) assert.equal(typeof C.ADVANCE[k], 'function', k)
})

test('剧本表：facing / move / who 只在白名单里取值，且白名单确实被用到', () => {
  const FACE = ['toward', 'away']
  const MOVE = ['toward', 'apart', 'point']
  const WHO = ['responder', 'winner']
  for (const [name, phase, st] of eachPhase()) {
    if (st.facing !== undefined) assert.ok(FACE.indexOf(st.facing) >= 0, name + '.' + phase + ' facing=' + st.facing)
    if (st.move !== undefined) assert.ok(MOVE.indexOf(st.move) >= 0, name + '.' + phase + ' move=' + st.move)
    if (st.who !== undefined) assert.ok(WHO.indexOf(st.who) >= 0, name + '.' + phase + ' who=' + st.who)
  }
  assert.equal(S.tease.phases.open.facing, 'away')
  assert.equal(S.contest.phases.approach.move, 'point')
  assert.equal(S.tease.phases.exchange.who, 'responder')
  assert.equal(S.contest.phases.exchange.who, 'winner')
})

test('LINES：每个 say 都有词条，且两位角色都有台词', () => {
  let says = 0
  for (const [name, phase, st] of eachPhase()) {
    if (st.say === undefined) continue
    says++
    const entry = C.LINES[st.say]
    assert.ok(entry, name + '.' + phase + ' 的 say=' + st.say + ' 在 LINES 里没有词条')
    for (const pet of ['kylinzi', 'xisha']) {
      assert.equal(typeof entry[pet], 'string', st.say + ' 缺 ' + pet + ' 的台词')
      assert.ok(entry[pet].length > 0, st.say + ' 的 ' + pet + ' 是空台词')
    }
  }
  assert.ok(says >= 8, 'say 至少出现在 8 处阶段里，实际 ' + says)
})

test('LINES：每个键都能在 SCRIPTS 里找到（双向对账，不留死文案）', () => {
  const lineKeys = Array.from(Object.keys(C.LINES)).sort()
  assert.deepEqual(lineKeys, ['chase', 'comfort', 'contest', 'gift', 'greet', 'reconcile', 'tease'])
  for (const k of lineKeys) {
    assert.ok(Object.prototype.hasOwnProperty.call(S, k), 'LINES 的 ' + k + ' 在 SCRIPTS 里没有对应剧本')
  }
  assert.ok(Object.prototype.hasOwnProperty.call(S, 'shoulder'))
  assert.ok(!Object.prototype.hasOwnProperty.call(C.LINES, 'shoulder'), 'shoulder 刻意无台词：靠时长与移动区分')
})

test('解锁条件与 spec §7 对得上（与 TUNING.UNLOCK 交叉核对）', () => {
  const U = C.TUNING.UNLOCK
  assert.equal(U.gift.familiarity, 3)
  assert.equal(U.tease.familiarity, 5)
  assert.equal(U.shoulder.affinity, 20)
  assert.equal(U.reconcile.affinityMax, -1)
  for (const k of Array.from(Object.keys(U))) {
    assert.ok(Object.prototype.hasOwnProperty.call(S, k), 'UNLOCK 指向了不存在的剧本 ' + k)
  }
})

test('效果与 spec §7 对得上：reconcile +8 是最大、tease -3、giftIgnored -1', () => {
  const E = C.TUNING.EFFECT
  assert.equal(E.reconcile.affinity, 8)
  assert.equal(E.reconcile.familiarity, 2)
  assert.equal(E.tease.affinity, -3)
  assert.equal(E.giftIgnored.affinity, -1)
  assert.equal(E.giftIgnored.familiarity, 0)
  const effectKeys = Array.from(Object.keys(E)).filter((k) => k !== 'giftIgnored').sort()
  assert.deepEqual(effectKeys, SORTED_NAMES, '效果表去掉 giftIgnored 必须与 8 个剧本一一对应')
})

test('冷却表与剧本表一一对应（每个剧本都有冷却，没有多余条目）', () => {
  assert.deepEqual(Array.from(Object.keys(C.TUNING.COOLDOWN_SEC)).sort(), SORTED_NAMES)
  for (const k of SCRIPT_NAMES) assert.ok(C.TUNING.COOLDOWN_SEC[k] > 0, k + ' 的冷却必须为正')
})
