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

Run: `npm test` → Expected: **103 pass / 0 fail**（94 + 9）。


