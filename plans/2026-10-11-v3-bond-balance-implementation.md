# dsh-kylin-pet v2 · V3 实施计划（关系账本 · 余额）

**目标**：让「关系」成为**跨会话的真实状态**，让「余额」成为**绝不伪造的联合类型**。

**验收句（两条，缺一不可）**：
1. **关系跨重启存活**：拖到一起放下 → 账本产生一笔 delta 并落盘 → **杀掉验收台、用同一账本路径重启、再打开页面** → 客户端读回的 affinity 与重启前**逐位相同**。
2. **余额诚实降级**：本机 `process.env.DEEPSEEK_API_KEY` 不存在（凭据在 `~/.coder/.credentials.yaml` 的 `refs:` 里）时，`/balance` 必须回 `{ kind:'unavailable', reason:'…' }` **且原因分类正确**；响应里**一个数字都不许凭空出现**。

**依据**：spec §4.5 / §11.4 / §11.7 / §8；spec §14.1 的补测事实。

---

## 0. 本片的边界（先说清，免得又被当成「漏了」）

| 片 | 内容 | 为什么这么切 |
|---|---|---|
| **V3（本文件）** | 关系账本（host 独占写入 + 跨会话落盘 + 客户端镜像）+ 余额（联合类型 + 可注入探针 + 档位播报） | 两件事**各自独立可验收**（重启存活 / 降级正确），都是「状态与契约」问题 |
| **V3b（下一份计划）** | 心智 Mind / 导演 Director / 8 个互动剧本 | 这是「行为引擎」，验收句是「剧本触发一次且冷却生效」，与账本/余额是两套判据 |

**接缝**：本片把账本读写接在**已有的** `bump()`（V1 拖到一起放下）上；V3b 的导演**复用同一个 `queueBondEvent()`**，不改写入路径 —— **账本永远只有一条写入路径**（spec §6）。

---

## 1. 已实测钉死的宿主事实（复用 spec §14.1，不重复取证）

1. `ctx.get('credentials')` → `describe(ref)` 回 `{ configured, source, writable }`（**零成本前置判定**）；`resolve(ref)` 回 `{ value, source }` 或 `undefined`。
2. 解析顺序：**继承环境 → 文件 `refs:` → dotenv 兜底**。
3. **不需要 import 任何 `@deepseek-ai/*`** —— 服务对象从 `ctx.get` 拿，branding 是编译期的。
4. 余额接口 `GET https://api.deepseek.com/user/balance`，响应 `{ is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }`，**余额是字符串**、`balance_infos` 是**数组**。

---

## 2. 契约

### 2.1 账本文件 `<dsh家目录>/dsh-kylin-pet/bond.json`

```json
{
  "version": 1,
  "pairs": {
    "kylinzi|xisha": {
      "affinity": 0, "familiarity": 0, "lastAt": 0,
      "history": [ { "kind": "bump", "at": 1791700000000, "affinityDelta": 2, "familiarityDelta": 1 } ]
    }
  }
}
```

- **pair key = 两个宠 id 排序后拼 `|`**（与谁先发起无关 ⇒ 同一对永远同一个键）。
- `affinity` 夹 `[-100,100]`；`familiarity` `>=0` **只增不减**；`history` 环形上限 50。
- 文件**损坏/形状不认识**时：`load` **不抛**，回空账本 + 记一条 warning，**且绝不覆盖原文件**（坏文件留给人看；桌宠不该因为一个坏文件起不来）。

### 2.2 HTTP

| 方法 | 路径 | 语义 |
|---|---|---|
| GET | `<PREFIX>/bond` | 回整本账（客户端启动读一次） |
| PUT | `<PREFIX>/bond` | body `{ events: [{ pair, kind, affinityDelta, familiarityDelta, at }] }` → host 施加 → 落盘 → 回新账 |
| GET | `<PREFIX>/balance` | 回 ledger 联合类型 |

PUT 的 `events` **空数组合法**（防抖后可能无事可报），回当前账。

### 2.3 ledger 联合类型（**先把 `unavailable` 写完，再写取值**）

```js
{ kind: 'ok', currency, total, granted, toppedUp, tier, at, source, note }
  // total / granted / toppedUp 保留接口原样的**字符串**，不做数值化
{ kind: 'unavailable', reason, detail, at }
```

`reason` 封闭（`LEDGER_REASONS`）：`no-credentials-service` / `not-configured` / `network-error` / `http-error` / `shape-unrecognized` / `no-balance-info` / `unsupported-currency`。

**为什么必须分类**：它们对用户意味着**不同动作** —— `not-configured` 去配凭据、`network-error` 查网络、`http-error` 看 key 是否失效、`shape-unrecognized` 是接口改了要更新代码。糊成一个字符串等于没报。

### 2.4 档位阈值（集中一处，**只在一处调参**）

```js
export const BALANCE_TIERS = Object.freeze([
  ['充裕', 100], ['健康', 50], ['正常', 20], ['偏低', 5], ['告急', 1], ['见底', 0],
])
```

判定 = 第一个满足 `值 >= 阈值` 的档；**解析不出有限数 ⇒ `tier: null`**（**不猜档位**，UI 走「余额未知」）。

---

## 3. 文件增量

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/shared/contract.js` | 改 | `BOND` / `LEDGER_REASONS` / `BALANCE_TIERS` |
| `src/server/bond.js` | 新建 | 账本：读 / 规范化 / 施加 / 原子落盘 |
| `src/server/ledger.js` | 新建 | 余额：联合类型 + 可注入探针 + 档位 |
| `src/server/entry.js` | 改 | 挂 `/bond`（GET/PUT）与 `/balance` |
| `src/stage/client.js` | 改 | 启动读账本；`bump()` 提交 delta（防抖 2s）；余额档位播报 |
| `test/bond.test.mjs` | 新建 | 账本单测 |
| `test/ledger.test.mjs` | 新建 | ledger 单测（**降级路径优先**） |

---

## Task 1: 契约扩充

**Files:** Modify `src/shared/contract.js`、`test/contract.test.mjs`

在 `KINDS` 之后追加：

```js
/** 账本边界（spec §4.5）。夹取与环形上限都从这里取，别在实现里写魔数。 */
export const BOND = Object.freeze({
  AFFINITY_MIN: -100,
  AFFINITY_MAX: 100,
  HISTORY_MAX: 50,
  PAIR_SEP: '|',
})

/** 余额「取不到」的原因（封闭集合）。分类是为了让用户知道该去做什么。 */
export const LEDGER_REASONS = Object.freeze([
  'no-credentials-service',
  'not-configured',
  'network-error',
  'http-error',
  'shape-unrecognized',
  'no-balance-info',
  'unsupported-currency',
])

/** 档位阈值，降序。判定 = 第一个满足 值 >= 阈值 的档；解析不出数字则 tier=null（不猜）。 */
export const BALANCE_TIERS = Object.freeze([
  ['充裕', 100], ['健康', 50], ['正常', 20], ['偏低', 5], ['告急', 1], ['见底', 0],
])
```

`test/contract.test.mjs` 补三条断言（**折进既有 test 块，不新增块**，保持该文件 4 条、计数可预期）：
- `BOND.AFFINITY_MIN === -100 && BOND.AFFINITY_MAX === 100`
- `LEDGER_REASONS.length === 7` 且 `Object.isFrozen`
- `BALANCE_TIERS[0][0] === '充裕'`

Run: `npm test` → Expected: **48 pass / 0 fail**（计数不变）。

---

## Task 2: 账本（`src/server/bond.js`）

**Files:** Create `src/server/bond.js`、`test/bond.test.mjs`

### Step 1: 写实现

```js
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BOND } from '../shared/contract.js'
import { dshHome } from './pet-config.js'

/** 同一对宠永远同一个键：排序后拼接，与谁先发起无关。 */
export function pairId(a, b) {
  return [String(a), String(b)].sort().join(BOND.PAIR_SEP)
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

/** 把任意输入整形为合法的一对记录。永不抛 —— 坏数据只该降级，不该让桌宠起不来。 */
export function normalizePair(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const history = Array.isArray(src.history) ? src.history.slice(-BOND.HISTORY_MAX) : []
  return {
    affinity: clamp(num(src.affinity, 0), BOND.AFFINITY_MIN, BOND.AFFINITY_MAX),
    familiarity: Math.max(0, num(src.familiarity, 0)),
    lastAt: Math.max(0, num(src.lastAt, 0)),
    history: history,
  }
}

/** 空账本。 */
export function emptyLedger() {
  return { version: 1, pairs: {} }
}

/**
 * 建一个账本句柄。
 * @param {{path?: string, home?: string, now?: () => number}} [opts]
 */
export function createBondStore(opts = {}) {
  const path = opts.path || join(opts.home || dshHome(), 'dsh-kylin-pet', 'bond.json')
  const now = opts.now || (() => Date.now())
  const warnings = []
  let ledger = emptyLedger()
  let suspect = false

  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed && typeof parsed === 'object' && parsed.pairs && typeof parsed.pairs === 'object') {
        ledger = { version: num(parsed.version, 1), pairs: {} }
        for (const key of Object.keys(parsed.pairs)) ledger.pairs[key] = normalizePair(parsed.pairs[key])
      } else {
        suspect = true
        warnings.push('bond.json 形状不认识，已按空账本启动（原文件未改动）')
      }
    } catch (err) {
      suspect = true
      warnings.push('bond.json 解析失败，已按空账本启动（原文件未改动）：' + String(err && err.message))
    }
  }

  /** 落盘：先写 tmp 再 rename —— 崩在中间不会留下半截 JSON。 */
  function flush() {
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = path + '.tmp'
    writeFileSync(tmp, JSON.stringify(ledger, null, 2))
    renameSync(tmp, path)
  }

  /**
   * 施加一批事件。**这是账本唯一的写入口**（spec §6：剧本不得自己写账本）。
   * @param {Array<{pair: string, kind?: string, affinityDelta?: number, familiarityDelta?: number, at?: number}>} events
   */
  function apply(events) {
    const list = Array.isArray(events) ? events : []
    for (const ev of list) {
      const key = String((ev && ev.pair) || '')
      if (!key) continue
      const prev = normalizePair(ledger.pairs[key])
      const dA = num(ev && ev.affinityDelta, 0)
      const dF = num(ev && ev.familiarityDelta, 0)
      const at = num(ev && ev.at, now())
      ledger.pairs[key] = {
        affinity: clamp(prev.affinity + dA, BOND.AFFINITY_MIN, BOND.AFFINITY_MAX),
        familiarity: Math.max(0, prev.familiarity + Math.max(0, dF)),  // 只增：负增量被丢弃
        lastAt: Math.max(prev.lastAt, at),
        history: prev.history.concat([{
          kind: String((ev && ev.kind) || 'unknown'),
          at: at,
          affinityDelta: dA,
          familiarityDelta: dF,
        }]).slice(-BOND.HISTORY_MAX),
      }
    }
    // 坏文件未被覆盖时：第一批写入前先把坏文件留个底，别让 flush 直接盖掉它
    if (list.length && suspect) {
      try { renameSync(path, path + '.suspect') } catch (err) { /* 留底失败不阻断写入 */ }
      suspect = false
    }
    if (list.length) flush()
    return ledger
  }

  return {
    path: path,
    get ledger() { return ledger },
    get warnings() { return warnings.slice() },
    apply: apply,
    /** 只读快照（HTTP 响应直接用它）。 */
    snapshot() { return JSON.parse(JSON.stringify(ledger)) },
  }
}
```

> **一处刻意的设计**：坏文件**在被第一批写入覆盖之前先改名保留**（`bond.json.suspect`）。否则「绝不覆盖」就只在「没人写」时成立 —— 那等于没有。

### Step 2: 写测试 `test/bond.test.mjs`

用 `mkdtempSync` 造临时 home，**绝不碰真账本**。覆盖：
1. `pairId('xisha','kylinzi') === pairId('kylinzi','xisha') === 'kylinzi|xisha'`；
2. 全新路径：`snapshot()` 是空账、`warnings` 为空；
3. `apply` 一笔 → affinity/familiarity/lastAt/history 全对；**并且落盘了**（另起一个 store 读回同值）；
4. affinity 被夹：`+1000` → 100；再 `-1000` → −100；
5. familiarity **只增**：`familiarityDelta:-5` 不减小它；
6. history 环形：推 55 笔 → 长度 50，且 `[0].at` 是最早保留下来的那笔（**不是第 1 笔**）；
7. **坏文件不覆盖**：写 `'{ 这不是 json'` → 不抛、`warnings.length === 1`、**文件内容仍是坏的那串**；
8. **坏文件在写入时被留底**：坏文件 + `apply` 一笔 → 出现 `bond.json.suspect` 且其内容 === 原来的坏内容；
9. `apply([])` 合法且**不落盘**（空数组不该动文件）。

Run: `npm test` → Expected: **57 pass / 0 fail**。

### Step 3: Commit

```bash
git add src/shared/contract.js src/server/bond.js test/bond.test.mjs test/contract.test.mjs
git commit -m 'feat(bond): 关系账本（单写者 + 原子落盘 + 坏文件只降级不覆盖）'
```

---

## Task 3: 余额（`src/server/ledger.js`）

**Files:** Create `src/server/ledger.js`、`test/ledger.test.mjs`

### Step 1: 写实现

```js
import { BALANCE_TIERS } from '../shared/contract.js'

/** 档位判定：字符串原样保留，数值只用于比较；解析不出有限数就 null（不猜）。 */
export function tierOf(total) {
  const n = typeof total === 'string' ? Number(total.trim()) : Number(total)
  if (!Number.isFinite(n)) return null
  for (const entry of BALANCE_TIERS) if (n >= entry[1]) return entry[0]
  return BALANCE_TIERS[BALANCE_TIERS.length - 1][0]
}

export function unavailable(reason, detail, at) {
  return { kind: 'unavailable', reason: reason, detail: detail === undefined ? '' : String(detail), at: at }
}

/**
 * 从响应里挑出要用的那一条。多币种是真实存在的：
 * 优先 preferred，缺席就取首条，并把「我换了币种」写进 reason（不静默取 [0]）。
 */
export function pickBalanceInfo(payload, preferred) {
  const list = payload && Array.isArray(payload.balance_infos) ? payload.balance_infos : []
  if (list.length === 0) return { info: null, reason: 'no-balance-info' }
  const want = preferred || 'CNY'
  const hit = list.find((x) => x && x.currency === want)
  if (hit) return { info: hit, reason: null }
  const first = list.find((x) => x && typeof x.currency === 'string')
  if (!first) return { info: null, reason: 'shape-unrecognized' }
  return { info: first, reason: 'unsupported-currency' }
}

/**
 * 读一次余额。探针可注入 —— 否则测试里只能打真网络。
 * @param {{getCredentials?: () => any, fetchImpl?: Function, ref?: string, preferred?: string, now?: () => number}} opts
 */
export async function readBalance(opts = {}) {
  const now = opts.now || (() => Date.now())
  const at = now()
  const creds = typeof opts.getCredentials === 'function' ? opts.getCredentials() : undefined

  // ① 没有服务：这一层不需要网络，也不该花时间
  if (!creds || typeof creds.describe !== 'function') return unavailable('no-credentials-service', '', at)

  const ref = opts.ref || 'DEEPSEEK_API_KEY'
  let described
  try { described = await creds.describe(ref) } catch (err) {
    return unavailable('no-credentials-service', String(err && err.message), at)
  }
  // ② describe 是零成本前置判定：没配就别浪费一次网络往返
  if (!described || described.configured !== true) return unavailable('not-configured', ref, at)

  let got
  try { got = await creds.resolve(ref) } catch (err) {
    return unavailable('not-configured', String(err && err.message), at)
  }
  if (!got || typeof got.value !== 'string' || got.value.length === 0) return unavailable('not-configured', ref, at)

  // ③ 才轮到网络
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return unavailable('network-error', 'no fetch available', at)
  let res
  try {
    res = await fetchImpl('https://api.deepseek.com/user/balance', {
      headers: { authorization: 'Bearer ' + got.value, accept: 'application/json' },
    })
  } catch (err) {
    return unavailable('network-error', String(err && err.message), at)
  }
  if (!res || res.status !== 200) return unavailable('http-error', 'HTTP ' + String(res && res.status), at)

  let payload
  try { payload = await res.json() } catch (err) { return unavailable('shape-unrecognized', 'not json', at) }
  const picked = pickBalanceInfo(payload, opts.preferred)
  if (!picked.info) return unavailable(picked.reason, '', at)

  const info = picked.info
  if (typeof info.total_balance !== 'string') {
    return unavailable('shape-unrecognized', 'total_balance 不是字符串', at)
  }
  return {
    kind: 'ok',
    currency: String(info.currency || ''),
    total: info.total_balance,                                       // 原样字符串，绝不数值化
    granted: typeof info.granted_balance === 'string' ? info.granted_balance : '',
    toppedUp: typeof info.topped_up_balance === 'string' ? info.topped_up_balance : '',
    tier: tierOf(info.total_balance),
    at: at,
    source: String(got.source || ''),
    note: picked.reason === 'unsupported-currency' ? '首选币种缺席，已取首条' : '',
  }
}
```

### Step 2: 写测试 `test/ledger.test.mjs`（**降级路径优先**）

1. 没有 credentials 服务 → `no-credentials-service`；
2. `describe` 回 `{configured:false}` → `not-configured`，**且 fetchImpl 一次都没被调用**（计数探针断言）——这条是「不浪费网络往返」的实证；
3. `resolve` 回 `undefined` → `not-configured`；
4. fetch 抛错 → `network-error`；`status=401` → `http-error` 且 detail 含 401；
5. 非 JSON → `shape-unrecognized`；`balance_infos: []` → `no-balance-info`；`total_balance` 非字符串 → `shape-unrecognized`；
6. 正常（CNY 110.00）→ `kind:'ok'`、**`total === '110.00'`（字符串，不是 110）**、`tier === '充裕'`；
7. 多币种：只有 USD 时取它且 `note` 非空、`tier` 仍按 `total` 算；
8. `tierOf` 边界：`'100'→充裕`、`'99.99'→健康`、`'0'→见底`、`'abc'→null`、`''→null`、`undefined→null`。

Run: `npm test` → Expected: **66 pass / 0 fail**。

### Step 3: Commit

```bash
git add src/server/ledger.js test/ledger.test.mjs
git commit -m 'feat(ledger): 余额联合类型（降级路径优先 + 原样字符串 + 可注入探针）'
```

---

## Task 4: 挂 `/bond` 与 `/balance`（`src/server/entry.js`）

**Files:** Modify `src/server/entry.js`、`test/entry.test.mjs`

### Step 1: 三条路由

- `createHandler({ config, resolveAsset, board, bond, readBalanceImpl })` —— 后两个**可选**，缺省时 V1/V2 的老调用方一行不改。
- **缺省 `bond` 时**：`GET /bond` 回 `emptyLedger()`，`PUT /bond` 回 **501**。**不偷偷写用户的真账本** —— 老调用方（测试）不该有这种机会。501 的语义是「我知道这个能力，但没接」，比 404 诚实。
- **`PUT` 需要读 body**：加 `readJson(req, limit)` 助手（上限 64KB，超了 413，非 JSON 400）。
- **`/balance` 的凭据来自 `ctx`，不在 `createHandler` 里** —— handler 接的是**一个已绑好的函数** `readBalanceImpl`（缺省 = 回 `unavailable('no-credentials-service')`）。`apply(ctx)` 里绑：
  ```js
  const readBalanceImpl = () => readBalance({ getCredentials: () => (ctx.get ? ctx.get('credentials') : undefined) })
  ```
- 路由表加 `GET /bond`、`PUT /bond`、`GET /balance`；**`PUT` 只许出现在 `/bond`**，别处仍 405（沿用 V2 既有断言，不改）。

### Step 2: 测试 `test/entry.test.mjs` 追加

1. `GET /bond`（缺省 handler）→ `{version:1,pairs:{}}`；
2. `PUT /bond`（缺省）→ **501**；
3. 注入一个**临时路径**的 `bond` → `PUT /bond`，body = ``{"events":[{"pair":"kylinzi|xisha","kind":"bump","affinityDelta":2,"familiarityDelta":1}]}`` → 200 且回账里 `affinity===2`、`familiarity===1`；**再 GET 一次仍是 2**（证明落盘且可读回）；
4. body 非 JSON → 400；`events` 非数组 → 400；body 超 64KB → 413；
5. `GET /balance`（注入回 `unavailable('not-configured')` 的 impl）→ 200 且 `kind==='unavailable'`、`reason==='not-configured'`；
6. **老路径零回归**：`GET /health`、`POST /state`→405、`GET /nope`→404 全部保持；
7. `apply(fakeCtx)` 之后 `readBalanceImpl` 被绑上（断言 `/balance` 回的是 `unavailable` 而不是 500）。

Run: `npm test` → Expected: **74 pass / 0 fail**。

### Step 3: Commit

```bash
git add src/server/entry.js test/entry.test.mjs
git commit -m 'feat(host): /bond GET+PUT 与 /balance GET（凭据绑定在 apply 里）'
```

---

## Task 5: 客户端接账本与余额（`src/stage/client.js`）

**Files:** Modify `src/stage/client.js`、`test/client-contract.test.mjs`；Create `test/client-bond.test.mjs`

### Step 1: 契约镜像

`const BOND = Object.freeze({ AFFINITY_MIN: -100, AFFINITY_MAX: 100, HISTORY_MAX: 50, PAIR_SEP: '|' })`
`const BALANCE_TIERS = Object.freeze([['充裕',100],['健康',50],['正常',20],['偏低',5],['告急',1],['见底',0]])`
两个都进 `__kylinContract`；`SHARED_KEYS` 加 `'BOND'` 与 `'BALANCE_TIERS'`（跨 realm 比较走 `canon()`）。

### Step 2: 启动读账本

`start()` 内、`createWorld` 之前：`GET /bond`，把 `ledger.pairs[world.pairKey]` 交给世界；**读不到就用 `{affinity:0,familiarity:0}`**（降级不崩）。`world.pairKey = pairId(cast[0].id, cast[1].id)`。

**同时把当前账本状态挂进 `__kylinContract.readBond()`**（返回 `{pairKey, affinity, familiarity}` 的**实时快照**，不是加载时的副本）—— Task 6 的「客户端确实读到了」这一半验收**只能**这样证，缺它就只能证 host 侧、证不了客户端。

### Step 3: `bump()` 提交 delta（防抖 2s）

- `bump()` 除了现有表现，追加 `queueBondEvent({ kind:'bump', affinityDelta: +2, familiarityDelta: +1 })`；
- `queueBondEvent` **本地先记**（affinity 立刻影响点击时「好奇凑过来」的概率，**取代 V1 写死的 50%**），再 **2s 防抖** `PUT /bond`；
- **PUT 失败时保留待发队列**，下一个 2s 窗口重试；**不清空** —— 丢了就是关系丢了。

### Step 4: 余额档位播报

`/balance` **每 30s 读一次**（与 1s 的 `/state` 分开：余额变化慢，且它要打外部网络，频率低一点更礼貌）。
`kind:'ok'` 且 `tier` **与上次不同** → `config.cast` 里 `balance === true` 的宠播对应档（`余额充裕/健康/正常/偏低/告急/见底`）+ 冒气泡写档位名。
`tier === null` 或 `kind === 'unavailable'` → **什么都不播**（不猜、不假装）。

### Step 5: 测试

- `test/client-contract.test.mjs`：`SHARED_KEYS` 加两个键。
- 新增 `test/client-bond.test.mjs`：把纯函数挂进 `__kylinContract` 后跨 realm 直接调 —— `pairId` 对称性、`applyBondEvents`（本地施加与夹取，**必须与 host 的 `bond.js` 同语义**）、`tierOf` 边界、**播报判定**（只在 tier 变化时播、null 不播）。

Run: `npm test` → Expected: **84 pass / 0 fail**。

### Step 6: Commit

```bash
git add src/stage/client.js test/client-contract.test.mjs test/client-bond.test.mjs
git commit -m 'feat(stage): 接关系账本（启动读 / bump 防抖提交）与余额档位播报'
```

---

## Task 6: 真浏览器取证（V3 的唯一验收）

**Files:** Modify `tools/harness.mjs`；产出 `evidence/v3/*.png`；计划追加「V3 取证记录」

### Step 1: 验收台升级

1. `bond = createBondStore({ path: <由命令行参数指定> })` —— **路径必须可指定**，否则第 1 条验收（跨重启）没法做；启动时打印 `bond: <path>`；
2. `createHandler({ config, resolveAsset, board, bond, readBalanceImpl })` —— `readBalanceImpl` 默认回 `unavailable('no-credentials-service')`（harness 没有真 ctx）；
3. 加**开发期开关** `POST /__balance?case=<ok|not-configured|shape-unrecognized|tier-null>` 切换 `readBalanceImpl` 的返回，**只为取证降级路径**；注释写明它只在 harness、不在 `entry.js`。

### Step 2: 取证脚本（Playwright，Lead 亲跑；**沿用 V2 的轮询等待，不用固定 sleep**）

1. **关系跨重启存活（本片核心）**：
   a. 起验收台（账本路径 `/tmp/v3-bond-<随机>.json`）→ 打开页面 → 等 3s；
   b. 把麒麟仔拖到鲸鱼娘身上放下（V1 已验证的手法）→ **轮询 `GET /bond` 直到 affinity 变化**（不要 sleep 赌）→ 记 `before = affinity` → 截图 `01-bump.png`；
   c. **杀验收台 → 用同一账本路径重启**（脚本内 spawn/kill）→ 重新打开页面 → 等 3s；
   d. 断言**两件事**：① `GET /bond` 回的值 === `before`（host 存住了）；② 客户端读回了它（用 `page.evaluate` 读 `window.__petExports.__kylinContract.readBond()` 的返回值 === `before`）—— **两条都要**，缺一条就有一半没证；
   e. 截图 `02-after-restart.png`。
2. **余额诚实降级**：`POST /__balance?case=not-configured` → `GET /balance` 断言 `kind==='unavailable'` 且 `reason==='not-configured'`、**响应体里没有任何 total 数字字段**；页面**两只气泡都为空**（没播报）。
3. **余额档位不猜**：切到 `case=tier-null`（回 `{kind:'ok',total:'abc',tier:null}`）→ 断言页面**仍然不播报**。
4. 切到 `case=ok`（回 `{kind:'ok',total:'110.00',tier:'充裕'}`）→ 断言 `balance:true` 的那只（xisha）冒气泡且文本 === `充裕`，另一只不动。
5. 零 console/page 错误。

### Step 3: 写回计划并提交

```bash
git add tools/harness.mjs evidence/v3 plans/2026-10-11-v3-bond-balance-implementation.md
git commit -m 'test(v3): 真浏览器取证（账本跨重启存活 / 余额诚实降级 / 档位不猜）'
```

---

## 自审

**Spec 覆盖**

| spec | 落在 |
|---|---|
| §4.5 账本形状（affinity/familiarity/lastAt/history） | Task 1 `BOND` + Task 2 `normalizePair` |
| §4.5 落盘 `bond.json`、host 独占写入、客户端防抖 2s | Task 2（唯一写入口 `apply`）+ Task 4（PUT）+ Task 5（防抖） |
| §11.4 关系跨重启存活 | **Task 6 Step 2.1（本片核心验收）** |
| §11.7 不伪造 | Task 3（联合类型 + 封闭 reason）+ Task 5（tier=null 不播）+ Task 6 Step 2.2/2.3 |
| §8 余额档位 → `balance:true` 的宠 | Task 5 Step 4 |
| §6「账本只有一条写入路径」 | Task 2 `apply` 是唯一入口；Task 5 只说 `queueBondEvent`，不自己写文件 |

**占位符扫描**：无 TODO / 后续补 / 类似前面。

**已知取舍（写在这里，不留给实施期发现）**：
1. **缺省 handler 的 `PUT /bond` 回 501 而不是「内存临时账本」** —— 刻意：老调用方不该有写用户真账本的机会。
2. **余额 30s 一读**，与 1s 的 `/state` 分开 —— 余额变化慢，且要打外部网络。
3. **`familiarity` 的「只增」host 与 client 各做一遍** —— 允许重复、禁止漂移（与 `KINDS` 同一处置）。
4. **本片不动 `bump()` 的视觉表现**，只加账本副作用 —— 表现层留给 V3b 的导演接管。
5. **币种**：默认 CNY；只有其它币种时取首条并在 `note` 写明。**不静默取 [0]**。
6. **坏账本文件在首次写入前改名留底**（`bond.json.suspect`）—— 否则「绝不覆盖」只在「没人写」时成立，等于没有。

**执行交接**：与 V2 同款 —— 每 Task 派一个干净上下文的子代理，Lead 在验收点核对证据；Task 6 由 Lead 亲跑。




