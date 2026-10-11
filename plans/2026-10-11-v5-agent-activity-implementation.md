# V5 实施计划 —— agent 任务执行的活动面（动作 + 气泡）

状态：设计待评审 | 日期：2026-10-11 | 前置：v2 双宠舞台已交付并验证（见 [v4 收口](2026-10-11-v4-wrapup-implementation.md)）

## 0. 需求

> 「需要能监测到 agent 任务执行，并且给出气泡框的动作反应和文字」

用户已定的两个岔路：

| 决策 | 取值 |
|---|---|
| 反应频率 | **开始/结束 + 换类工具时**（同类连续调用合并） |
| 气泡文字层级 | **工具类别**（「在翻文件」），不说具体工具名与内容 |

## 1. 现状缺口（实测，非推测）

现在的三个诱因**全部是回合边界**（`src/server/stimuli.js`）：

| 诱因 | 触发事件 | 动作 | 气泡 |
|---|---|---|---|
| `turn-ok` | `agent/turn-stopping` | happy | 「稳了」 |
| `turn-fail` | `agent/error` | sad | 「让我想想」 |
| `waiting` | approval / user-questions | idle + 双方探头 | 「在呢」 |

⇒ **任务执行期间两只宠完全安静** —— 回合开始到结束之间没有任何信号。这就是本片要补的。

## 2. 宿主事件契约（2026-10-11 从 api-catalog 实读）

来源：`<kcoder-runtime>/node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js`

| 事件 | 模式 | 载荷 | 本片用途 |
|---|---|---|---|
| `agent/status` | **emit** | `{ agent, status: 'idle' \| 'running' }` | **总开关** |
| `tools/pre-execute` | **waterfall** | `(exec: {name, 参数}, next)` | 正在调哪类工具 |

> `agent/status` 的目录原文：『Agent status changed (`idle` ⇄ `running`). A waking delivery enters `running` synchronously… `idle` means no driver remains scheduled or active.』
> `tools/pre-execute` 是 waterfall：**必须原样 `next()` 交棒**，吞掉会把工具调用挂死（与审批同一类错误）。

## 3. 设计

### 3.1 两个新诱因

```js
KINDS = ['turn-ok', 'turn-fail', 'waiting', 'working', 'working-done']
//                 ↑ 开始/换类（detail = 类别）  ↑ 收工
```

沿用既有形状：由 `src/server/stimuli.js` 翻译、经板子进 `/state`、client 消费。

### 3.2 工具分类（唯一真源放 shared/contract.js）

```js
export const TOOL_CLASS = Object.freeze({
  read:  ['Read', 'Glob', 'Grep', 'read_image', 'read'],          // 在翻文件
  write: ['Write', 'Edit', 'edit', 'write'],                       // 在改代码
  exec:  ['Bash', 'bash', 'task'],                                 // 在跑命令
  web:   ['WebSearch', 'WebFetch', 'web_search', 'web_fetch'],     // 在查资料
  agent: ['Task', 'subagent', 'dispatch'],                         // 在派活
})
// 未知工具 → 'other'（气泡说「在忙」），不猜。
```

### 3.3 频率控制：**在 host 侧做**，不是 client

理由：① `tools/pre-execute` 每次工具调用都触发，不设门会把 `/state` 刷爆；② 合并逻辑要知道「上一次是什么类」，这在 host 侧是天然的一段闭包状态。

```js
// stimuli.js 闭包内
let lastClass = null
let lastAt = 0
const CLASS_COOLDOWN_MS = 3000   // 换类也要有地板，防「读-写-读-写」抖动

// 只在 **类别变化** 且 **过了地板** 时才 push；其余一律不吭声。
```

### 3.4 动作与文字

**动作**：复用现成素材，**不加新图** ——

```
walk: ['走路', '状态张望', '状态忙碌']    ← 「状态忙碌」就是为这件事准备的
```

`working` 期间播 `walk` 档的 `状态忙碌`（该档是**循环档**，见 `LOOPING`），`working-done` 回 `idle`。

**文字**：按类别，**一只主讲、另一只偶尔应和**（避免两个气泡同时刷屏）—— 麒麟仔主讲（人设活跃），鲸鱼娘在切换类别时偶尔接一句：

| 类别 | 麒麟仔 | 鲸鱼娘 |
|---|---|---|
| `read` | 在翻文件 | （安静） |
| `write` | 在改代码 | 手轻点 |
| `exec` | 在跑命令 | （安静） |
| `web` | 在查资料 | （安静） |
| `agent` | 在派活 | （安静） |
| `other` | 在忙着 | （安静） |
| 收工 | 干完了 | 嗯 |

> 文案口径遵循 `docs/character-bible.md`（原创、贴合两只性格），不复用旧实现任何字符串。

### 3.5 与其他诱因的关系

`working` 期间若来了 `turn-ok`/`turn-fail`/`waiting`，**优先级更高** —— 立刻打断忙碌态（`agent/status → idle` 通常紧随其后，不能让它把结束语盖掉）。

## 4. 验收（硬门）

| # | 门 | 怎么证 |
|---|---|---|
| A1 | `agent/status → running` 产出 `working` | 假 ctx，断言板子上多一条 |
| A2 | `agent/status → idle` 产出 `working-done` | 同上 |
| A3 | **同类连续工具调用只出一条** | 连推 5 个 Read，断言`working` 只有 1 条 |
| A4 | 换类产出新的一条 | Read → Bash → `working` 两条，detail 依次 |
| A5 | **地板冷却生效** | 换类但间隔 < 3s → 不产出 |
| A6 | `pre-execute` **必须交棒** | 假 next 断言被调用过、且只调一次 |
| A7 | 未知工具落到 `other` | 推`TotallyNewTool`，断言 detail === 'other' |
| A8 | client：真浏览器里 `working` 让宠物播`状态忙碌 + 冒泡 | 验收台实测 + 截图 |
| A9 | client：收工回 idle | 截图 |

**负对照（每条都必须真能冒红）**：
- 去掉类别比较（每次都 push）⇒ **A3 必须红**；
- 去掉地板冷却 ⇒ **A5 必须红**；
- 把 `next()` 吞掉 ⇒ **A6 必须红**；
- 类别表里删掉 `exec` ⇒ **A4/A7 必须红**。

## 5. 风险

| 风险 | 处置 |
|---|---|
| `tools/pre-execute` 是热路径，加监听会拖慢每次工具调用 | 闭包内只做字符串比较 + 一次 `push`；**不 await、不做 IO**；用验收台量工具调用前后延迟 |
| 子代理的工具调用也会触发 ⇒ 会不会看起来像主 agent 在忙 | **有意的**：子代理确实是在执行任务。若用户不喜欢，加一个「只看主 agent」开关（本片不做，记为已知取舍） |
| `agent/status` 在唤醒时同步进 `running` ⇒ 可能与 `turn-ok` 交错 | 3.5 的优先级规则覆盖；A2 断言收工一定压过忙碌 |
| 长时间任务里`状态忙碌`循环播放显得呆 | 素材是循环档，属**预期**；若观感不好再议（本片不动素材） |

## 6. 改动面（预估）

| 文件 | 改什么 |
|---|---|
| `src/shared/contract.js` | `KINDS` +2、`TOOL_CLASS` 新增 |
| `src/server/stimuli.js` | 两个监听 + 分类/冷却闭包 |
| `src/stage/client.js` | 气泡表 +2、档位表 +2、优先级、忙碌态生命周期 |
| `test/stimuli.test.mjs` · `test/client-v3b.test.mjs` | A1–A7 |
| `tools/harness.mjs` | 验收台加 `/__status?to=running\|idle` 与 `/__tool?name=` 两个 dev-only 注入口 |
| `docs/character-bible.md` | 新文案入册 |

## 7. 不做的事

- 不加新素材（复用「状态忙碌」）；
- 不说具体工具名/参数/内容（用户已定「只说类别」）；
- 不改既有三个诱因的任何行为（回归检查守住）。

---

# V5 执行记录（Lead 亲跑，2026-10-11）

状态：已实施并通过全部硬门。**152 → 167 例**（+15）。

## 硬门结果

| # | 门 | 结果 | 证据 |
|---|---|---|---|
| A1 | agent/status → running 产出 working | ✅ | test/stimuli.test.mjs A1/A2 |
| A2 | idle 产出 working-done | ✅ | 同上 |
| A3 | 同类连续工具只出一条 | ✅ | 连推 5 个 Read ⇒ 1 条 |
| A4 | 换类产出新一条 | ✅ | Read → Bash ⇒ ['read','exec'] |
| A5 | 地板冷却 | ✅ | 间隔 < 3s 不产出；**被挡后不更新 lastClass**，之后同类再来仍算换类 |
| A6 | pre-execute 必须交棒 | ✅ | next 恰好一次、返回值原样传出 |
| A7 | 未知工具落 other | ✅ | TotallyNewTool ⇒ other |
| A8 | 真浏览器：在忙播「状态忙碌」+ 冒泡 | ✅ | evidence/v5/01-working.png · 12/12 拍 状态忙碌 · 出现在 **608ms** |
| A9 | 收工回 idle | ✅ | evidence/v5/03-done.png · 「干完了」+「嗯」 |

## 负对照（全部实跑）

| 变异 | 必须红 | 实际 |
|---|---|---|
| 去掉类别比较（每次都 push） | A3 | ✅ A3 + A5 |
| 去掉地板冷却 | A5 | ✅ 仅 A5 |
| 吞掉 next() | A6 | ✅ 仅 A6 |
| 类别表删掉 exec | A4 | ✅ 仅 A4（**计划里写的 A7 是错的** —— A7 测的是**未知**工具，与 exec 无关） |

## ⚠️ 取证抓到的三处产品缺陷（本地测试全绿，只有真浏览器能发现）

1. **「状态忙碌」实际不可见 —— 导演每帧把它盖掉。** 帧序是 world.step → director.step，**导演是最后写者**；它的独处分支每帧都 play。插桩实测：忙碌分支在一段采样里被触发 **186 次**而画面纹丝不动。修：只有 !m.working 时才排独处动作。
2. **合演把「在忙」挤没了。** 取证采样 **16/18 拍在演剧本** —— 用户要的「动作反应」看不见。修：socialGate 加 working / partner-working 两条闸。修后 0/18 拍合演。
3. **正在散步的宠要走到站才切忙碌。** 修：working 时清 target（「听到有活就停下手里的散步」）。

> 第 1 条与 NEAR_RADIUS(150) < minGap(156.8) 是**同一类**：条件在数学上成立、在运行期恒假，
> 而**单元测试全都够不到它** —— 因为覆盖它的那一行在另一个子系统里。

## 我自己在这片里犯的错（如实登记）

| # | 错 | 怎么发现的 |
|---|---|---|
| 1 | client 里用了 BUSY_CLIP **却没镜像** ⇒ 一进忙碌分支就 ReferenceError | 167 例全绿 —— **没有测试走过那个分支**。补：镜像 + 进 SHARED_KEYS + 加能走到的测试 |
| 2 | 地板判据 at - lastAt >= 3000 在 lastAt === 0 时依赖时钟巨大 | 测试用小时钟 ⇒ 第一次就被挡住。改「lastAt === 0 ⇒ 永远允许」 |
| 3 | 漏改函数签名 ⇒ ReferenceError: opts is not defined | 17 例红 |
| 4 | 取证脚本**连着三个**错：推完立刻断言、拿带 .webm 的名字比段名、在 5 秒保持循环**之后**才查气泡（早淡出了） | 三次红都是假的 |

> 第 4 条值得单记：**取证脚本本身也会「测错东西」**，而且它的红看起来和产品缺陷一模一样。
> 三次我都是先怀疑产品，靠插桩（谓词计数器、探针并排读）才分出真假。

## 计划的两处修正

- §4 NC4 的预期从「A4/A7」改为 **A4** —— A7 测的是**未知**工具落 other，与删掉 exec 无关；
- §3.4 里「鲸鱼娘偶尔应和」实现为 **只在收工那一下**（ECHO_DONE），不在「在忙」期间：
  计划自己写了「避免两个气泡同时刷屏」，而在忙期间每次换类都应和正是那个问题。

## 改动面（实际）

| 文件 | 改了什么 |
|---|---|
| src/shared/contract.js | KINDS +2 · TOOL_CLASS / classifyTool · BUSY_CLIP |
| src/server/stimuli.js | agent/status 与 tools/pre-execute 两个监听 + 合并闭包 + opts.now |
| src/stage/client.js | 镜像 2 处 · 两张文案表 · busyClipOf 纯函数 · deliverStimulus 执行期分支 · socialGate 两条闸 · idleChain 忙碌分支 · 导演独处分支加门 · 清掉死常量 CLIP_OF · 探针加执行期字段 |
| tools/harness.mjs | /__status · /__tool 两个 dev-only 注入口 |
| docs/character-bible.md | §5.1 加行 · 新增 §5.3（按类别的台词表） |
| 测试 | stimuli +8 · client-v3b +6 · contract +1 · bible +1（§5.3 对账） |
