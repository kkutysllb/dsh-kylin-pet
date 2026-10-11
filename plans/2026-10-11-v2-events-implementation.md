# dsh-kylin-pet v2 · V2 实施计划（DSH 事件诱因面）

**目标**：把「引擎里刚发生了什么」变成「舞台上的诱因」——host 订阅**真宿主事件** → 归一成诱因 → 落诱因板 → client 轮询 → 按出厂导演表分流 → 有资格的宠**响应并冒气泡**。

**验收句**：注入一次「turn 失败」的**真宿主事件** → **只有 `directing.workStatus` 里挂 fail 的那只**做出反应（播难过档 + 冒气泡），另一只不动；真浏览器截图留存。

**依据**：`plans/2026-10-11-v2-duet-stage-design.md` §8；V0/V1 已落地（`v2/clean-room`，V1 十条硬门全绿）。

---

## 0. 本片为什么先做「实测钉事件名」

spec §12 R2 明写：上游的档位监听写在**更早版本**上，事件名可能已经变了；R3 说 `ctx.credentials` 形状未实测，余额可能做不通。**V2 开工第一件事不是写代码，是把宿主事实钉死。** 本轮已完成，证据如下。

### 1. 已实测钉死的宿主事实（2026-10-11，dsh `0.2.1-alpha.2`）

运行时自带**机器可读的服务/事件目录**：
`<kcoder-runtime>/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js`
下面每一行都是从那里读出来的（不是猜的，也不是从旧版本文档抄的）：

| 事件 | 模式 | 签名 | 对 V2 的意义 |
|---|---|---|---|
| `agent/turn-stopping` | **serial** | `{ agent, turn, signal }` | turn 正常收口 → `turn-ok` |
| `agent/error` | emit | `{ agent, turn, step, error }` | 某一步/整 turn 出错 → `turn-fail` |
| `agent/status` | emit | `{ agent, status }`（idle ⇄ running） | 备用（本片不用） |
| `agent/request-error` | waterfall | `{ agent, turn, step, provider, failure, retryPolicy, signal }` | 更细的失败面，本片不用 |
| `approval/request` | **waterfall** | `(req, next) => Promise<ApprovalOutcome>` | 审批等待 → `waiting` |
| `user-questions/request` | **waterfall** | `(request, next) => Promise<AskUserQuestionAnswer>` | 提问等待 → `waiting` |

**三条硬结论**：

1. **waterfall 事件必须 `next()`**。我们只是**旁观者**：忘了调 `next()` 就等于把审批挂死、用户永远等不到答案。这是本片最容易写出的事故，所以要有专门的单测 + 负对照。
2. **`agent/turn-stopping` 载荷里没有「成功/失败」**——它是「模型不再欠响应、turn 即将关闭」。所以「失败」只能由 `agent/error` 表达；两者是**两个独立信号**，不是一对开关。
3. **`ctx.credentials` 不是余额接口**：它是「凭据**引用**」缝（`describe(ref) → { configured: boolean }`，取值走 launch environment）。**余额不在本片**——按 spec §12 R3 挪到 V3，先做「取不到就诚实降级」。

### 2. 相对 spec §8 的一处收敛（记在这里，免得实施期才发现）

spec §8 的表里 turn-fail 与 error 是两行，但**资格完全相同**（都是 fail 档宠）。本片把二者**收敛成一个诱因 `turn-fail`**（`agent/error` 映射到它）：两个名字一条语义是纯重复，会让 client 与配置各多一处无意义分支。**将来 error 若需要不同待遇，再加一个 kind 即可**（KINDS 表集中一处）。

---

## 3. 契约

### 3.1 诱因种类（真源：`src/shared/contract.js` 的 `KINDS`）

```js
export const KINDS = Object.freeze(['turn-ok', 'turn-fail', 'waiting'])
```

client 单文件约束下必须**逐字重复**一份，由 `test/client-contract.test.mjs` 的 `SHARED_KEYS` 钉死（**允许重复，禁止漂移**）。

### 3.2 诱因 → 资格 → 动作

出厂配置是 `directing.workStatus = { kylinzi: ['ok'], xisha: ['fail'] }`，即**宠 id → 它愿意响应的档位**。所以分流是两跳：

| 诱因 | 档位 | 谁响应 | 播哪档 | 气泡 |
|---|---|---|---|---|
| `turn-ok` | ok | `workStatus[id]` 含 ok 的宠 | happy | 稳了 |
| `turn-fail` | fail | `workStatus[id]` 含 fail 的宠 | sad | 让我想想 |
| `waiting` | —（双方探头） | **cast 全体** | idle | 在呢 |

被拎起的宠（`held`）**不响应**：用户手里的事优先。

### 3.3 诱因板 HTTP

```
GET <PREFIX>/state?since=<seq>
→ 200 application/json, cache-control: no-store
→ { cursor: <number>, stimuli: [{ seq, kind, at, detail }] }
```

- `since` **缺失或非数字 ⇒ 起步查询**：`stimuli` 返回**空数组**，只回 `cursor`。这样 client 首次轮询只学水位、**不会对加载前的旧诱因做出反应**。
- `since` 为数字 ⇒ 返回 `seq > since` 的全部诱因。
- 环形缓冲上限 **64**；`cursor` 单调递增，**host 重启后归零**（client 必须容忍 cursor 回退：回退即重置自己的 since）。

### 3.4 气泡

每只演员一个气泡 div（`pointer-events:none`），`say(text, ms)` 显示、超时淡出。文案表 `LINES` 在 client 内，**全部原创**。

---

## 4. 文件增量

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/shared/contract.js` | 改 | 加 `KINDS` |
| `src/server/state.js` | 新建 | 诱因板（纯内存、可注入时钟、环形缓冲） |
| `src/server/stimuli.js` | 新建 | 宿主事件 → 诱因；waterfall 交棒 |
| `src/server/entry.js` | 改 | 装 stimuli + 挂 `/state` |
| `src/stage/client.js` | 改 | §4 气泡、`LINES`、`KINDS` 镜像、`react()`、轮询 |
| `tools/harness.mjs` | 改 | 假 ctx 记录监听器 + `POST /__emit`（**只给开发期**） |
| `test/state.test.mjs` | 新建 | 板子单测 |
| `test/stimuli.test.mjs` | 新建 | 映射与 **next() 交棒**单测 |
| `evidence/v2/*.png` | 产出 | 真浏览器取证 |

---

## Task 1: 诱因板（`src/server/state.js`）

**Files:** Create `src/server/state.js`、`test/state.test.mjs`；Modify `src/shared/contract.js`

### Step 1: 契约加 KINDS

`src/shared/contract.js` 在 `LOOPING` 之后追加：

```js
/** 诱因种类：host 产、client 消费。client 逐字镜像一份，由一致性测试钉死。 */
export const KINDS = Object.freeze(['turn-ok', 'turn-fail', 'waiting'])
```

（`test/contract.test.mjs` 的两条 KINDS 断言**折进既有的**「契约是冻结的（防运行期被改）」那条 —— **不新增 test 块**。这样契约文件仍是 4 条、`state.test.mjs` 7 条，合计 24 + 7 = **31**，与 Step 3 的 Expected 自洽。**若独立成条就是 32**，与本计划的计数对不上 —— 这是执行期发现的计数歧义，处置已定。）

### Step 2: 写板子

```js
import { KINDS } from '../shared/contract.js'

/** 环形缓冲上限：够覆盖一次「客户端卡了一分钟」的窗口，又不会无限长。 */
export const CAPACITY = 64

/**
 * 诱因板 —— 本片里「引擎刚发生了什么」的唯一出口。
 *
 * 设计约束（都是为了能单测）：
 * - 纯内存、无定时器、无 IO；
 * - 时钟可注入（now），于是 at 在测试里是确定的；
 * - since 的三种输入（缺省 / 数字 / 垃圾）语义各不相同，必须显式。
 */
export function createBoard(opts = {}) {
  const capacity = opts.capacity || CAPACITY
  const now = opts.now || (() => Date.now())
  let cursor = 0
  let items = []

  return {
    /** 记一条诱因，返回它的 seq。未知 kind 直接抛 —— 静默丢弃会让「宠没反应」变成悬案。 */
    push(kind, detail) {
      if (KINDS.indexOf(kind) < 0) throw new Error('unknown stimulus kind: ' + kind)
      cursor += 1
      const line = { seq: cursor, kind: kind, at: now(), detail: detail === undefined ? '' : String(detail) }
      items = items.concat([line])
      if (items.length > capacity) items = items.slice(items.length - capacity)
      return cursor
    },

    /**
     * 拉取诱因。
     * - since 非数字（undefined / '' / 'abc' / 负数）⇒ 起步查询：只报水位、不给历史。
     *   这一步是刻意的：新 client 不该对「它加载之前发生的事」做出反应。
     * - since 是数字 ⇒ 给 seq > since 的全部。
     */
    since(value) {
      const n = Number(value)
      const ok = value !== undefined && value !== null && value !== '' && Number.isFinite(n) && n >= 0
      if (!ok) return []
      return items.filter((s) => s.seq > n)
    },

    /** 当前水位（server 重启后归零）。 */
    get cursor() { return cursor },

    /** 只读快照，给测试与取证用。 */
    get all() { return items.slice() },
  }
}
```

### Step 3: 写测试 `test/state.test.mjs`

覆盖（每条都要有一个断言）：
1. `push` 返回递增 seq；`cursor` 跟着走；
2. `since` 只给严格大于的值（边界：`since === seq` 不给）；
3. **起步查询**：`since` 传 `undefined` / `''` / `'abc'` / `-1` 全部返回空数组；
4. 容量：push `CAPACITY + 5` 条后 `all.length === CAPACITY`，且**留着的是最新的**（`all[0].seq === 6`）；
5. 未知 kind 抛错；
6. `detail` 被字符串化、缺省为 `''`；
7. `at` 走注入时钟（注入 `() => 42` 后断言 `at === 42`）。

Run: `npm test` → Expected: **31 pass / 0 fail**（V1 的 24 + 本任务 7）。

### Step 4: Commit

```bash
git add src/shared/contract.js src/server/state.js test/state.test.mjs test/contract.test.mjs
git commit -m 'feat(state): 诱因板（环形缓冲 + 三种 since 语义）'
```

---

## Task 2: 宿主事件 → 诱因（`src/server/stimuli.js`）

**Files:** Create `src/server/stimuli.js`、`test/stimuli.test.mjs`

### Step 1: 写实现

```js
/**
 * 把真宿主事件翻译成诱因。
 *
 * 事件名/模式/载荷全部来自运行时自带的机器可读目录
 * (<kcoder-runtime>/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js)，
 * 2026-10-11 在 dsh 0.2.1-alpha.2 上实读：
 *
 *   agent/turn-stopping      serial     { agent, turn, signal }
 *   agent/error              emit       { agent, turn, step, error }
 *   approval/request         waterfall  (req, next) => Promise<ApprovalOutcome>
 *   user-questions/request   waterfall  (request, next) => Promise<AskUserQuestionAnswer>
 *
 * 两条 waterfall 必须原样交棒：我们是旁观者，吞掉 next() 会把审批挂死。
 */

/** [宿主事件名, 诱因 kind] —— 一对一直译的那些。 */
export const DIRECT = Object.freeze([
  ['agent/turn-stopping', 'turn-ok'],
  ['agent/error', 'turn-fail'],
])

/** 需要交棒的等待类事件（waterfall）。 */
export const RELAY = Object.freeze(['approval/request', 'user-questions/request'])

/** 把错误对象压成一行人话，喂给诱因的 detail。 */
export function describeError(err) {
  if (err === undefined || err === null) return 'unknown'
  if (typeof err === 'string') return err.slice(0, 200)
  const name = err.name || (err.constructor && err.constructor.name) || 'Error'
  const msg = err.message === undefined ? String(err) : String(err.message)
  return (name + ': ' + msg).slice(0, 200)
}

/**
 * 装监听。返回幂等 disposer。
 * @param {{on: (name: string, fn: Function) => any}} ctx 只用到 ctx.on —— 测试给个假 ctx 就够
 * @param {ReturnType<import('./state.js').createBoard>} board
 */
export function installStimuli(ctx, board) {
  const disposers = []
  const keep = (d) => { disposers.push(typeof d === 'function' ? d : () => {}) }

  for (const pair of DIRECT) {
    const name = pair[0]
    const kind = pair[1]
    keep(ctx.on(name, (payload) => {
      const detail = kind === 'turn-fail' ? describeError(payload && payload.error) : ''
      try { board.push(kind, detail) } catch (err) { /* 板子出问题不该影响宿主 */ }
    }))
  }

  for (const name of RELAY) {
    keep(ctx.on(name, (_payload, next) => {
      try { board.push('waiting', name) } catch (err) { /* 同上 */ }
      // 旁观者交棒：必须把控制权原样交回，否则审批/提问永远等不到答案。
      return typeof next === 'function' ? next() : undefined
    }))
  }

  let done = false
  return () => {
    if (done) return
    done = true
    for (const d of disposers) { try { d() } catch (err) { /* 卸载失败不该抛 */ } }
  }
}
```

### Step 2: 写测试 `test/stimuli.test.mjs`

**必须包含一条「交棒」负对照**（这是本任务的头号风险）：

```js
// 假 ctx：记录每个事件的监听器，并能按事件名派发
function fakeCtx() {
  const map = new Map()
  return {
    on(name, fn) {
      const list = map.get(name) || []
      list.push(fn)
      map.set(name, list)
      return () => {}
    },
    emit(name, payload, next) {
      const fns = map.get(name) || []
      return fns.length ? fns[0](payload, next) : undefined
    },
    listeners: (name) => (map.get(name) || []).length,
  }
}
```

> **执行期补充（子代理实测，已采纳）**：上面这块 `fakeCtx` 的 `on()` 返回**空 disposer**（`return () => {}`，只记不摘），所以它能验「派发与计数」，**验不了**「卸载后不再产诱因」—— 真 `ctx.on` 返回的是摘除器。故另写一块行为一致的 `removableCtx()`（`on` 返回真摘除器）**只服务于覆盖项 6**，`fakeCtx` 逐字保留不动。

覆盖：
1. `agent/turn-stopping` → 板上多一条 `turn-ok`，`detail === ''`；
2. `agent/error` → `turn-fail`，`detail` 含 Error 与消息；
3. `approval/request` → `waiting`，且 **next 被调用恰好一次**（用计数的 next 断言）；
4. `user-questions/request` 同上；
5. **负对照**：把实现里 `next` 那行去掉 → 第 3 条必须红（证明这条断言有判别力）；
6. disposer 幂等、卸载后不再产诱因；
7. `board.push` 抛错不影响事件处理（传一块坏板子，断言 emit 不抛）。

Run: `npm test` → Expected: **38 pass / 0 fail**（31 + 7）。

### Step 3: Commit

```bash
git add src/server/stimuli.js test/stimuli.test.mjs
git commit -m 'feat(stimuli): 宿主事件 → 诱因（waterfall 原样交棒）'
```

---

## Task 3: 挂 `/state`（`src/server/entry.js`）

**Files:** Modify `src/server/entry.js`、`test/entry.test.mjs`

### Step 1: `createHandler` 接一块板

给 `createHandler({ config, resolveAsset })` 加入可选 `board`；`GET <PREFIX>/state` 走 `board.since(url.searchParams.get('since'))`，回 `{ cursor, stimuli }`，头部 `cache-control: no-store`。

**board 缺省时**（V1 的老调用方）要**仍然可用**：内部造一块惰性空板，`/state` 回 `{ cursor: 0, stimuli: [] }`。这样 V1 的 5 条 entry 测试一行都不用改。

### Step 2: `apply(ctx)` 里装订阅

```js
const board = createBoard()
const uninstall = installStimuli(ctx, board)
```

并把 `uninstall` 交给 `ctx.effect`。**订阅泄漏比路由泄漏更隐蔽**：路由重复注册会立刻 500，重复监听只是诱因翻倍——所以测试里要有「`apply` 两次只有一个监听器」的断言。

### Step 3: 测试 `test/entry.test.mjs` 追加

1. `GET /state`（无 since）→ `{ cursor: 0, stimuli: [] }`；
2. `apply(fakeCtx)` 后 `fakeCtx.listeners('agent/turn-stopping') === 1`；**`apply` 两次仍为 1**；
3. `emit('agent/error')` → `GET /state` 回一条 `turn-fail`；`GET /state?since=<seq>` 回空；
4. 未知路径仍 404、`POST /state` 仍 405（沿用 V1 既有断言，不改）。

Run: `npm test` → Expected: **44 pass / 0 fail**。

### Step 4: Commit

```bash
git add src/server/entry.js test/entry.test.mjs
git commit -m 'feat(host): /state 诱因轮询口 + apply 内装订阅'
```

---

## Task 4: client 消费诱因（`src/stage/client.js`）

**Files:** Modify `src/stage/client.js`、`test/client-contract.test.mjs`；Create `test/client-stimulus.test.mjs`

**约束**：单文件、全实现收在 factory 作用域内、只经 `exports` 暴露。**新增共享常量必须同时进 `__kylinContract`**。

### Step 1: 契约镜像

`const KINDS = Object.freeze(['turn-ok', 'turn-fail', 'waiting'])`，写进 `exports.__kylinContract`。`test/client-contract.test.mjs` 的 `SHARED_KEYS` 加 `'KINDS'`。

### Step 2: §4 气泡

`createActor` 内追加气泡 div（`pointerEvents:'none'`、绝对定位在角色上方、opacity 过渡淡入淡出），并给 `a` 加：

```js
a.say = (text, ms) => {
  if (!text) return
  bubble.textContent = text
  bubble.style.opacity = '1'
  if (a.sayTimer) clearTimeout(a.sayTimer)
  a.sayTimer = setTimeout(() => { bubble.style.opacity = '0' }, ms || 2200)
}
```

文案表（原创）：

```js
const LINES = Object.freeze({ 'turn-ok': '稳了', 'turn-fail': '让我想想', waiting: '在呢' })
```

### Step 3: 分流与响应（`createWorld` 内）

```js
/** 诱因 → 档位 → 资格。waiting 是「双方探头」，不查表。 */
const STATUS_OF = { 'turn-ok': 'ok', 'turn-fail': 'fail' }
const CLIP_OF = { 'turn-ok': 'happy', 'turn-fail': 'sad', waiting: 'idle' }

function qualified(kind) {
  const cast = opts.config.cast
  if (kind === 'waiting') return cast.map((p) => p.id)
  const want = STATUS_OF[kind]
  const map = (opts.config.directing && opts.config.directing.workStatus) || {}
  return cast.filter((p) => (map[p.id] || []).indexOf(want) >= 0).map((p) => p.id)
}

/** V2 占位：有资格就演。V3 起由 Mind 打分决定「要不要响应」——别把这里当最终形态。 */
function react(stimulus) {
  if (!stimulus || KINDS.indexOf(stimulus.kind) < 0) return []
  const acted = []
  for (const id of qualified(stimulus.kind)) {
    const a = actors.find((x) => x.pet.id === id)
    if (!a || a.held) continue
    a.say(LINES[stimulus.kind])
    a.play(CLIP_OF[stimulus.kind])
    a.next = rand(2, 4)
    acted.push(id)
  }
  return acted
}
```

`return` 里加 `react: react, qualified: qualified`。

### Step 4: 轮询（`start()` 内）

```js
let since = null   // null = 还没学水位
const poll = async () => {
  try {
    const q = since === null ? '' : '?since=' + since
    const res = await fetch(ROUTE_PREFIX + '/state' + q, { cache: 'no-store' })
    if (!res.ok) return
    const body = await res.json()
    const cur = Number(body && body.cursor)
    if (!Number.isFinite(cur)) return
    if (since !== null && cur < since) since = null      // host 重启：水位回退，重新起步
    for (const s of (body && body.stimuli) || []) world.react(s)
    since = cur
  } catch (err) { /* 宿主不在时静默：桌宠不该刷屏 */ }
}
setInterval(poll, 1000)
poll()
```

### Step 5: 测试

- `test/client-contract.test.mjs`：`SHARED_KEYS` 加 `KINDS`（跨 realm 比较走 `canon()` —— V1 的教训）。
- 新增 `test/client-stimulus.test.mjs`：把 `qualified` 挂到 `__kylinContract.qualified`（**纯函数、无 DOM 依赖**），在 `vm` 里跨 realm 直接调：
  - `qualified('turn-ok')` → `['kylinzi']`；`qualified('turn-fail')` → `['xisha']`；`qualified('waiting')` → `['kylinzi','xisha']`；
  - `directing.workStatus` 缺失时：ok/fail 返回空、waiting 仍返回全体（**降级不崩**）。

Run: `npm test` → Expected: **48 pass / 0 fail**。

### Step 6: Commit

```bash
git add src/stage/client.js test/client-contract.test.mjs test/client-stimulus.test.mjs
git commit -m 'feat(stage): 诱因消费（分流 / 气泡 / 轮询）'
```

---

## Task 5: 真浏览器取证（V2 的唯一验收）

**Files:** Modify `tools/harness.mjs`；产出 `evidence/v2/*.png`；计划追加「V2 取证记录」

### Step 1: 验收台升级（只加开发期能力，不动生产面）

1. 建 `board = createBoard()`；
2. 造一个**只实现 `on`** 的假 ctx，记下监听器；
3. `installStimuli(fakeCtx, board)`；
4. 伺服 `GET <PREFIX>/state` —— **走真 `createHandler({config, resolveAsset, board})`**，不是另写一份；
5. 加 **`POST /__emit?name=<事件名>`**：按名字把假 ctx 记下的监听器派发一次（waterfall 传一个计数 next）。**这是唯一的开发期后门**，代码注释里必须写明它只存在于 harness、不在 `entry.js`。

### Step 2: 取证脚本（Playwright，Lead 亲跑）

按 V1 的方式（`createRequire('/opt/homebrew/lib/node_modules/')`，端口另取避开占用）：

> **执行期补充（Lead 备脚本时发现）：气泡没有稳定选择器。** 计划只描述了气泡的视觉行为（`opacity` 过渡），没给它 `id` 或 `data-*`。于是取证**不能** `querySelector('.bubble')`，只能按**行为特征**找：演员元素内、`textContent` 非空、且 `getComputedStyle(kid).opacity > 0.5` 的那个 `div`。
> 这个启发式是可靠的（气泡是演员元素内**唯一**带文本的子节点，且隐藏只改 `opacity`、不清 `textContent`），但它是**启发式**，所以在这里写明来源。
> **对断言口径的影响（重要）**：待机链会自然换片，所以「另一只不动」**不能**用「前台片没变」来判——那只宠可能正好在散步。改用**气泡为空**：气泡**只**由 `react()` 产生，因此「该冒的冒了 + 不该冒的没冒」是一对确定可判定的断言。前台片只作**辅助观察**（`failXishaClipIsSad` / `okKylinziClipIsHappy`），不作硬门。

1. 打开页面、等 3s、截图 `01-idle.png`；
2. **注入失败**：`POST /__emit?name=agent%2Ferror` → 等 1.2s → 断言
   - `xisha`（fail 档）前台片 ∈ `CLIPS.sad`，气泡文本 === `让我想想`；
   - `kylinzi`（ok 档）**没换档、没气泡** —— **这条「另一只不动」是本片的核心断言**；
   - 截图 `02-turn-fail.png`；
3. **注入成功**：`POST /__emit?name=agent%2Fturn-stopping` → 等 1.2s → 断言
   - `kylinzi` 前台片 ∈ `CLIPS.happy`、气泡 === `稳了`；`xisha` 不动；
   - 截图 `03-turn-ok.png`；
4. **注入等待**：`POST /__emit?name=approval%2Frequest` → 等 1.2s → 两只**都**冒气泡 `在呢`；截图 `04-waiting.png`；
5. **交棒负对照**：把 `stimuli.js` 的 next 那行注释掉 → `test/stimuli.test.mjs` 的「next 被调用恰好一次」必须红 —— **证明那条单测有判别力**（改完恢复，**文件 sha256 必须还原**）；
6. 断言全程零 console/page 错误；打印全部实测值。

### Step 3: 写回计划并提交

在本文件末尾新增「V2 取证记录」（实际输出原文 + 截图路径 + sha256），然后：

```bash
git add tools/harness.mjs evidence/v2 plans/2026-10-11-v2-events-implementation.md
git commit -m 'test(v2): 真浏览器取证（事件注入 -> 指定宠响应）'
```

---

## 自审

**Spec 覆盖**

| spec | 落在 |
|---|---|
| §8 表格 5 行 | Task 2（收敛为 3 个 kind，理由见 §0.2） |
| §8「诱因板 → 心智消化，不直接点播」 | Task 1/2（host 只产诱因）+ Task 4（`react()` 是**显式占位**，代码注释写明 V3 换成 Mind 评估；与 V1 的 `bump()` 同一处置） |
| §11.3 真浏览器截图 | Task 5 |
| §11.6 契约不漂移 | Task 1 `KINDS` + Task 4 `SHARED_KEYS` |
| §12 R2 事件名 | §0.1（已实测钉死） |
| §12 R3 余额 | **明确不在本片**（挪 V3） |
| §12 R4 后台不跑 | V1 已有 `document.hidden` 闸；轮询在后台**继续**（诱因不该因切标签丢掉），但不做动画 |

**占位符扫描**：本文件无 TODO / 后续补 / 类似前面。

**已知取舍（写在这里，不留给实施期发现）**：
1. `react()` 是**无条件的**（有资格就演）—— V3 的 Mind 会先打分再决定要不要演；本片必须把这个占位写进代码注释，否则 V3 会以为它是最终形态。
2. 轮询周期 1s 是**手调的**；本片不引入配置项（YAGNI），V4 若需要再加。
3. `waiting` 让**双方**都冒气泡、且没有冷却 —— 审批连续弹两次就连续冒两次。V2 可接受的粗糙，V3 的冷却表统一治。
