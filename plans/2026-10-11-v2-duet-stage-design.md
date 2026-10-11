# dsh-kylin-pet v2 —— 舞台 / 心智 / 导演 实现设计

状态：**已评审**（2026-10-11 用户同意 §13 四项建议）｜ 日期：2026-10-11（真实日期；仓内 `2026-10-12-*` 四份文档的标签比其 mtime **晚**一天，本文件用真实日期）
取代范围：`2026-10-12-clean-room-rebuild.md` **§2 模块设计** 与 **§3 契约**（其余章节继续有效）

---

## 0. 本文件要解决什么

`clean-room-rebuild.md` 定了 v2 的**性质**（原创实现、零上游 blob）；本文件定 v2 的**实现结构**：

> 把桌宠从「两只各跑各的动画状态机、靠近时互怼一下」重做成
> **一个共享舞台 + 两只各有心智的演员 + 一个导演**，互动成为舞台上的一等实体。

判据在最上：**互动是对象，不是副作用。**

---

## 1. 与前序文档的冲突裁决

| 前序记录 | 本文件裁决 | 依据 |
|---|---|---|
| §2 模块命名：host `static-assets/pet-config/ledger/entry.ts`；client `stage/actor/chain/duet/whispers/settings-panel.tsx` | host **沿用**；client **改为单文件 `src/stage/client.js` 内的分层小节** | 宿主契约强制（§2 事实 1、2）：client 必须是普通副作用脚本，**禁止顶层 ESM import/export**，且工厂内标识符不得外泄——多文件 ESM 客户端在本质主上不可能 |
| §3 画布 1280×720、脚底 y=660、hit 盒 400×560，「素材管线 pad/对齐随之改」 | **废除固定画布**：视口即场地；素材契约保持 **640×360**；命中区从本仓素材实测导出 | 38 段素材已按 640×360 产出并全过机检（§2 事实 4/5）。1280×720 要求重做 pad，是纯浪费。且 §3 的 400×560 只是把上游 v0.2.0 命中盒（200..440 × 50..335 @640×360）换算到 1280×720 上，**两边比例并不一致**（半宽 0.156 vs 0.1875、上沿 0.111 vs 0.139）⇒ 本文件**不引用任何一方**，改从实测包围盒导出（§4.3） |
| §3 配置键 `cast[]` + `directing{}` | **沿用**（已落盘 `assets/default-config.jsonc`，见 §4.1） | 已写好且自洽，无理由推翻 |
| §2 的 `chain.ts` / `duet.ts` / `whispers.ts` | 概念并入 心智 Mind / 导演 Director / 互动剧本 Interactions / 文案表 LINES | 目标不变，分层更清楚：**决策、仲裁、剧本三者分离** |
| README 路线图把「骨架」标为 `[x]` | **改回 `[ ]`** | `src/` 当前不存在，该勾不实（§2 事实 9） |

---

## 2. 已核实硬事实（本文件的全部证据基础，均本次一手核验）

| # | 事实 | 证据 |
|---|---|---|
| 1 | **client 交付契约**：`window.__ModuleLoader__.load({ id, factory })`，工厂收 `require`；加载器读 `exports.inject` / `exports.apply`；顶层 ESM `export` 不认；**裸 CJS 顶层标识符会与他人相撞**，报 `Identifier 'name' has already been declared`、整个 client 装配失败 | `~/.kcoder/profiles/web/node_modules/dsh-shell-prefs/client.js:17-28`（同环境内**可运行的手写 client 插件**，注释即踩坑记录） |
| 2 | **宿主插件契约**：`export const name` / `export const inject` / `export function apply(ctx)`；路由用 `ctx.effect(() => ctx.webServer.register({ kind:'prefix', path, handler }), label)` | `staging/attic/dsh-pet-src/src/host/index.ts:112,114,239,1185-1203` |
| 3 | **浏览器侧 DSH 事件流已被引擎删除**（0.1.5 起无 `api.events.mux/host`）⇒ DSH 事件**只能在 host 侧观察**，前端只能轮询 | 同上 `:49-52,1504-1506` 注释原文 |
| 4 | **素材真值**：38 文件（19×2）机检 **38/38 PASS** — 640×360 / yuva420p / alpha[0..255] / 2.50–4.79s | 本次实跑 `node scripts/check-assets.mjs` |
| 5 | **素材几何**：640×360 画布、角色高默认 300px、**脚底 y=330**、水平居中 | `scripts/make-poses.mjs:19,65-70` |
| 5b | **角色包围盒实测**：并集 x 208..431（中心 319.5 ≈ 盘心 320）、y 30..329（高 300，脚底 329→330） | 本次 `ffmpeg -c:v libvpx-vp9 -vf alphaextract,bbox` 两只 × 三档 |
| 6 | **ffprobe 假象**：直接 ffprobe 报 `pix_fmt=yuv420p`，强制 `-c:v libvpx-vp9` 才显 `yuva420p`；`alpha_mode=1` 标签在场 | 本次实跑两种探法对照 |
| 7 | **真实美术只有 6 段/宠**：19 个文件名 → **6 个不同 md5**，其余 13 个是语义别名拷贝 | 本次 md5 分组：`待机/状态思考/状态整理/碎碎念`、`走路/状态张望/状态忙碌`、`转身`、`被拎起`、`安抚失败/余额偏低/告急/见底`、`点击开心/开心跳跃/庆祝成功/余额健康/充裕/正常` |
| 8 | **运行时**：`@deepseek-ai/dsh 0.2.1-alpha.2`；`DSH_HOME=/Users/libing/.kcoder`；`shell.overlay` 插槽在场 | `kcoder-runtime/package.json`；`env`；`dsh-client-ui-workspace` 使用点 |
| 9 | **仓状态**：v2 尚无 `src/`；清仓改动（399 D / 4 M / 10 ??）**全未提交**，挂在 `kylin/v0.3.6`；孤儿分支未建；`assets/pet/` 只有 main-memes 9 张，38 段 webm 仅存在于 `~/.kcoder/dsh-kylin-pet/pet/`（`staging/` 被 gitignore） | `git status --short`、`find` |
| 10 | **DSH home 解析规则**：`DSH_HOME` 环境变量优先，否则 `~/.dsh`（可 3 行自实现，无需依赖包） | `dsh-home-paths/lib/index.js:11-15,55-57` |
| 11 | 上游行为档名（`状态*` / `余额*`）**不是资源需求**，只承载事件语义 | 由事实 7 直接推出 |

> **事实 7 的份量**：它决定互动表现力的天花板。视觉动词只有 **{待机, 走路, 转身, 被拎起, 难过, 开心}** + 左右翻转 + 时序相位 + 气泡文本。§7 的剧本全部在此预算内编排；想要更强演出，**唯一杠杆是补美术**（接口按名字表驱动，补片不改代码）。

---

## 3. 架构

```
        DSH 事件（turn 成败 / 审批等待 / agent 错误 / 余额）
                      │  host 侧监听（事实 3：前端拿不到事件流）
                      ▼
              ┌─ 诱因板 Stimulus Board ─┐   ← host：写进 /state，计数器自增
              └───────────┬─────────────┘
                          │  1s 轮询 /state（只取 counter 变化的帧）
                          ▼
  ┌──────────────── 导演 Director ────────────────┐
  │ 仲裁：动作槽 / 优先级 / 冷却                    │
  │ 配对：把「社交意图」升格为 Interaction 并跟踪收尾 │
  └───────┬───────────────────────────────┬───────┘
          │ 演出授权                        │ 演出授权
     ┌────▼────┐                     ┌────▼────┐
     │ 心智 Mind │←── 关系账本 Bond ──→│ 心智 Mind │   ← 每只宠独立
     └────┬────┘                     └────┬────┘
          │ 意图 Intent                    │ 意图 Intent
     ┌────▼────────────────────────────▼────┐
     │         世界 World（唯一权威）          │  ← 视口即场地
     │   位置 / 朝向 / 速度 / 边界 / 让路      │
     └────┬────────────────────────────┬────┘
     ┌────▼────┐                     ┌────▼────┐
     │ 演员 Actor│ 双缓冲 video · 气泡 · 手势 │ 演员 Actor│
     └─────────┘                     └─────────┘
```

两条铁律：

1. **宠不直接改自己的位置**，只提交「我想去哪」；位移由世界推进 ⇒ 「走向对方」与「让路」在同一处协调，不穿模。
2. **心智不直接播动画**，只产出意图；演出授权由导演发放 ⇒ 冲突（两只同时要唯一动作槽）有唯一裁决点。

---

## 4. 契约

### 4.1 配置（沿用已落盘键，零新增必填项）

```jsonc
cast: [{ id, name, anchor, size, animationDir, memeDir, balance }]   // 现有
directing: {
  workStatus: { <id>: ['ok'|'fail'] },   // 职责档位
  duet: { distance: 120, cooldownSec: 300 }
}
```

**语义澄清（不破坏键、只钉含义）**：`directing.workStatus` 是**响应资格**，不是表演指令——被授权的那只宠**有资格**接这个档的事件，具体演什么由它的心智在资格内自选。这是「涌现搭戏」与既有契约的接缝。

三层读取：包内 `assets/default-config.jsonc` → 用户 `$DSH_HOME/dsh-kylin-pet/main-config.jsonc`（深合并、数组整组替换）→ 素材目录按宠独占。`anchor` 含义明确为**归位锚点**（待机/睡觉/散场后回到的位置），不是活动范围限制。

### 4.2 路由（前缀 `/dsh-kylin-pet-7341`）

| 方法 | 路径 | 职责 |
|---|---|---|
| GET | `/config` | 合并后的成品配置（`cache-control: no-store`） |
| GET | `/state?since=<n>` | 诱因板 + 各宠台词/动作槽；`{ counter, stimuli[], pets{} }` |
| GET/PUT | `/bond` | 关系账本（跨会话持久化，见 §4.5） |
| GET | `/pet/<role>/<anim>.webm` | 动画素材（用户目录优先 → 包内），路径穿越守卫 + no-store |
| GET | `/memes/<role>/<name>.png` | 表情包 |
| POST | `/balance` | 触发一次余额代查，结果写 `/state` |

`<role>` 取 `cast[].id`；`<anim>` 是中文名，**客户端负责 `encodeURIComponent`**（中文文件名的 URL 契约要显式写测试）。

### 4.3 舞台几何（比例制，取代固定画布）

素材盘 640×360。**实测包围盒**（`ffmpeg -c:v libvpx-vp9 -vf alphaextract,bbox`，两只 × 三档）：

| 素材 | x1..x2 | y1..y2 |
|---|---|---|
| 麒麟仔 待机 / 走路 / 点击开心 | 241..398 ／ 218..421 ／ 232..407 | 30..329 |
| 鲸鱼娘 待机 / 走路 / 点击开心 | 233..406 ／ 241..398 ／ 208..431 | 30..329 |
| **三档并集** | **208..431**（中心 319.5 ≈ 盘心 320） | **30..329** |

即角色在盘内实际占横向 0.325–0.673、纵向 0.083–0.914。派生常量**全部来自上表，不引用前序文档**：

| 常量 | 值 | 来源 |
|---|---|---|
| `FOOT_RATIO` | 330/360 = **0.91667** | 脚底线（实测 y2=329，make-poses 取 330） |
| `CHAR_TOP` | 30/360 = **0.08333** | 实测 y1，即命中区上沿 |
| `HIT_X` | **0.30 – 0.70** | 实测并集 0.325–0.673，两侧各留 0.025 起手余量 |
| `HIT_BOTTOM` | = `FOOT_RATIO` | 命中区下沿到脚底 |
| `CHAR_RATIO` | 300/640 = **0.46875** | 角色高 ÷ 盘宽（换算用） |

摆放：给定脚点 `(x, y)` 与 `size`（盘宽 px）⇒ 盘高 `size×9/16`、左上角 `(x−size/2, y−盘高×FOOT_RATIO)`。
命中区一律按 `size` 换算 ⇒ **换 size 不碰任何素材**。

### 4.4 素材语义表（名字 → 行为档）

真实美术 6 段（事实 7），19 个名字全在表里，代码**只认表**：

| 行为档 | 真实片 | 同片别名 |
|---|---|---|
| `idle` | 待机（loop） | 状态思考、状态整理、碎碎念 |
| `walk` | 走路（loop） | 状态张望、状态忙碌 |
| `turn` | 转身（once） | — |
| `held` | 被拎起（持握期） | — |
| `sad` | 安抚失败（once） | 余额偏低、余额告急、余额见底 |
| `happy` | 点击开心（once） | 开心跳跃、庆祝成功、余额健康、余额充裕、余额正常 |

⇒ 新增美术时只往表里加档位，**剧本代码零改动**。

### 4.5 关系账本

```jsonc
{ "pair": "kylinzi|xisha",
  "affinity": 0,        // -100..100，互动结果累加，缓慢回归 0
  "familiarity": 0,     // 0..∞，只增，解锁更亲密剧本档位
  "lastAt": 0, "history": [ { kind, at, delta } ]   // 环形，上限 50
}
```

落盘 `$DSH_HOME/dsh-kylin-pet/bond.json`（host 独占写入；客户端经 `PUT /bond` 提交、防抖 2s）。
**关系是跨会话的**：重启引擎不归零——这是与上游「无状态互怼」最大的产品差别。

---

## 5. 心智 Mind（每只宠独立）

状态：`mood ∈ [-1,1]`、`energy ∈ [0,1]`（活动衰减 / 随时间恢复）、`attention`（自由/被吸引/专注对方）、`bond`、`recent[]`（最近 N 次互动）。

每拍（约 1s，与 `/state` 轮询对齐）对候选意图打分，**门控优先、再加权**：

```
score = Σ w_i × fit_i(intent) + jitter
门控：冷却未过 → 淘汰
      社交类且对方不可响应（被拎起 / 正在合演 / 免疫期）→ 淘汰
      社交类且对方距离 > 社交半径 → 改判为「靠近」或淘汰
```

| 意图族 | 候选 | 主要修正项 |
|---|---|---|
| 独处 | 待机 / 散步 / 打盹 / 张望 | energy↓ → 打盹；mood↑ → 散步 |
| 社交 | 靠近 / 打招呼 / 献宝 / 挑衅 / 安慰 / 并肩 / 追逐 / 和好 / 争抢 | affinity、familiarity、距离、对方 mood |

权重表集中在 `TUNING` 一节，**只在一处调参**。

---

## 6. 导演 Director 与互动 Interaction

- **动作槽**：全场最多 1 个合演 + 每宠至多 1 个独演。
- **仲裁**：意图升格为合演需配对成功；两只同时要同一槽时按 `优先级 = |affinity| × 意图强度 × 新鲜度` 裁决，败者退回独处链（**不报错、不排队**）。
- **Interaction 对象**：`{ kind, initiator, responder, phase, deadline, outcome }`，四阶段 `approach → open → exchange → settle`；超时或对手被用户拖走即 `abort`（并写记忆：被谁打断）。
- **收尾唯一入口**：导演写关系账本 + 双方记忆，然后销毁对象。剧本不得自己写账本（保证账本只有一条写入路径）。

---

## 7. 互动剧本（8 种，全部在 6 段美术预算内）

| 剧本 | 编排（只用 §4.4 的档位） | 关系效果 | 解锁条件 |
|---|---|---|---|
| 打招呼 | 走近 → turn 相对 → 各放 happy | +2 | 恒可用 |
| 献宝 | 走近 → 气泡推一张表情包 → 对方 happy 或无视 | +3 / −1 | familiarity ≥ 3 |
| 挑衅 | 凑近 → turn 背对 → 对方 sad | −3（发起方 mood+） | familiarity ≥ 5 |
| 安慰 | 对方 mood < −0.3 → 走近 → 轻声气泡 → 对方 happy | +5 | 恒可用 |
| 并肩 | 双方 idle 相向、呼吸相位错开 → 各自散开 | +3 | affinity ≥ 20 |
| 追逐 | 挑衅命中后 → 双方 walk、撞边界换向 | +2 | 挑衅命中 |
| 和好 | affinity < 0 且久未互动 → 主动靠近 + 献宝 | **+8** | affinity < 0 |
| 争抢 | 双方冲向同一点，先到者得 | ±2 | energy 高 |

台词全部走独立文案表 `LINES`（角色 × 剧本 × 心情 分档，**全原创**），与逻辑解耦。

---

## 8. 用户手势与 DSH 诱因

- **点击**：被点者 happy；对方是否好奇靠近由 affinity 决定（**不写死**）。
- **拖拽**：拎起即退出社交（`held`）；把两只拖到一起放下 → 立即触发一次近距离互动；放下后 2s 免疫。
- **DSH 诱因**（host 侧监听 → 诱因板 → 心智消化，**不直接点播动画**）：

| 事件 | 诱因 | 资格（`directing.workStatus`） |
|---|---|---|
| turn 成功 | `turn-ok` | `ok` 档宠 |
| turn 失败/截断 | `turn-fail` | `fail` 档宠 |
| 审批/提问等待 | `waiting` | 双方探头 |
| 余额档位变化 | `balance-*` | `balance:true` 的宠 |
| agent 错误 | `error` | `fail` 档宠 |

搭戏因此是**涌现的**：麒麟仔庆祝时鲸鱼娘是否过来，取决于 affinity 与它当下的状态。
（事件名以 0.2.1-alpha.2 实测为准——上游档位监听写在更早版本上，见 §12 R2。）

---

## 9. 文件布局

```
src/server/          entry.js  pet-config.js  static-assets.js  state.js  stimuli.js  ledger.js
src/stage/client.js  单文件（宿主契约强制），内部分层：
                     §1 契约常量  §2 LINES 文案表  §3 World 世界  §4 Mind 心智
                     §5 Director 导演  §6 INTERACTIONS 剧本表  §7 Actor 演员  §8 挂载与主循环
assets/pet/{main,whale}-animation/*.webm   (38 段)
assets/pet/{main,whale}-memes/*.png
assets/default-config.jsonc
tools/harness.mjs    开发期：起一个免鉴权页面加载 client.js（stub require/ctx），供真浏览器截图
```

**零构建、零依赖**：host 只依赖 Node 内置 + `ctx` 服务；client 只经工厂 `require` 取 react。DSH home 自行解析（事实 10）。

**契约漂移防线**：client 无法 import host 常量（单文件约束），路由前缀/素材档位等共享常量**必然重复一份**。用一格测试钉死：node 侧同时加载 host 模块与 client 工厂，断言两边常量逐字相等——**允许重复，禁止漂移**。

---

## 10. 里程碑（垂直切片，每片独立可验收）

| 片 | 内容 | 验收 |
|---|---|---|
| **V0 仓务** | 建 v2 孤儿分支 → 提交清仓 → 38 段素材 + memes 归位 `assets/pet/` → README 纠偏（去掉不实的 [x]）→ 本 spec 入册 | 工作树干净；`check-assets.mjs assets/pet` **38/38 PASS**；上游特征串 grep = 0 |
| **V1 上桌** | host entry/pet-config/static-assets + 路由；client 世界/演员（待机链、拖拽、点击、边界） | 隔离实例 HTTP 全绿；真浏览器 harness 双宠同框截图（各自动作、拖拽置顶） |
| **V2 事件面** | host stimuli/state + 工作状态分流 + 余额 + 气泡 | turn 成败注入 → 指定宠响应；余额联合类型（**绝不伪造数字**） |
| **V3 双宠社交** | 心智 / 导演 / 8 剧本 / 关系账本 | 剧本触发一次且冷却生效；账本跨会话存活；harness 截图取证 |
| **V4 收口** | 设置页 + `docs/character-bible.md` 文案全量 + 路线图更新 | 设置保存即时生效；文案 100% 原创 |

V1 起每片结束都要跑：`node --test src/`、`node scripts/check-assets.mjs assets/pet`、真浏览器 harness 截图。

---

## 11. 验收硬门

1. **clean-room**：上游特征串（上游文件名 / 文案句 / 函数名）grep = 0。
2. **素材**：`check-assets.mjs` 38/38 PASS（640×360 / VP9-alpha / 2–8s / 无音轨）。
3. **双宠同框**：真浏览器截图（harness 页），两只各自独立动作 + 至少一次剧本触发——**不以「用户刷新一下看看」作为验收**。
4. **关系连续**：账本跨引擎重启存活。
5. **零构建**：引擎按 package.json 的 main/exports 直接加载源码，无构建步骤、无编译产物。
6. **契约不漂移**：共享常量一致性测试绿。
7. **不伪造**：余额取不到就是取不到，联合类型显式表达，绝不出假数字。

---

## 12. 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | **表现力天花板 = 6 段美术**（事实 7） | 剧本按预算编排；接口按名字表驱动，补片不改代码；「补美术」是唯一有效扩展杠杆 |
| R2 | 宿主事件名在 0.2.1-alpha.2 可能已变（上游档位监听写在更早版本） | V2 开工第一件事**实测钉死**事件名；钉不死则降级为只接 turn 成败 |
| R3 | `ctx.credentials` / `ctx.llm` 在零依赖下无类型、形状未实测 ⇒ 余额可能做不通 | V2 先做「取不到就诚实降级」路径；接口面不通则余额整体降级为登记项，不硬撑 |
| R4 | 双宠 4 个 video 元素解码开销 | 失焦/离屏宠暂停渲染（`IntersectionObserver` + `document.hidden`） |
| R5 | 中文文件名的 URL 契约（`encodeURIComponent`、Windows 编码） | 显式写测试；素材名表集中一处 |
| R6 | 2D 位移观感（走路同时纵向平移） | 限制纵向速度；观感不佳则退回「同排水平移动」（改 `anchor` 默认值即可，不动代码） |
| R7 | 双宠空闲链同拍（上游踩过：同刻进随机链 → 长期同步） | 初始相位随机 + 每宠独立种子；世界级节拍器只做轮询，不同步动画 |

---

## 13. 待你裁决（不阻塞 V0/V1）

1. **余额范围**：只做 DeepSeek 官方 + 账号两条（其余留扩展点），还是一次做全四家？
   建议：**先两条**，每多一家人肉验一次真机再加。
2. **设置页**：V4 做「关系重置 + 双方状态只读展示」的最小版，还是完整表单？
   建议：**最小版**，配置改文件即可（三层读取路径明确）。
3. **纵向位移**：接受「边走边平移」的观感，还是初始就把两只放同一排？
   建议：**先做 2D**，看不顺眼改一个默认值即可回退。
4. 本 spec 的**文件名日期**（用机器日期 2026-10-11，仓内 v2 批次标 10-12）——要统一成 10-12 一秒改完。

---

**裁决记录（2026-10-11，用户答复「四件事都同意你的建议」）**：① 余额先做 DeepSeek 官方 + 账号两条，其余留扩展点；② 设置页做最小版（关系重置 + 双方状态只读）；③ 纵向位移先做 2D，观感不佳改默认值回退；④ 文件名保留真实日期 `2026-10-11`（仓内 10-12 那批的标签晚一天，不追改已提交文档）。

---

## 14. V3 前置侦察（2026-10-11，Lead 实测）

spec §12 R3 的结论现在明确了，先钉在这里，免得 V3 开工时重新摸：

1. **宿主不提供任何余额面。** 在运行时的 `@deepseek-ai` 全部包里 grep `user/balance` 与 `/balance` —— **零命中**。余额只能是我们自己发起的网络调用，**不能指望宿主给**。
2. **但「取凭据」这条路是通的**：`launchEnvironmentOf(ctx).get(ref)?.value`（`@deepseek-ai/dsh-launch-environment`）。运行时里有两处真实用法：
   - `dsh-experimental-translator/lib/types/deepseek.js:126` —— `launchEnvironmentOf(ctx).get(apiKeyRef)?.value.length ?? 0`（判「配没配」的手法：看长度是否为 0）
   - `dsh-credentials-local/lib/types/index.js:507,516` —— `getFrom(ref, ['process'])` / `getFrom(ref, ['project-env','user-env'])`
   
   **注意第二条**：凭据是**有来源分层的**（process / project-env / user-env），取值时要显式给来源列表，不是一锅端。
3. `ctx.credentials` 的 `describe(ref) → { configured }` 适合做**前置判定**：没配就直接 `unavailable`，省一次网络往返。

**对 V3 计划的直接约束（先定下来）**：

- ledger 的联合类型必须**先有 `unavailable` 分支、再谈取值**（对齐 §11.7「绝不伪造数字」）；
- 「取不到」的**原因必须分类**（未配凭据 / 网络失败 / HTTP 非 200 / 响应形状不认识）——它们对用户意味着**不同的动作**，糊成一个字符串等于没报；
- 余额探针必须**可注入**（不注入就只能打真网络，测试里没法跑）；
- 本机 `DEEPSEEK_API_KEY` 是否在场、DeepSeek 余额接口的确切形状，**留到 V3 计划期用一次真实调用钉死**（与 V2 钉事件名同一手法）。

