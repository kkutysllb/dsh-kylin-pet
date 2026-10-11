# dsh-kylin-pet —— 鲸鱼娘 vs 麒麟仔 双宠桌宠设计 Spec

## Goal

基于上游 dsh-pet fork 出 `dsh-kylin-pet` 插件：麒麟仔 + 鲸鱼娘两只桌宠同台常驻（Duet 形态），事件分流响应 + 拖近互怼，资产由 dsh-kylin-images 定妆照 → 图生视频 → ffmpeg 抠像自产。

## 已拍板决策（记录在案）

| # | 决策 | 依据 |
|---|---|---|
| D1 | 「vs」形态 = **A 双宠同台 Duet**：两 actor 独立状态机 + 事件分发表 + proximity 互怼 | 2026-10-11 用户拍板（B 单宠值班 / C 对战小游戏化否决） |
| D2 | 麒麟仔定妆 = 用户参考图（蓝白 Q 版：鹿角、蓝鬃毛/尾、白卫衣 Q 标、wink；性格=机灵爱显摆的讲解者） | 图 sha256 49a8e2c9…3fe648 |
| D3 | 实现 = **fork 上游 dsh-pet**（GitHub PC2005-cloud/dsh-pet，MIT），延续「fork 麒麟分支」模式；**基线已锁定：tag `v0.3.6` = commit `eb7426771`（2026-10-12 M1 实钉；M0 记录的 `9266219` 实为彼时 upstream/main tip、领先 tag 14 提交，按「钉 tag 不钉 main」纪律纠偏）**；origin（`kkutysllb/dsh-kylin-pet`，用户自建）为推送目标 | 改动小、零引擎侵入传统 |
| D4 | 格式线 = **webm-only 先行**（VP9 alpha）；`__PET_EXT__` 占位机制保留，mov/HEVC 后置 | Safari 支持非首期诉求 |
| D5 | 功能取舍 = **保留**余额（服务端代查、key 不下发）+ 失焦通知（rpcId 去重）+ `/balance` 斜杠命令 | 上游两块「带脑子」的功能原样继承 |
| D6 | MVP 动画集 = **12–16 段/只，合计 ≤32 段** | 成本护栏 |
| D7 | 命名 = 包名 / patch 行 id / `__ModuleLoader__` 模块 id 均为 `dsh-kylin-pet`（v0.3.6 STORE 契约：**id 必须与包名一致**，初稿短 id `kylin-pet` 作废）、路由前缀 `/dsh-kylin-pet-7341`、用户目录 `$DSH_HOME/dsh-kylin-pet/`、slot id `kylin-pet`/`kylin-pet-config` | 沿 dsh-kylin-* 命名法；M1 已落地 |
| D8 | ① 鲸鱼娘形象 = **B 案**（2026-10-12 用户拍板）；② dsh-kylin-images 通道问题**不修**、由用户在插件仓自行处理（登记见 plans/2026-10-12-kylin-images-known-issue.md）；③ M1 状态 = **fork 改皮完成、全门验证通过**（记录见 plans/2026-10-12-m1-fork-rebrand.md） | M1 开工定案 |

## Findings（上轮侦查结论，承接入设计）

- **上游架构**（v0.2.0，约 3200 行 TS）：host 半侧纯静态资源服务（/thumb 动画流 + /config 三层 + /balance 服务端代查 + /balance/trigger 计数器轮询）；client 半侧 `__ModuleLoader__` 单文件副作用脚本，挂 `shell.overlay`(order 1000) + `settings.section`(order 30)。
- **动画引擎核心**：640×360 画布、脚底 y=330、hit 盒 200..440×50..335、height=width×9/16；双缓冲 video 交叉淡入 0.18s，**后台视频必须清 onended+pause（拆雷）**；pickNext 权重 idle10/turn5/move5/action80；移动系统纯函数 planMove + rAF 同步 currentTime（leadSec/tailSec）。
- **配置三层**：包内 config.jsonc（默认）→ `$DSH_HOME` main-config.json（覆盖）→ main-animation/{webm,mov}/（片源优先）；合并后再跑一遍 assertClientConfig。
- **环境事实**：① 本地 pnpm store 快照已被 GC，M1 从 GitHub clone；② **本机无 ffmpeg**，资产管线硬前置；③ dsh-kylin-images 在隔壁（img_generate + referenceImages 可锁角色一致性）；④ 本工作区当前为空目录。

## 增量勘察（2026-10-12，M0 执行时按 v0.3.6 复核）

> v0.2.0 分析已部分过时；本节为 v0.3.6 事实，M1 开工前逐面重验。

- **三件套形态**：① `prompts/桌面宠物 10 秒动作提示词.md`（绿幕源视频配方）② 根 `scripts/` 素材链（水印→HSV 抠像/PR 手抠→归一化→640×360 转码）③ `dsh-pet/` 插件本体。**webm 素材不入仓库**（Releases 分发），包内只收播放变体。
- **功能增量**：多开同屏（各宠独立大小/位置）、桌面模式（Electron 透明置顶窗）、pet pack（`pet/<种类>-config.json` + 独立动画池 = 新宠物种类机制）、工作状态联动（思考/工作/整理/等待/成功/出错档）、碎碎念与对话（LLM + 记忆持久化）、右键菜单点播、拖拽弹簧/甩抛反弹物理（`shared/physics.ts` 纯函数）。
- **对本设计的修正**：
  - M2 的 PetActor/多实例 → 上游「多开」已覆盖；Duet 缩窄为：**事件分发表 + proximity 互怼 + 麒麟仔/鲸鱼娘双 pack**（pack 机制正好承载双角色）。
  - 素材管线 → 直接采用上游素材链；自建 chroma-to-alpha.sh 退役。`scripts/check-assets.mjs` 保留为**最终契约门**（640×360/VP9/真实 alpha/2–8s/无音轨），补上游 check_alpha.py（只查 HEVC mov）不覆盖的 webm 交付面。
  - 工作状态联动与事件分发表对齐：上游已有思考/工作/成功/出错档位，Duet 的「谁主响应」表在其上做**角色分流**，不另起事件源。
- **两个技术雷（已实证并写进机检）**：VP9 alpha 只在 `-c:v libvpx-vp9` 解码下可见（原生解码器丢 alpha）；pix_fmt 对 ≠ alpha 有内容，须抽帧验 A 通道层次。
- **图像通道阻塞**：天域通道 `/v1/responses` 不接图像请求（405；`gpt-image-*` 被判 unsupported_model）→ 定妆照生成挂起，提示词已按协议编译就绪。

## 产品形态：双宠同台 Duet

### 角色设定

| | 麒麟仔 | 鲸鱼娘 |
|---|---|---|
| 原型 | 麒麟（用户参考图锁死） | DeepSeek 鲸鱼 IP 拟人 |
| 配色 | 电光蓝 × 白（卫衣白、鬃毛蓝） | 深海蓝 × 浅白 |
| 人设 | 机灵爱显摆的讲解者 | 温和学姐 |
| 职能 | 成功/庆祝/讲解类主响应 | 失败安抚/余额汇报类主响应 |

同框策略：同蓝系、冷暖可分（电光蓝 vs 深海蓝），不打架。

### 事件分发表（v1，Duet 核心）

| 事件 | 主响应 | 搭戏 |
|---|---|---|
| turn 成功 | 麒麟仔 task-ok | 鲸鱼娘 idle 点头 |
| turn 失败/截断 | 鲸鱼娘 task-fail | 麒麟仔 汗/急 |
| 审批/提问等待 | 双方各播一次 notify 探头（rpcId 去重后） | — |
| 余额低档 | 鲸鱼娘 balance-low | 麒麟仔 惊 |
| 长时失焦 | 各自 sleep | — |
| 拖近（<120px，冷却 300s） | 互怼气泡对 + 成对 banter 动画 | — |

### 交互规则

- 两 hit 矩形各自独立；拖拽焦点即 z 序置顶，拖拽中另一方不捕获指针（上游 5px 阈值、justDragged 100ms 守卫照搬）。
- 初始位置：左下/右下错开；位置按 pet 持久化（上游 setCustomPos 已有）。
- proximity 检测并入既有 rAF 循环顺带算距离，**不新增循环**。

## 技术架构（改造面 vs 保留面）

### 改皮清单（M1）

包名、patch 行 id、路由前缀常量（4 处）、用户数据目录、README/LICENSE 归属声明（上游 MIT，注明 fork 自 PC2005-cloud/dsh-pet）。

### 核心改造（M2，唯一伤筋动骨处）

`pet.ts` 单宠 → **PetActor**（每只独立：facing / animChain / position / size / balanceEnabled / 双缓冲对）+ **Duet 管理器**（actor 数组、z 序与拖拽焦点互斥、事件路由表、proximity 与冷却）。

### 原样保留（不动）

双缓冲交叉淡入 + onended 拆雷；移动系统（planMove/leadSec/tailSec）；拖拽阈值与守卫；余额服务端链路（currentSelection → credentials.resolve，20s×3 重试，结果联合类型不伪造）；失焦通知 + rpcId 去重；三层配置 + 二次 assertClientConfig；petBridge 即时生效；`prefers-reduced-motion`。

### 配置 schema 增量

上游 `pets[]` 本就是数组 → 双宠零结构改动，默认配置放两个 pet 条目即可。新增一段：

```jsonc
"duet": { "enabled": true, "proximityPx": 120, "banterCooldownSec": 300 }
```

## 资产管线（M0，全项目最大成本项）

1. **前置**：`brew install ffmpeg`（装机时请求批准）。
2. **定妆**：img_generate（referenceImages 锁麒麟仔参考图）→ 三视图 + 表情差分 ≥8（笑/哭/汗/惊/睡/怒/馋/媚）；鲸鱼娘出 2–3 候选定妆照给用户挑。
3. **动态**：定妆照 → 图生视频（首尾帧法锁一致性），纯色绿幕背景 → ffmpeg colorkey 抠像 → VP9 **yuva420p** webm，640×360。
4. **机检**：`scripts/check-assets.mjs`（ffprobe 断言：尺寸 640×360、时长 2–8s、含 alpha 流、无音轨），不合规进不了 assets/。
5. **MVP 动画集**（每只 14 段）：idle×2 / turn / walk / grabbed / click-happy / task-ok / task-fail / balance-low / notify / sleep / banter×2（成对编排）。

## 里程碑与验收

| 期 | 内容 | 验收 |
|---|---|---|
| M0 资产管线 | ffmpeg 装机 → 麒麟仔定妆三视图 → 差分 → 1 段端到端样片 → 机检脚本 | 样片过 check-assets；最小 HTML harness 播放成功 |
| M1 单宠上桌 | clone+改皮 → 麒麟仔配置 → 构建装机 | typecheck/build 绿；实机 idle 链/拖拽/点击可用；上游 commit 登记在案 |
| M2 双宠引擎 | PetActor/Duet 重构 → 事件分流 → 设置双卡 | 双宠同台；拖拽 z 序互斥；模拟成败事件分流正确；设置保存即时生效 |
| M3 vs 互动 | proximity 互怼 + 冷却 + 成对动画 | 拖近触发一次且冷却生效；无双触发；余额/通知双宠下正确 |

**M1 clone 注意**：plans/ 已占目录，`git clone` 不能直接进——用 `git init + remote add + fetch + checkout`；clone GitHub 需网络，届时走批准。

## 风险登记

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 图生视频角色漂移（帧间服装/花纹不一致） | 定妆照锁 + 首尾帧 + 逐段人工抽检，不合格重生成 |
| R2 | 抠像边缘质量（发丝/半透明） | 绿幕纯净度要求 + colorkey 调参；兜底接受轻微暗边（上游素材本身也有） |
| R3 | 生成成本（~30 段视频 + ~10 张图） | 逐段走审批卡，先出成本预估再放行；MVP ≤32 段硬顶 |
| R4 | 双实例指针事件冲突 | 拖拽焦点互斥 + 被拖方捕获期另一方不响应 |
| R5 | 上游/宿主契约漂移 | fork 登记 commit；装机时按当前 dsh 版本复核 shell.overlay / settings.section / commands / webServer 四面 |
| R6 | 双宠 4 个 video 元素的解码开销 | M2 实测 CPU；超阈值做「失焦宠物暂停渲染」 |
| R7 | ffmpeg 缺席 | M0 第一步装机（批准制） |

## 待用户后续拍板（不阻塞开工）

1. 鲸鱼娘定妆候选（M0 末出 2–3 张挑选）
2. 互怼对白文案（M3 前）
3. MVP 之外的动画增补优先级

## Task List

- [x] M0 资产管线：装 ffmpeg → 麒麟仔三视图定妆 → 表情差分 → 1 段端到端样片 → check-assets.mjs
- [x] M1 单宠上桌：fork 改皮 → 配置 → 构建 → 装机实机验收（上游 commit 登记）
- [x] M2 双宠引擎：~~PetActor → Duet~~ → 上游 v0.3.6 已内建多开/pack/定址通道，缩窄为 workStatusKinds 分工 + 拖近互怼（duet.ts）+ 鲸鱼娘 pack（plans/2026-10-12-m2-duet-engine.md）；设置双卡未做（pack 字段无 UI，挂 M3 可选）
- [ ] M3 vs 互动：成对动画 → 桌面透明窗面分工/互怼对齐 → 台词配置面（可选）→ 回归验证

## Progress Log

- 2026-10-11：D1 双宠同台用户拍板；本 spec 落盘。未动任何产品代码。
- 2026-10-11：M2 落地（见 plans/2026-10-12-m2-duet-engine.md）——上游多开机制复核后缩窄范围；
  分工字段 + 拖近互怼 + 鲸鱼娘 pack 全链验证通过（559/560，唯一红为 M1 同族环境红）。未提交。
