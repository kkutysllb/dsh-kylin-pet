# dsh-kylin-pet v2 · V3b 实施计划（心智 · 导演 · 8 个互动剧本）

**目标**：把两只宠从「各自跑链 + 偶发互怼」变成**两个各有心智的演员 + 一个导演**——意图由心智打分产出，合演由导演仲裁配对，账本由导演统一写。

**验收句**：在真浏览器里**观察到一个完整 Interaction 走完四阶段**（approach → open → exchange → settle），并且：
1. **同一剧本在冷却期内不会立刻第二次触发**（冷却是硬约束，不是概率）；
2. **账本随互动增长**（`GET /bond` 的 `affinity` 在该互动后按剧本表变化）；
3. **被用户拎起的宠退出社交**（拖住一只 → 断言导演不再为它配对，`abort` 路径被写进记忆）。

**依据**：spec §5（心智）/ §6（导演与 Interaction）/ §7（8 个剧本）/ §11.3（真浏览器取证）；V3 已交付的账本与 `queueBondEvent()`。

---

## 0. 与前几片的接缝（先说清）

| 依赖 | 来自 | 本片怎么用 |
|---|---|---|
| `queueBondEvent()` | V3 Task 5 | 导演**唯一**的账本写入口；本片不新增写入路径（spec §6） |
| `world.actors` / `a.play()` / `a.say()` / `a.setFacing()` | V1 | 剧本只允许用这四样 + 位移，**不许碰 DOM** |
| `react()`（V2 的诱因响应） | V2 Task 4 | 本片把「有资格就演」**替换为**「交给 Mind 打分再决定」——`react()` 改名 `deliverStimulus()`，行为由 Mind 裁决 |
| `CLIPS` 6 档 | V1 | 8 个剧本**全部**只能编排出这 6 档（spec §12 R1 的表现力天花板） |

**本片不改 host**：Mind/Director 全在 client（单文件、无 DOM 依赖的纯逻辑部分要能跨 realm 测）。

---

## 1. 契约（`src/shared/contract.js` 追加，client 逐字镜像）

### 1.1 意图表 `INTENTS`

```js
/** 意图族 → 候选。独处 4 个 + 社交 9 个 = 13 个候选（spec §5）。 */
export const INTENTS = Object.freeze({
  solo: ['idle', 'walk', 'nap', 'look'],
  social: ['approach', 'greet', 'gift', 'tease', 'comfort', 'shoulder', 'chase', 'reconcile', 'contest'],
})
```

### 1.2 调参表 `TUNING`（**只在一处调参**）

```js
/** 权重与门限。所有魔数只能出现在这里。 */
export const TUNING = Object.freeze({
  TICK_SEC: 1,                 // 与 /state 轮询对齐（spec §5：每拍约 1s）
  SOCIAL_RADIUS: 360,          // px：超出这个距离的社交候选改判为 approach 或淘汰
  NEAR_RADIUS: 150,            // px：算「已经在旁边」
  ENERGY_DRAIN: 0.012,         // 每拍衰减
  ENERGY_RECOVER: 0.02,        // 每拍恢复（sleep 时）
  MOOD_REGRESS: 0.01,          // 每拍向 0 回归（spec §4.5：缓慢回归）
  COOLDOWN_SEC: {              // 每个剧本的冷却（**同一对**之间）
    greet: 45, gift: 120, tease: 90, comfort: 150,
    shoulder: 180, chase: 90, reconcile: 300, contest: 120,
  },
  WEIGHT: {
    affinity: 0.02,            // 每点 affinity 对社交候选的加成
    familiarity: 0.01,         // 每点 familiarity 的加成
    moodMatch: 0.6,            // 候选与 mood 的匹配度
    energy: 0.8,               // 精力对独处候选的影响
    distance: 0.4,             // 距离惩罚
    jitter: 0.15,              // 抖动，防止两只永远同拍
  },
  UNLOCK: {                    // spec §7 的解锁条件
    gift: { familiarity: 3 },
    tease: { familiarity: 5 },
    shoulder: { affinity: 20 },
    reconcile: { affinityMax: -1 },
  },
  EFFECT: {                    // spec §7 的关系效果
    greet: { affinity: 2, familiarity: 1 },
    gift: { affinity: 3, familiarity: 1 },
    giftIgnored: { affinity: -1, familiarity: 0 },
    tease: { affinity: -3, familiarity: 1 },
    comfort: { affinity: 5, familiarity: 1 },
    shoulder: { affinity: 3, familiarity: 1 },
    chase: { affinity: 2, familiarity: 1 },
    reconcile: { affinity: 8, familiarity: 2 },
    contest: { affinity: 2, familiarity: 1 },
  },
  PHASE_TIMEOUT_SEC: { approach: 6, open: 2, exchange: 6, settle: 2 },
  MEMORY_MAX: 8,
})
```

---

## 2. 文件增量

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/shared/contract.js` | 改 | `INTENTS` / `TUNING` |
| `src/stage/client.js` | 改 | §Mind / §Director / §SCRIPTS 三层（仍是单文件） |
| `test/mind.test.mjs` | 新建 | 心智打分纯函数 |
| `test/director.test.mjs` | 新建 | 仲裁 / 动作槽 / Interaction 生命周期 |
| `test/scripts.test.mjs` | 新建 | 8 个剧本的解锁与效果表 |
| `test/client-v3b.test.mjs` | 新建 | 镜像契约一致性 + 跨 realm 可测的纯函数 |

**为什么只有 client + 测试**：spec §6 的铁律是「账本只有一条写入路径」，而心智/导演都是**演出决策**，没有宿主事实要接。一片全在 client 里，测试靠「把纯函数挂进 `__kylinContract` 后跨 realm 调」来覆盖 —— 这是 V2 已经验证过的手法。

---

## Task 1: 契约扩充（INTENTS + TUNING）

**Files:** Modify `src/shared/contract.js`、`test/contract.test.mjs`

按 §1 落盘两张表。`test/contract.test.mjs` 再折三条断言进既有块（**不新增 test 块**，计数不变）：
- `INTENTS.solo.length === 4 && INTENTS.social.length === 9`；
- `Object.keys(TUNING.COOLDOWN_SEC).length === 8`（**剧本数必须与 spec §7 的 8 个对得上**）；
- `Object.keys(TUNING.EFFECT).length === 9`（8 个剧本 + `giftIgnored` 这一条分支）。

Run: `npm test` → Expected: **84 pass / 0 fail**（V3 结束时的 84，计数不变）。

> ⚠️ **基线推移修正（2026-10-11）**：本 Task 执行时基线仍是 84；T2 之后基线变为 **97**（我并发提交的 `test/bible.test.mjs` 带来 3 例）。**T1 本身不需要修正。**）

---

## Task 2: 心智 Mind（`src/stage/client.js` 新增 §Mind；`test/mind.test.mjs`）

### Step 1: 写实现（插在 §4 世界 **之前**，因为世界要用它）

```js
/** 每只宠的心智状态。mood/energy 是连续量，recent 是环形记忆。 */
function createMind(petId) {
  return {
    petId: petId,
    mood: 0,            // [-1, 1]
    energy: 1,          // [0, 1]
    attention: 'free',  // free | drawn | focused
    recent: [],         // 最近 MEMORY_MAX 次互动（导演写，心智读）
    cooldown: {},       // 剧本名 -> 剩余秒
  }
}

/** 每拍推进：精力衰减 / 恢复、心情向 0 回归、冷却递减。**纯状态推进，不做决策**。 */
function stepMind(mind, dt) {
  const T = TUNING
  const asleep = mind.energy <= 0.15
  mind.energy = clamp(mind.energy + (asleep ? T.ENERGY_RECOVER : -T.ENERGY_DRAIN) * dt, 0, 1)
  mind.mood = clamp(mind.mood - Math.sign(mind.mood) * Math.min(Math.abs(mind.mood), T.MOOD_REGRESS * dt), -1, 1)
  for (const k of Object.keys(mind.cooldown)) {
    mind.cooldown[k] = Math.max(0, mind.cooldown[k] - dt)
    if (mind.cooldown[k] === 0) delete mind.cooldown[k]
  }
  return mind
}

/** 解锁判定（spec §7 的「解锁条件」列）。缺条件即恒可用。 */
function unlocked(candidate, bond) {
  const need = TUNING.UNLOCK[candidate]
  if (!need) return true
  if (need.familiarity !== undefined && bond.familiarity < need.familiarity) return false
  if (need.affinity !== undefined && bond.affinity < need.affinity) return false
  if (need.affinityMax !== undefined && bond.affinity > need.affinityMax) return false
  return true
}

/**
 * 门控（spec §5：**门控优先、再加权**）。返回淘汰原因，或 null 表示放行。
 * 顺序刻意：冷却 → 解锁 → 对方可响应性 → 距离。
 */
function socialGate(candidate, self, other, dist) {
  if (self.cooldown[candidate]) return 'cooldown'
  if (!unlocked(candidate, self.bond)) return 'locked'
  if (!other) return 'no-partner'
  if (other.held) return 'partner-held'
  if (other.busy) return 'partner-busy'          // 正在合演
  if (dist > TUNING.SOCIAL_RADIUS) return candidate === 'approach' ? null : 'too-far'
  if (candidate === 'comfort' && !(other.mood < -0.3)) return 'no-need'   // spec §7：对方 mood < -0.3
  if (candidate === 'reconcile' && !(self.bond.affinity < 0)) return 'locked'
  return null
}

/** 独处候选的打分：energy 低 → nap，mood 高 → walk。 */
function soloScore(candidate, self) {
  const W = TUNING.WEIGHT
  if (candidate === 'nap') return (1 - self.energy) * W.energy
  if (candidate === 'walk') return Math.max(0, self.mood) * W.moodMatch
  if (candidate === 'look') return (1 - Math.abs(self.mood)) * 0.3
  return 0.4 - Math.abs(self.mood) * 0.1          // idle 兜底
}

/** 社交候选的打分。affinity 越高越愿意社交，距离越远越不愿意。 */
function socialScore(candidate, self, other, dist) {
  const W = TUNING.WEIGHT
  const bond = self.bond || { affinity: 0, familiarity: 0 }
  let s = bond.affinity * W.affinity + bond.familiarity * W.familiarity
  if (candidate === 'comfort') s += Math.max(0, -other.mood) * 1.2      // 对方越难过越想安慰
  if (candidate === 'tease') s += Math.max(0, self.energy - 0.5) * 1.0
  if (candidate === 'shoulder') s += Math.max(0, bond.affinity) * 0.02
  if (candidate === 'approach') s += 0.5                                  // 靠近是社交的兜底
  s -= (dist / TUNING.SOCIAL_RADIUS) * W.distance
  return s
}

/**
 * 选一个意图。返回 `{ intent, family, score, gate }`。
 * **不修改任何状态**（决策与推进分离，才好测）。
 */
function chooseIntent(self, other, rng) {
  const T = TUNING
  const dist = other ? Math.hypot(other.x - self.x, other.y - self.y) : Infinity
  const cands = []
  for (const c of INTENTS.solo) cands.push({ intent: c, family: 'solo', gate: null, score: soloScore(c, self) })
  for (const c of INTENTS.social) {
    const g = socialGate(c, self, other, dist)
    cands.push({ intent: c, family: 'social', gate: g, score: g ? -Infinity : socialScore(c, self, other, dist) })
  }
  const live = cands.filter((c) => c.gate === null)
  // **死分支（执行期实测）**：solo 候选恒以 gate:null 入列，live 至少 4 个 ⇒ 这行**今天不可达**。
  // 保留是纵深防御（将来若 solo 也加门控，这里就活得过来），但**测试项「全部社交被淘汰时回 idle」
  // 测的其实是打分排序，不是这个分支** —— 别把它的绿当成这行的覆盖。
  if (live.length === 0) return { intent: 'idle', family: 'solo', gate: null, score: 0, all: cands }
  let best = live[0]
  for (const c of live) {
    const j = (rng() - 0.5) * T.WEIGHT.jitter
    if (c.score + j > best.score + (best._j || 0)) { best = c; best._j = j }
  }
  return { intent: best.intent, family: best.family, gate: null, score: best.score, all: cands }
}
```

> **抖动写在比较里、不写进返回值**：`jitter` 的作用是「防止两只永远同拍」（spec R7），但它不该污染可复现的断言。测试注入一个固定 `rng` 就能得到确定的解。

### Step 2: 测试 `test/mind.test.mjs`

把 `createMind` / `stepMind` / `unlocked` / `socialGate` / `chooseIntent` 挂进 `__kylinContract`（**纯函数、无 DOM**），跨 realm 调：
1. `stepMind`：`energy` 衰减到 0 后转为恢复；`mood` 向 0 回归且不越过 0；冷却递减并在归零时**被删除**（不是留一个 0）；
2. `unlocked`：`gift` 在 `familiarity=2` 时 false、`=3` 时 true；`reconcile` 在 `affinity=0` 时 false、`=-1` 时 true；未知候选恒 true；
3. `socialGate` 六种淘汰原因**各命中一次**（cooldown / locked / no-partner / partner-held / partner-busy / too-far），顺序也要对（冷却优先于解锁）；
4. `chooseIntent` 在「对方被拎起」时**绝不**返回社交意图；在全部社交被淘汰时回 `idle` 且 `all` 里能看到各自的 gate 原因；
5. **注入固定 rng 时结果可复现**（同输入两次调用同输出）—— 这条是「决策可测」的地基。

Run: `npm test` → Expected: **94 pass / 0 fail**（84 + 10）。

> ⚠️ **基线推移修正**：执行时基线已是 **97**，故实际应为 **97 + 10 = 107**？**不是。** —— T2 实测全量为 **97**、增量为 **10**、**排除 `bible.test.mjs` 后为 94**。本 Task 认的是**增量 10**，绝对数受并发提交影响。**以后一律以增量为准。**）

---

## Task 3: 导演 Director 与互动 Interaction（§Director）

### Step 1: 写实现

```js
/** 剧本的可见编排：每个阶段该做什么。剧本**只允许**用这些动作，不得碰 DOM。 */
const PHASES = ['approach', 'open', 'exchange', 'settle']

/**
 * 建一个导演。
 * 铁律（spec §6）：动作槽最多 1 个合演 + 每宠 1 个独演；仲裁败者**退回独处链，不报错不排队**；
 * 收尾唯一入口 —— 账本与记忆只在这里写。
 */
function createDirector(opts) {
  const world = opts.world
  const minds = opts.minds          // petId -> mind
  const model = opts.model          // { cooldowns, affinity, familiarity, ... } 由外部镜像
  const rng = opts.rng || Math.random
  const stick = opts.onStimulus || function () {}
  let duet = null                   // 当前唯一的合演
  let clock = 0                     // **导演自己的时钟**：只由 step(dt) 推进；时间戳一律显式传参，不塞进心智状态
  const memories = []               // { at, kind, actors, outcome }

  const pairKey = world.pairKey
  function bondOf() { return model.bond || { affinity: 0, familiarity: 0 } }

  /** 优先级 = |affinity| × 意图强度 × 新鲜度（spec §6）。这里用「上次同剧本距今越久越新鲜」。 */
  function priority(intent, mind, at) {
    const a = Math.abs(bondOf().affinity)
    const strength = mind.energy
    const last = (mind.recent || []).filter((r) => r.kind === intent).pop()
    const fresh = last ? clamp((at - last.at) / 300, 0, 1) : 1
    return a * strength * fresh + strength
  }

  /** 找一个可配对的对手：对方此刻空闲、没被拎起、且不是我自己。 */
  function freePartner(self) {
    for (const a of world.actors) {
      if (a === self.actor) continue
      if (a.held) continue
      if (a.busy) continue
      return a
    }
    return null
  }

  /** 开一场合演。**同一时刻只允许一场**（动作槽）。 */
  function open(initiatorActor, responderActor, kind, at) {
    if (duet) return null
    duet = {
      kind: kind,
      initiator: initiatorActor.pet.id,
      responder: responderActor.pet.id,
      phase: 'approach',
      deadline: TUNING.PHASE_TIMEOUT_SEC.approach,
      outcome: null,
      at: at,
    }
    initiatorActor.busy = true
    responderActor.busy = true
    return duet
  }

  /** 终局：写账本 + 双方记忆 + 冷却。**这是唯一写账本的地方**。 */
  function settle(kind, actorA, actorB, effectName, at) {
    const eff = TUNING.EFFECT[effectName] || { affinity: 0, familiarity: 0 }
    const ev = {
      pair: pairKey,
      kind: kind,
      affinityDelta: eff.affinity,
      familiarityDelta: eff.familiarity,
      at: at,
    }
    model.bond = {
      affinity: clamp(bondOf().affinity + eff.affinity, BOND.AFFINITY_MIN, BOND.AFFINITY_MAX),
      familiarity: Math.max(0, bondOf().familiarity + Math.max(0, eff.familiarity)),
    }
    for (const a of [actorA, actorB]) {
      if (!a) continue
      const m = minds[a.pet.id]
      if (!m) continue
      m.mood = clamp(m.mood + (eff.affinity > 0 ? 0.2 : eff.affinity < 0 ? -0.2 : 0), -1, 1)
      m.recent = m.recent.concat([{ kind: kind, at: at, delta: eff.affinity }]).slice(-TUNING.MEMORY_MAX)
      m.cooldown[kind] = TUNING.COOLDOWN_SEC[kind] || 60
    }
    memories.push({ kind: kind, at: at, affinity: eff.affinity })
    if (memories.length > 50) memories.shift()
    stick([ev])                     // ← V3 的 queueBondEvent：防抖 + PUT /bond，**不在这里**
    return ev
  }

  /** 中断：被用户拎走 / 超时。要**写记忆**（被谁打断是心智的输入）。 */
  function abort(reason) {
    if (!duet) return null
    const done = duet
    done.outcome = 'abort:' + reason
    for (const id of [done.initiator, done.responder]) {
      const m = minds[id]
      if (m) m.recent = m.recent.concat([{ kind: done.kind, at: done.at, delta: 0, aborted: reason }]).slice(-TUNING.MEMORY_MAX)
    }
    for (const a of world.actors) a.busy = false
    memories.push({ kind: done.kind, at: done.at, aborted: reason })
    duet = null
    return done
  }

  /** 每拍推进一次合演。返回本拍发生的事（给测试与取证观察）。 */
  function step(dt) {
    clock += dt                      // 时钟只在这里走
    const events = []
    for (const a of world.actors) {
      const m = minds[a.pet.id]
      if (m) stepMind(m, dt)
    }

    if (duet) {
      // 对手被拎走 ⇒ 立即中断（spec §6）
      const held = world.actors.find((a) => a.pet.id === duet.responder || a.pet.id === duet.initiator)
      if (held && held.held) { events.push({ type: 'abort', detail: abort('partner-held') }); return events }
      duet.deadline -= dt
      if (duet.deadline <= 0) { events.push({ type: 'abort', detail: abort('timeout') }); return events }
      const i = PHASES.indexOf(duet.phase)
      // 阶段推进由剧本的 phaseSignal 决定；这里只做兜底推进，避免卡死
      if (duet.advance) { duet.phase = PHASES[Math.min(PHASES.length - 1, i + 1)]; duet.deadline = TUNING.PHASE_TIMEOUT_SEC[duet.phase] }
      return events
    }

    // 没有合演：每只宠各选一个意图；社交意图要配对成功才升格为合演
    for (const a of world.actors) {
      if (a.held || a.busy) continue
      const m = minds[a.pet.id]
      if (!m) continue
      const other = freePartner(a)
      const pick = chooseIntent(m, other ? minds[other.pet.id] : null, rng)
      events.push({ type: 'intent', pet: a.pet.id, intent: pick.intent, family: pick.family })
      if (pick.family !== 'social' || !other) { a.play(pick.intent === 'walk' ? 'walk' : pick.intent === 'nap' ? 'idle' : 'idle'); continue }
      // 仲裁：两只都要同一场时才成；否则按优先级，败者退回独处链
      const mine = priority(pick.intent, m, clock)
      const theirs = priority(pick.intent, minds[other.pet.id], clock)
      if (theirs > mine) { a.play('idle'); continue }     // 败者退回独处链，不报错、不排队
      const created = open(a, other, pick.intent, clock)
      if (created) events.push({ type: 'open', detail: created })
      return events
    }
    return events
  }

  return {
    get duet() { return duet },
    get memories() { return memories.slice() },
    step: step, settle: settle, abort: abort, open: open,
    priority: priority, freePartner: freePartner,
  }
}
```

> **两处刻意留白，实施时按剧本表补**：① `duet.advance` 的判据来自剧本表（每个阶段一个 `until` 谓词），本 Task 只给骨架；② `a.busy` 的清除必须在 `settle` 与 `abort` **两条路**上都发生 —— 只清一条会让宠永久卡住，测试要专门盯这一条。

### Step 2: 测试 `test/director.test.mjs`

1. **动作槽**：连续 `open` 两次 → 第二次回 `null`（同一时刻只有一场合演）；
2. `settle` **改了账本**（`model.bond` 按效果表变化）、**给双方都上了冷却**、**双方记忆各多一条**；
3. `abort('partner-held')` 与 `abort('timeout')` 两条路都**清掉 `busy`**（断言全部 `a.busy === false`）—— 这条是本任务最容易漏的；
4. `priority` 的顺序性：`|affinity|` 大者胜；同 affinity 时 `energy` 高者胜；
5. `freePartner` 不会返回**被拎起**或 `busy` 的宠；
6. `settle` 调用了注入的 `stick`（账本写入是**经由**它的，导演不自己发请求）。

Run: `npm test` → Expected: **106 pass / 0 fail**（97 + 9）。原写「103（94 + 9）」是按旧基线；**基数已推移到 97**。）

---

## Task 4: 8 个剧本（`§SCRIPTS` 声明式编排表 + `LINES` 原创文案表）

**Files:** Modify `src/stage/client.js`（新增 §SCRIPTS / §LINES）；Create `test/scripts.test.mjs`

### Step 1: 编排表（**声明式**：剧本是数据，不是代码）

> 为什么必须是数据：spec §12 R1 说「表现力天花板 = 6 段美术」，而**唯一有效的扩展杠杆是补美术**。
> 只要剧本是表，补片就只改 `CLIPS`（V1 的档位表），**剧本代码零改动**。把剧本写成一堆 `if` 就毁掉这条。

```js
/**
 * 8 个剧本的编排表（spec §7）。每阶段只允许三件事：
 *   clip  —— 播哪一档（**必须**来自 CLIPS 的 6 档之一）
 *   say   —— 冒哪句气泡（来自 LINES）
 *   move  —— 谁朝谁走近（approach / contest 用）
 * `until` 是阶段推进谓词名，实现见 §Director 的 ADVANCE。
 */
const SCRIPTS = Object.freeze({
  greet: {
    effect: 'greet',
    phases: {
      approach: { clip: 'walk', move: 'toward', until: 'near' },
      open:     { clip: 'turn', facing: 'toward', until: 'turned' },
      exchange: { clip: 'happy', say: 'greet', until: 'once' },
      settle:   { clip: 'idle', until: 'immediate' },
    },
  },
  gift: {
    effect: ['gift', 'giftIgnored'],      // 对方接不接受是 Outcome；两条 effect 由 exchange 的结果选
    phases: {
      approach: { clip: 'walk', move: 'toward', until: 'near' },
      open:     { clip: 'happy', say: 'gift', until: 'once' },
      exchange: { clip: 'turn', until: 'once' },          // 对方开心或无视，表现相同、账本不同
      settle:   { clip: 'idle', until: 'immediate' },
    },
  },
  tease: {
    effect: 'tease',
    phases: {
      approach: { clip: 'walk', move: 'toward', until: 'veryNear' },
      open:     { clip: 'turn', facing: 'away', say: 'tease', until: 'turned' },
      exchange: { clip: 'sad', who: 'responder', until: 'once' },   // 只有**对方**难过（spec §7）
      settle:   { clip: 'idle', until: 'immediate' },
    },
  },
  comfort: {
    effect: 'comfort',
    phases: {
      approach: { clip: 'walk', move: 'toward', until: 'near' },
      open:     { clip: 'idle', say: 'comfort', until: 'once' },
      exchange: { clip: 'happy', who: 'responder', until: 'once' },
      settle:   { clip: 'idle', until: 'immediate' },
    },
  },
  shoulder: {
    effect: 'shoulder',
    phases: {
      approach: { clip: 'walk', move: 'toward', until: 'near' },
      open:     { clip: 'idle', facing: 'toward', until: 'immediate' },
      exchange: { clip: 'idle', until: 'hold3s' },                  // 相向而立，呼吸相位错开
      settle:   { clip: 'idle', move: 'apart', until: 'once' },
    },
  },
  chase: {
    effect: 'chase',
    phases: {
      approach: { clip: 'walk', move: 'toward', until: 'veryNear' },
      open:     { clip: 'walk', say: 'chase', until: 'once' },
      exchange: { clip: 'walk', until: 'hold4s' },                  // 位置驱动：撞边界换向
      settle:   { clip: 'idle', until: 'immediate' },
    },
  },
  reconcile: {
    effect: 'reconcile',
    phases: {
      approach: { clip: 'walk', move: 'toward', until: 'near' },
      open:     { clip: 'sad', say: 'reconcile', until: 'once' },
      exchange: { clip: 'happy', say: 'gift', until: 'once' },      // 主动 + 献宝（spec §7）
      settle:   { clip: 'idle', until: 'immediate' },
    },
  },
  contest: {
    effect: 'contest',
    phases: {
      approach: { clip: 'walk', move: 'point', until: 'arrived' },  // 双方冲向同一点
      open:     { clip: 'turn', say: 'contest', until: 'once' },
      exchange: { clip: 'happy', who: 'winner', until: 'once' },    // 先到者得
      settle:   { clip: 'idle', until: 'immediate' },
    },
  },
})

> **⚠️ 命名冲突，必须先处理**：`client.js` 现在**已经有一个 `LINES`** —— 那是 V2 的诱因面文案表（`{ 'turn-ok': '稳了', 'turn-fail': '让我想想', waiting: '在呢' }`）。
> 本 Task 引入的是**剧本**文案表。**先把既有的那张改名 `LINES_STIMULUS`**（Task 5 Step 3 引用的就是这个名字），`LINES` 让给剧本表。
> 不改名就是同文件重复声明 —— 直接语法错误。（2026-10-11 写计划时自查发现。）

/** 文案表：剧本 × 角色。**全原创**（不带任何上游措辞），V4 可顺势换表情包图。 */
const LINES = Object.freeze({
  greet:     { kylinzi: '来啦',     xisha: '嗯' },     // 「在呢」与 waiting 撞句，已拆
  gift:      { kylinzi: '看看这个', xisha: '……谢谢' },
  tease:     { kylinzi: '略',       xisha: '……' },
  comfort:   { kylinzi: '别难过',   xisha: '我没事' },
  chase:     { kylinzi: '别跑',     xisha: '你追不上' },
  reconcile: { kylinzi: '我错了',   xisha: '……算了' },
  contest:   { kylinzi: '我先',     xisha: '我先' },
})
```

> **`shoulder` 没有台词**，这是刻意的：并肩是**无言的亲近**，而且它最容易与 `greet` 混同 —— 靠台词区分是最省的做法，但这里要靠**时长**（`hold3s`）与**移动**（`apart`）区分。

### Step 2: 阶段推进谓词 `ADVANCE`（补 Task 3 的 `duet.advance` 骨架）

```js
/** 谓词：给 (duet, world, dt) 判「本阶段结束了吗」。全部是**纯读**，不改状态。 */
const ADVANCE = {
  near:      (d, w) => dist(d, w) <= TUNING.NEAR_RADIUS,
  veryNear:  (d, w) => dist(d, w) <= TUNING.NEAR_RADIUS * 0.6,
  turned:    (d, w) => w.sincePhase >= 0.4,        // 转身动作放完约 0.4s
  once:      (d, w) => w.sincePhase >= 0.6,        // 一次性档播完就够
  immediate: (d, w) => w.sincePhase >= 0.2,
  hold3s:    (d, w) => w.sincePhase >= 3.0,
  hold4s:    (d, w) => w.sincePhase >= 4.0,
  arrived:   (d, w) => w.sincePhase >= 1.5,        // 争抢：谁先到由 world 的位置比较决定，这里只做兜底
}
```

### Step 3: 测试 `test/scripts.test.mjs`

1. **每个剧本都以 `approach` 开头、以 `settle` 收尾**（四阶段完整，不许缺）；
2. **每个 `clip` 都在 `CLIPS` 的 6 档里**（用一个「遍历全部剧本的全部阶段」的循环断言）—— 这条直接防住「剧本写了没有的美术档」；
3. **每个 `until` / `facing` / `move` / `who` 都在 `ADVANCE` 或白名单里有定义**（拼错名字要能被抓住）；
4. **每个 `say` 在 `LINES` 里有对应词条**；`LINES` 的每个键都能在 `SCRIPTS` 里找到（双向对账，防止留下死文案）；
5. **解锁条件与 spec §7 对得上**：`gift` 要 `familiarity>=3`、`tease` 要 `>=5`、`shoulder` 要 `affinity>=20`、`reconcile` 要 `affinity<0`（与 `TUNING.UNLOCK` 交叉核对）；
6. **效果与 spec §7 对得上**：`reconcile` 的 affinity 增量是 **8**（最大的那个，别抄错）；`tease` 是 **−3**；`giftIgnored` 是 **−1**。

Run: `npm test` → Expected: **117 pass / 0 fail**（106 + 11）。原写「114（103 + 11）」是按旧基线。）

---

## Task 4b: **阶段执行器**（补 Task 3/4 缺掉的一整块 —— **没有它，V3b 跑不起来**）

**Files:** Modify `src/stage/client.js`；Create `test/phase.test.mjs`

> **曾经的顾虑与它的结局**（2026-10-11 执行期）：Step 2 原本要求给 `duet` 加 `sincePhase`，而 Task 3 落下的 `test/director.test.mjs` 里有一条**逐字段比较 `duet` 对象**的断言（`canon` 钉死形状）—— 加字段就会打红它。当时 Lead 的处置是「把该测试文件纳入本 Task 写入范围，往期望对象里补 `sincePhase: 0`」。
>
> **实际执行时选了更好的解法**（见 Step 2 的修正）：`open()` 不加字段，`sincePhase` 由 `runDuet` 惰性补上。于是那条断言**一个字都不用改**，它的判别力完整保留。**本 Task 因此不需要动 `test/director.test.mjs`。**
>
> 记在这里是因为：**「把测试改成迁就实现」应当是最后手段**。当冲突来自「新字段 vs 钉死形状的断言」时，先问一句「这个字段真的属于那个对象吗」—— `sincePhase` 属于阶段推进，不属于开场，所以它不该进 `open()` 的返回值。

### 为什么有这一节

Task 3 的 `step()` 里写的是 `if (duet.advance) { ...兜底推进... }`，而**全仓没有任何地方给 `duet.advance` 赋值** —— Task 3 注释①说「本 Task 只给骨架」，Task 4 Step 2 说「补 Task 3 的骨架」，但 Step 2 只给了 `ADVANCE` 谓词表。后果：

- 该分支**永远为假** ⇒ 阶段永不推进 ⇒ 撞 `PHASE_TIMEOUT_SEC.approach` 被 `abort('timeout')`；
- `settle()` **一次都不会被调用** ⇒ 账本永不增长、冷却永远是空的 ⇒ **Task 6 的三条验收句全部无法达成**。

> **执行期实测证据**（只读探针，`open` 后连续 `step` 8 秒）：出现过的阶段集合 = `["approach"]`；t≈6.1s 撞 deadline 被 `abort('timeout')`；`memories = [{kind:"greet", aborted:"timeout"}]`。

### Step 1: `ADVANCE` 的时间谓词读错了对象

`turned / once / immediate / hold3s / hold4s / arrived` 读的是 `w.sincePhase`，而 `world` **没有** `sincePhase`（只有 `near/veryNear` 真的要用世界算距离）。改成读合演自己的 `d.sincePhase`：

```js
const ADVANCE = {
  near:      (d, w) => dist(d, w) <= TUNING.NEAR_RADIUS,
  veryNear:  (d, w) => dist(d, w) <= TUNING.NEAR_RADIUS * 0.6,
  turned:    (d) => d.sincePhase >= 0.4,
  once:      (d) => d.sincePhase >= 0.6,
  immediate: (d) => d.sincePhase >= 0.2,
  hold3s:    (d) => d.sincePhase >= 3.0,
  hold4s:    (d) => d.sincePhase >= 4.0,
  arrived:   (d) => d.sincePhase >= 1.5,
}
```

> `d` = 合演，`w` = 世界，**两个形参各有各的用处**。原文把时间判据也写成 `w.sincePhase`，才让人没注意到 `sincePhase` 在整个仓里根本不存在。

### Step 2: `sincePhase` 由**执行器**惰性补上，**`open()` 的形状不变**

> **执行期修正（2026-10-11，实施子代理提出，Lead 采纳）**：本节原写「在 `open()` 的 `duet` 字面量里补 `sincePhase: 0`」。但 Task 3 落下的 `test/director.test.mjs` 用 `canon` **逐键钉死**了 `open()` 返回对象的形状（不含 `sincePhase`）—— 加进去就会打红它。
>
> 采纳的解法（**比原写法更好**）：`open()` 保持原样，`sincePhase` 由 `runDuet` 第一拍惰性补上：

```js
// open() 不变。runDuet 里：
if (duet.sincePhase === undefined) duet.sincePhase = 0
if (duet.sincePhase === 0) enterPhase(spec, actorA, actorB)
duet.sincePhase += dt
```

> **为什么这样更好**：`sincePhase` 是**阶段推进**的账，不是**开场**的账。`open()` 的返回值因此保持成一个干净的「刚开场时的样子」契约，而 Task 3 那条「逐键钉死」的断言也就**保住了它全部的判别力**——它是本片里少数几条能发现「对象形状悄悄变宽」的断言，**不该为了新字段去放松它**。
>
> 安全前提：`ADVANCE` 只被 `runDuet` 调用，而它在读 `sincePhase` 之前一定先初始化过 ⇒ 不存在 `undefined >= 0.4` 恒假的路径。

### Step 3: 阶段执行器本体

```js
/** 按 id 找演员；找不到回 null（不抛）。 */
function actorById(id) { return world.actors.find((a) => a.pet.id === id) || null }

/** 本阶段的声明；剧本或阶段缺失回 null。 */
function phaseSpec(kind, phase) {
  const s = SCRIPTS[kind]
  return s && s.phases ? (s.phases[phase] || null) : null
}

/** 进入新阶段的一次性动作：播片 / 设朝向 / 放台词 / 起步。只在 sincePhase === 0 那一拍做。 */
function enterPhase(spec, actorA, actorB) {
  if (spec.clip) {
    if (actorA) actorA.play(spec.clip)
    if (actorB && spec.clip === 'happy') actorB.play(spec.clip)
  }
  if (spec.facing === 'toward' && actorA && actorB) actorA.setFacing(actorB.x < actorA.x ? -1 : 1)
  if (spec.say) {
    const line = LINES[spec.say]
    if (line && actorA) actorA.say(typeof line === 'string' ? line : (line[actorA.pet.id] || line[actorB.pet.id] || ''))
  }
  if (spec.move === 'toward' && actorA && actorB) {
    const gap = ASSET.W * 0.28
    actorA.target = { x: actorB.x + (actorA.x <= actorB.x ? gap : -gap), y: actorB.y }
  }
}

/** 推进一拍。返回 'settled' / 'aborted' / null（仍在演）。 */
function runDuet(dt) {
  const actorA = actorById(duet.initiator)
  const actorB = actorById(duet.responder)
  const spec = phaseSpec(duet.kind, duet.phase)
  if (!spec) { abort('no-phase'); return 'aborted' }
  if (duet.sincePhase === 0) enterPhase(spec, actorA, actorB)
  duet.sincePhase += dt
  const done = spec.until && ADVANCE[spec.until] ? ADVANCE[spec.until](duet, world) : true
  if (!done) return null
  const i = PHASES.indexOf(duet.phase)
  if (i < PHASES.length - 1) {
    duet.phase = PHASES[i + 1]
    duet.sincePhase = 0
    duet.deadline = TUNING.PHASE_TIMEOUT_SEC[duet.phase]
    return null
  }
  const script = SCRIPTS[duet.kind]
  const eff = Array.isArray(script.effect)
    ? (bondOf().affinity >= 0 ? script.effect[0] : script.effect[1])
    : script.effect
  settle(duet.kind, actorA, actorB, eff, clock)
  duet = null
  return 'settled'
}
```

> **duet = null 不能省。** `settle()` 的实现里**从头到尾没有碰过 `duet`**（`abort` 清了，`settle` 没清 —— 计划的一处不对称）。不清的后果是**动作槽被永久占用**，之后 `open()` 的 `if (duet) return null` 恒成立 ⇒ **整局只可能发生一场合演**。
> 必须有一条测试盯它：**结算之后 `duet` 为 null，且能再开一场**。

### Step 4: `step()` 的合演分支接上执行器 + 修 D3

```js
if (duet) {
  // D3 修正：必须先筛「被拎起的」，再判断它是不是本场两只之一。
  // 原文 find((a) => a.pet.id === duet.responder || a.pet.id === duet.initiator)
  // 返回的是数组里第一个匹配任一 id 的 actor —— 实际只检查了一只，
  // 拎起另一只不会中断（执行期实测：拎 responder → events=[]，duet 仍在）。
  const held = world.actors.find((a) => a.held && (a.pet.id === duet.responder || a.pet.id === duet.initiator))
  if (held) { events.push({ type: 'abort', detail: abort('partner-held') }); return events }
  duet.deadline -= dt
  if (duet.deadline <= 0) { events.push({ type: 'abort', detail: abort('timeout') }); return events }
  const r = runDuet(dt)
  if (r) events.push({ type: r === 'settled' ? 'settle' : 'abort', detail: r })
  return events
}
```

### Step 5: 心智必须带上位置（**否则永远开不了合演**）

`chooseIntent` 用 `mind` 的位置算距离，而 `createMind()` 只有 `mood/energy/attention/recent/cooldown/bond` —— **没有 `x/y`**。于是 `dist` 恒为 `NaN` ⇒ 所有社交候选 `score` 为 `NaN` ⇒ 永不入选 ⇒ 两只永远 `intent:"idle"`。

> **执行期实测**：只给 `m.x/m.y` 补上（镜像 actor 位置）后，同一场景立刻变成 `intent:"shoulder", family:"social"` 并成功 `open`。

所以 Task 5 Step 1 的建心智循环要加上位置，并在每拍同步：

```js
for (const a of world.actors) {
  const m = createMind(a.pet.id)
  m.bond = bondFor(a.pet.id)
  m.x = a.x; m.y = a.y            // chooseIntent 靠它算距离；缺了就 NaN
  minds[a.pet.id] = m
}
// 主循环里 world.step 之后同步
for (const a of world.actors) { const m = minds[a.pet.id]; if (m) { m.x = a.x; m.y = a.y } }
```

### Step 6: 测试 `test/phase.test.mjs`

1. **四阶段真的走完**：注入「两只相邻、冷却为空、关系够解锁」的场景，逐拍 `step(1/60)` 直到 `duet` 为 null，断言**观察到的阶段序列 = `['approach','open','exchange','settle']`**（顺序与完整性都要，不能只有首尾）；
2. **`settle` 恰好一次**：`stick` 恰好收到 1 条事件；`memories` 恰好 +1；
3. **`duet` 清空且槽位可复用**：结算后 `open()` 能再成功一次；
4. **`busy` 两条路都清**：`settle` 后两只 `busy === false`；`abort` 后同样；
5. **D3 修正承重**：分别拎起 initiator 与 responder，**两次都要 abort**（修正前会红一半）；
6. **`gift` 的两条 effect 由关系选**：affinity ≥ 0 走 `gift`、< 0 走 `giftIgnored`，断言账本增量分别等于表里的值；
7. **超时兜底仍在**：把某阶段谓词改成永不满足，断言在 `PHASE_TIMEOUT_SEC` 后 `abort('timeout')`（不是永久卡死）；
8. **`phaseSpec` 缺阶段时不抛**：剧本存在但阶段缺失 ⇒ `abort('no-phase')`。

Run: `npm test` → Expected: **125 pass / 0 fail**（117 + 8）。**负对照**：删掉 `runDuet` 里那句 `duet = null` ⇒ 测试 3 必须红。

### 裁决记录（回子代理的三个问题）

1. **`settle` 是否清 `duet`** —— **必须清**，但**清在执行器里**（`runDuet`）而不是 `settle` 里：`settle` 的签名收的是显式 actor 与 effect 名，它跟「当前有没有一场合演」是解耦的；把槽位释放放在「谁推进了阶段」那里，职责更清楚。**并且必须有一条测试盯住「结算后能再开一场」** —— 那是「整局只发生一场」这个 bug 的唯一防线。
2. **`LINES` 进 `__kylinContract`** —— **接受**。Task 4 的 `say ⟷ LINES` 双向对账需要跨 realm 读取口；Task 5 Step 5 的清单漏了它，是清单的疏漏。
3. **D3/D4/D5 是否另起一片** —— **D4 就是本节**（阶段执行器整块缺失，不是补丁）；**D3 在 Step 4、D5 在 Step 5**，都并进本片。**不另起小片**：它们三个的共同效果是「让合演真的跑起来」，拆成三片只会让每一片都跑不到绿。

---

## Task 4c: **意图 ≠ 剧本**（阻断 Task 6 的语义缺陷）

**Files:** Modify `src/stage/client.js`、`test/phase.test.mjs`

### 为什么有这一节

Task 3 的 `step()` 里：`open(a, other, pick.intent, clock)` —— **把意图名当剧本名用**。而：

```
INTENTS.social = ['approach','greet','gift','tease','comfort','shoulder','chase','reconcile','contest']   // 9 个
SCRIPTS        =  greet,   gift,  tease, comfort,  shoulder,  chase,  reconcile, contest                 // 8 个
```

`approach` **没有剧本**。执行期只读探针实测（raw）：

| 场景 | 观测 |
|---|---|
| aff=0（新装）、4000 拍 | **opens = []** —— 一场合演都不发生（`idle 0.4` 大于 `approach 0.389`） |
| aff=20 | `opens` 全是 `approach`，每场都是**开一拍 → 下一拍 `abort('no-phase')`**；abort **不上冷却** ⇒ 每两拍循环一次，永远不停 |
| aff=30 | `shoulder` 终于赢（`0.889` 大于 `0.789`），真走完四阶段并 settle（+3）；但结算后 shoulder 进 180s 冷却 ⇒ **立刻退回 approach 空转** |

⇒ **8 个剧本里 7 个从心智不可达**；Task 6 的验收句「`memories` 从 0 变 1 并断言四阶段」**要么永不触发，要么被一次 abort 触发**（阶段集合 = `approach`）。

### Step 1: 没有剧本的意图**不许开合演**

在 `step()` 的仲裁之前插一道门：

```js
// 意图名 ≠ 剧本名。approach 是「走过去」这个前导动作，SCRIPTS 里没有它。
// 没有剧本就**不开合演** —— 否则会 open 一个不存在的剧本，下一拍 abort('no-phase')，
// 而 abort 不上冷却 ⇒ 每两拍空转一次（执行期实测）。
if (!SCRIPTS[pick.intent]) {
  if (pick.intent === 'approach' && other) {
    a.target = { x: other.x, y: other.y }
    a.play('walk')
  } else {
    a.play('idle')
  }
  continue
}
```

> 这道门是**按能力开的，不是按名字开的**（判据是 `SCRIPTS[pick.intent]` 而不是 `=== 'approach'`）—— 将来加了意图却忘了配剧本，它同样挡得住。

### Step 2: `approach` 的打分要与距离**同向**

`socialScore` 现在给它一个**固定**的 `+0.5` —— 近处也赢。修好 Step 1 之后，它只是从「空转」变成「站在原地一直想走过去」，8 个剧本仍然抢不到。

```js
if (candidate === 'approach') {
  // 只按「值不值得过去」打分：越远越想过去，已经在身边就没有「过去」可言。
  // 因此它**不参与**下面的距离惩罚 —— 那条惩罚与它的语义正好相反。
  return 0.5 * Math.min(1, dist / TUNING.SOCIAL_RADIUS)
}
```

> 改完的分界（`W.affinity = 0.02`、`W.distance ≈ 0.4`，均由实测反推）：近处（dist≈100）`approach = 0.139` **输给** `idle 0.4`；远处（dist≈360）`approach = 0.5` **赢过** idle ⇒ 两只离得远时会互相走近，**走近之后才是真剧本的舞台**。
> aff=20 时 `shoulder 0.689` > idle 0.4 ⇒ **真剧本开始赢**，四阶段随之走完、settle、上冷却。

### Step 3: 测试（加进 `test/phase.test.mjs`）

1. **没有剧本的意图不开合演**：构造 `pick.intent = 'approach'` 且距离够近的一拍，断言 `open` **未被调用**（`duet` 仍为 null），且该 actor 拿到了 `target` 或播了 `walk`；
2. **不再有 `no-phase` 空转**：让场景自然跑 2000 拍，断言 `memories` 里**没有一条** `aborted === 'no-phase'`（修正前这条必红 —— 每两拍产生一条）；
3. **approach 随距离单调**（**从公开边界观测，不要直接调 `socialScore`**）：`socialScore` **不在 `__kylinContract` 里**（契约只有 `createMind/stepMind/unlocked/socialGate/chooseIntent/createDirector/SCRIPTS/ADVANCE/LINES`），跨 realm 的测试根本够不到它。所以改成用 `chooseIntent` 观测：
   - `affinity = 0`、距离 `360`（= `SOCIAL_RADIUS`）⇒ 返回 `intent === 'approach'`（远处想过去）；
   - `affinity = 0`、距离 `60` ⇒ 返回 `intent !== 'approach'`（就在身边就没有「过去」可言）。
   这条比直接比数值**更强**：它测的是导演真正消费的那个出口。
4. **贴近时真剧本能赢**：`affinity = 20`、`dist ≈ 100` 下 `chooseIntent` 返回的 `intent` **必须是 `SCRIPTS` 里的键**（修正前会回 `approach`）；
5. **端到端**：`affinity = 30`、自然跑 3000 拍，断言 `memories` 里**至少有一次正常收尾**（不带 `aborted`）且 `kind` 是 8 个剧本之一。

Run: `npm test` → Expected: **130 pass / 0 fail**（125 + 5）。**负对照**：把 Step 1 那道门删掉 ⇒ 测试 2 必须红（`no-phase` 空转回来）。

### 记一笔：Task 4b 的负对照锚点原先**不承重**（子代理发现，重要）

Task 4b 计划写「删掉 `duet = null` ⇒ **测试 3 必须红**」。实测：**朴素版测试 3 不会红** —— 因为「逐拍跑到 `duet` 为 null」这种驱动方式里，末阶段的 `deadline`（2s）会兜底 `abort('timeout')` 把槽位清掉，**漏写的 `duet = null` 被 deadline 掩盖了**。

修法：加 `driveToSettle()` —— **推进到第一拍 settle 事件就停**，不借 deadline 兜底，然后在**结算那一拍**断言 `duet === null`。改完 NC 才真红（`122 pass / 3 fail`）。

> **教训：「最终状态对不对」这种断言，会被任何一条兜底路径满足。**
> 想守住「什么时候释放」，就必须有一个**不经过兜底**的观测口。
>
> 这与本仓反复出现的那一类问题同源：`minGap` 断言被点击路径满足、`after === before` 两边都是 `null` 也绿、取键失败时 `0 === 0` 判「一致」。
> **断言必须能区分「正路走通」和「兜底兜住」。**

---

## Task 5: 接回主循环（`src/stage/client.js`）

**Files:** Modify `src/stage/client.js`、`test/client-contract.test.mjs`；Create `test/client-v3b.test.mjs`

### Step 1: 心智与导演进世界

```js
/* 在 createWorld 之后、start 的主循环之前建起来（V3 已经读过 /bond）。 */
const minds = {}
for (const a of world.actors) {
  const m = createMind(a.pet.id)
  m.bond = bondFor(a.pet.id)        // V3 读回的账本快照；读不到就是 {affinity:0, familiarity:0}
  minds[a.pet.id] = m
}

> **⚠️ 硬要求（执行期对账发现的潜在崩溃）**：`createMind()` 的字面量里**没有 `bond`**，而 `unlocked(candidate, bond)` 直接读 `bond.familiarity`、`socialGate` 直接读 `self.bond.affinity` ——
> **任何没有 `bond` 的心智走到 `chooseIntent` 都会抛 `TypeError`**（实测 `client.js:448-455 / 461-471`）。
>
> 所以本 Task 必须做到**两件**，缺一不可：
> 1. 上面这段循环**在导演第一次 `step` 之前**给每只宠都赋上 `bond`（顺序不能反）；
> 2. **给 `createMind` 的字面量补一个默认 `bond: { affinity: 0, familiarity: 0 }`** —— 让「心智永远有 bond」成为**类型级的不变式**，而不是靠调用方记得赋值。
>    这样即使将来有人先建心智、后读账本（或账本读取失败），也只是走 0/0 的中性关系，而不是崩。
>
> 并补一条测试：**刚 `createMind` 出来、尚未赋 bond 的心智，直接调 `chooseIntent` 不许抛**（断言返回一个合法意图，且社交候选的 gate 原因是 `locked` 而非异常）。
const director = createDirector({
  world: world,
  minds: minds,
  model: { bond: bondFor('*') },    // 双方共用一对账本：pairKey 已由 V3 定好
  rng: Math.random,
  onStimulus: queueBondEvent,       // ← V3 的防抖写入口；导演**不自己发请求**
})
```

### Step 2: 主循环交给导演（**`world.step` 之后、`requestAnimationFrame` 之前**）

```js
const frame = (now) => {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  if (!document.hidden) {
    world.step(dt)                  // V1 的位移权威：位置仍然只由世界改
    director.step(dt)               // V3b 的演出权威：意图与合演
  }
  requestAnimationFrame(frame)
}
```

> **顺序是语义**：先 `world.step`（位置落定）再 `director.step`（基于落定后的位置做决策）。反过来会让导演读到上一帧的位置，合演触发看起来「慢半拍」。

### Step 3: V2 的 `react()` 改名 `deliverStimulus()`，行为改为「交给心智」

V2 是「有资格就演」。spec §8 要求的是「**诱因 → 心智消化**」，所以：

```js
/** 诱因不再直接点播动画，而是**推动心智状态**；下一拍由导演决定这只宠要做什么。 */
function deliverStimulus(stimulus) {
  const ids = qualified(stimulus.kind, config)
  const touched = []
  for (const id of ids) {
    const m = minds[id]
    const a = world.actors.find((x) => x.pet.id === id)
    if (!m || !a || a.held) continue
    if (stimulus.kind === 'turn-ok') { m.mood = clamp(m.mood + 0.35, -1, 1); m.energy = clamp(m.energy + 0.1, 0, 1) }
    if (stimulus.kind === 'turn-fail') { m.mood = clamp(m.mood - 0.45, -1, 1) }
    if (stimulus.kind === 'waiting') { m.attention = 'drawn'; a.say(LINES_STIMULUS.waiting) }
    touched.push(id)
  }
  return touched
}
```

### 插入地图（**以 `4343904` 为准的行号；行号会漂，锚点不会 —— 以锚点为准**）

| 要改的地方 | 当前行 | **锚点（认这个）** | 动作 |
|---|---|---|---|
| 建 `minds` + `createDirector` | `1014` 之后 | `const world = createWorld({ config: config, root: root })` 的下一行 | Step 1 插入 |
| 导演进主循环 | `1021` | `if (!document.hidden) world.step(dt)` | 其后加 `director.step(dt)` |
| 删除旧 `react()` | `905-917` | `/** V2 占位：有资格就演。 */` 起、到该函数结束 | 删除 |
| `world` 返回对象去掉 `react` | `920` | `return { actors: actors, step: step, ... react: react, ... }` | 去掉 `react: react,` |
| 调用点换成 `deliverStimulus(s)` | `1036` | `for (const s of (body && body.stimuli) || []) world.react(s)` | Step 3 |

> `CLIP_OF`（`:901`）在 `react` 删除后可能变成死代码 —— **本片不动它**，留给 V4 收口时清理（删与不删都不影响行为，但别在同一片里混两种改动）。

**⚠️ 改名必须同时处理三处引用 + 一次作用域迁移（漏任何一处都会 TypeError 或 ReferenceError）**

旧 `react()` 定义在 `createWorld` **内部**（`client.js:637`）。而 `deliverStimulus` 要读 `minds` —— `minds` 建在 `start()` 里（见 Step 1），**不在 `createWorld` 的作用域内**。所以**不能原地改名**，必须把它**搬到 `start()` 里**（那里同时有 `minds` 和 `world.actors`）：

1. **删除** `createWorld` 内的 `react()` 定义（`client.js:637-649`）；
2. **删除** `world` 返回对象里的 `react` 键（`client.js:651`）—— 不要改名保留，`deliverStimulus` 不再属于世界；
3. 把 `deliverStimulus` **定义在 `start()` 里**（Step 1 的 `minds` 之后）；
4. **唯一的调用点**（`client.js:772`，`/state` 轮询里）：`world.react(s)` → **`deliverStimulus(s)`**（不是 `world.deliverStimulus`）。

> 2026-10-11 预检：旧签名在仓内**只此三点引用**（定义 `:637`、返回对象 `:651`、调用点 `:772`），测试里零引用 —— 所以这次搬动是封闭的，没有别的调用方要改。
> **为什么选「搬出去」而不是「把 minds 传进 createWorld」**：`deliverStimulus` 只碰 `minds` 与 `world.actors` 两样，而 `start()` 两样都有；反过来给世界多塞一个心智依赖，会让「世界只管位移」这条边界变浑。

> **这条改动的可观测差别**：V2 里注入 `agent/error` 会**立刻**看到宠换难过档；V3b 里同一注入只改 `mood`，**下一拍**才由心智决定演什么（可能先安慰、也可能继续散步——取决于 `TUNING`）。
> **取证必须能分辨这两者**，否则「改成心智了」这句话没有证据（Task 6 的验收句之一就是盯这个）。

### Step 4:（**已被 V3 提前完成 —— 本步只核对，不要重写**）

> **2026-10-11 预检发现本步是陈旧的**：V3 的 Task 5 已经把它做了 —— `client.js` 里已有 `curiosityOf(affinity)`，且 `release()` 里已经是：
>
> ```js
> if (mate && !mate.held && Math.random() < curiosityOf(bondState.affinity)) { ... }
> ```
>
> 差别只在数据来源：计划写的是 `minds[a.pet.id].bond.affinity`，V3 实际用的是 `bondState.affinity`（client 的账本镜像）—— **两者是同一个值**（V3 的 Task 5 已把镜像与账本对齐）。
>
> **本步的正确做法**：`grep` 确认 `curiosityOf` 在用即可，**不要再改 `release()`** —— 那不是本片的工作，重写只会覆盖 V3 已验收的代码。

### Step 5: 测试 `test/client-v3b.test.mjs`

**`__kylinContract` 的键本 Task 一个都不需要新加** —— 全部已经在里面了（T1/T2/T4/T4b 落的，2026-10-11 核对）：
```
createMind, stepMind, unlocked, socialGate, chooseIntent,      ← T2
createDirector,                                                 ← T3
SCRIPTS, ADVANCE, LINES,                                        ← T4 / T4b
```

> **⚠️ 不要去重复添加**（对象字面量里重复键不报错，但第二个会覆盖第一个 —— 一旦将来某一份被改名或改签名，会变成一处**静默的错位**）。本 Task 只需**确认**它们在，然后直接用 `__kylinContract` 里的引用做跨 realm 测试。
>
> `SCRIPTS`/`ADVANCE`/`LINES` 是 `const`（不提升），所以**契约冻结必须在工厂体末尾**，否则 TDZ —— 这一条 T4 已经处理过了。（**纯逻辑，无 DOM**），跨 realm 调：
1. **`deliverStimulus` 不再直接换档**：注入 `turn-fail` 后，断言**没有任何 actor 的 `play` 被同步调用**、但对应 mind 的 `mood` 掉了 —— 这条是「改成心智」的**核心证据**（用注入的桩 `play` 计数）；
2. **点概率随 affinity 变**：`affinity = 0` → 0.5；`affinity = +100` → 0.95（夹住）；`affinity = -100` → 0.05；
3. **导演在对方被拎起时不配对**（`freePartner` 跳过 held）；
4. **`settle` 走的是注入的 `onStimulus`**（桩函数被调一次、参数里有 `pair/kind/affinityDelta`）；
5. **冷却生效**：同一剧本 settle 两次，第二次被 `socialGate` 以 `cooldown` 淘汰。

Run: `npm test` → Expected: **127 pass / 0 fail**（117 + 10）。原写「124（114 + 10）」是按旧基线。）

---

## Task 6: 真浏览器取证（V3b 的唯一验收）

**Files:** Modify `src/stage/client.js`（只加一个只读探针）、`tools/harness.mjs`（可选）；产出 `evidence/v3b/*.png`；计划追加「V3b 取证记录」

### Step 1: 加一个只读探针（**唯一的取证用开口**）

没有它，「导演真的跑了一场合演」就只能靠截图猜。挂在 `__kylinContract.directorState()`。

> **⚠️ 不能把快照函数直接写在契约字面量里**（2026-10-11 预检发现）：`__kylinContract` 冻结在**工厂顶层**（`client.js:1123`），而 `director` 与 `minds` 都是 **`start()` 的局部**（`director` 在 `:1014` 之后才创建）。直接写在契约里 ⇒ **一调就 `ReferenceError`**。
> 这与 Task 5 的 `deliverStimulus` 是**同一个作用域陷阱**，解法也一样：**契约只持有一个「晚绑定」的引用，真正的快照函数由 `start()` 回填**。

**① 工厂顶层**（放在 `__kylinContract` **之前**，让它冻结时已存在）：

```js
/** start() 回填的取证探针；契约只能通过它间接读到运行期状态。 */
let probe = null
```

**② 契约里**（只有一行，不解引用任何运行期变量）：

```js
directorState: () => (probe ? probe() : null),
```

**③ `start()` 里**，`director` 与 `minds` 都建好之后回填：

```js
/** 只读快照：不暴露任何可变引用（memories 已在 director 的 getter 里拷过一份）。 */
probe = () => ({
  duet: director.duet ? { kind: director.duet.kind, phase: director.duet.phase, at: director.duet.at } : null,
  memories: director.memories.slice(-20),
  moods: Object.fromEntries(Object.keys(minds).map((id) => [id, { mood: minds[id].mood, energy: minds[id].energy, cooldown: Object.keys(minds[id].cooldown) }])),
})
```

> `probe()` 在 `start()` 完成前会回 `null`（**不是抛**）—— 取证脚本的第一步本来就该等到 `directorState()` 非 null 再开始断言；这也顺带给出了「舞台是否就绪」的信号。

### Step 2: 取证脚本（Playwright，Lead 亲跑；**沿用轮询等待，不用固定 sleep**）

1. **观察到一次完整四阶段**：打开页面后轮询 `directorState()`，**记录 `duet.phase` 出现过的取值集合**；等到 `memories` 从 0 变 1（一场合演收尾）→ 断言阶段集合 ⊇ `{approach, open, exchange, settle}`（**不能只有 open/settle**——那说明阶段推进是假的）→ 截图 `01-interaction.png`；
2. **账本随互动增长**：同一时刻 `GET /bond` 的 `affinity` **与合演前不同**，且变化量 === `TUNING.EFFECT[该 kind]`（**用剧本表核对，不是「变了就行」**）；
3. **冷却期内不重复**：继续轮询，在 `COOLDOWN_SEC[kind]` 窗口内断言 `memories` 里**同 kind 不出现第二次**（若出现，把两条的 `at` 差与冷却值一起打出来）；
4. **被拎起退出社交**：`page.mouse.down()` 压在麒麟仔命中区**不松手**，轮询 `directorState()` → 断言此后**没有新的 `duet` 开启**；若当时正好有一场，断言 `memories` 里出现 `aborted: 'partner-held'`；
5. **诱因不再直接点播（V3b 与 V2 的可观测分界）**：注入一次 `agent/error`，**同步**读 `directorState()` → 断言 `moods.xisha.mood` **立刻**下降，但**没有任何 actor 的当前档位被同步改成 `sad`**；截图 `02-stimulus-to-mind.png`；
6. 零 console/page 错误。

### Step 3: 写回计划并提交

```bash
git add src/stage/client.js evidence/v3b plans/2026-10-11-v3b-social-implementation.md
git commit -m 'test(v3b): 真浏览器取证（合演四阶段 / 账本随互动增长 / 冷却硬约束 / 拎起退出）'
```

---

## 自审

**Spec 覆盖**

| spec | 落在 |
|---|---|
| §5 心智状态与打分（门控优先、再加权） | Task 2 |
| §5 权重表只在一处调参 | Task 1 的 `TUNING`（`WEIGHT`） |
| §6 动作槽（1 合演 + 每宠 1 独演） | Task 3 `open` 的 `if (duet) return null` |
| §6 仲裁 `优先级 = |affinity| × 意图强度 × 新鲜度` | Task 3 `priority`（**新鲜度靠导演时钟，不读心智状态** —— 执行前的自审修过一次） |
| §6 败者退回独处链、不报错不排队 | Task 3 `step` 里的 `continue` |
| §6 四阶段 + 超时/拎走即 abort + 写记忆 | Task 3 的 `abort`（两条路都清 `busy`） |
| §6 收尾唯一入口写账本 | Task 3 `settle` → `stick` → V3 的 `queueBondEvent` |
| §7 8 个剧本的编排/效果/解锁 | Task 4（表）+ Task 1（`TUNING.UNLOCK`/`EFFECT`） |
| §7 台词全原创、与逻辑解耦 | Task 4 的 `LINES` |
| §8 诱因 → 心智消化（不直接点播） | Task 5 Step 3 + Task 6 Step 2.5 |
| §11.3 真浏览器取证 | Task 6 |
| §12 R1 表现力天花板 = 6 段美术 | Task 4 的测试 2（遍历全剧本断言 clip ∈ `CLIPS`） |
| §12 R7 空闲链不同拍 | Task 2 的 `jitter`（写在比较里，不污染返回值）+ V1 的 `fnv` 种子 |

**占位符扫描**：无 TODO / 后续补 / 类似前面。

**已知取舍（写在这里，不留给实施期发现）**：
1. **`shoulder` 无台词** —— 靠时长与移动区分，不靠一句几乎相同的话（Task 4 已注明）。
2. **`gift` 的两个 effect 是 Outcome 分支，不是两个剧本**（表现相同、账本不同）。
3. **V2 的 `react()` 被改名并改语义**（`deliverStimulus`）—— 这是**破坏性**的：V2 的浏览器取证记录里「注入后立刻换档」这句话在 V3b 之后**不再成立**。两处记录都要留，且 V2 那节的结论要标注「其时点为 V2 收口，V3b 已改为心智消化」。
4. **本片不动 host**：`/state`、`/bond`、`/balance` 三条路由的语义一个字不改。
5. **导演的记忆上限 50 是手调的**，没有配置项（YAGNI，与 V2 的轮询周期同一处置）。

**执行交接**：与 V2/V3 同款 —— 每 Task 一个干净上下文的子代理，Lead 在验收点核对证据；**Task 6 由 Lead 亲跑**。





