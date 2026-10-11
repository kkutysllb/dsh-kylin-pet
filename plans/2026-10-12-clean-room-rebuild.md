# dsh-kylin-pet v2 —— Clean-room 重建 spec

状态：定稿待评审 | 日期：2026-10-12 | 决策人：用户（「参考不是搬运，不搞 fork」）

## 0. 定性与教训

- v0.3.x 线（分支 kylin/v0.3.6）= 上游 dsh-pet 整仓改名，判定为策略错配，废弃（分支归档不删，仅作机制对照文献）。
- v2 = clean-room：只读上游源码学机制，零上游代码 / 零上游素材 / 零上游文案进仓。
- 机制思想（透明视频桌宠、双缓冲交叉淡入、事件驱动反应链）属公共知识，可用；实现、结构、命名、契约、文案必须原创。

## 1. 保留 / 丢弃台账

保留（我们的）：
- 麒麟仔全套（kylinzi-turnaround/expressions → 8 姿势 webm）与鲸鱼娘全套（whale-girl.png B案定妆 → whale-animation 8 姿势）均为自有提示词生成，属 ours；main-memes 9 张裁自自有差分表，属 ours。素材现散落 staging/m0·m2 与用户目录，R2 入仓归位 assets/pet/
- scripts/check-assets.mjs、gen-poses-direct.mjs、make-poses.mjs、reconcile-anim-names.mjs、install-memes.mjs、install-whale-pack.mjs（M0/M2 自研）
- plans/ 全部文档、staging 证据

丢弃（上游的）：
- dsh-pet/ 整目录（host/client/settings 全部代码）
- 上游素材池 97 段 webm、27 张表情包、字体、全部文案表
- 上游管线脚本 chroma/normalize/encode/watermark 系列 → R1 重写为 scripts/pipeline/encode.mjs（ffmpeg 单脚本）

## 2. 原创模块设计（命名全新）

host（src/server/）：
- static-assets.ts 素材路由：包内→用户目录两级解析 + 路径穿越守卫 + no-store
- pet-config.ts 配置面：包内默认（JSONC）/ 用户覆盖（~/.dsh-kylin-pet/main-config.json）/ 宠物级字段认领
- ledger.ts 余额代查：凭证 ref 解析在宿主侧，key 不下发；联合类型结果，绝不伪造数字
- entry.ts 装配：插件行注入 webServer/credentials/agentDefaultModel

client（src/stage/）：
- stage.ts 双宠容器与层级、拖拽焦点互斥
- actor.ts 单宠执行体：动画队列、透明视频双缓冲、点击/拖拽手势
- chain.ts 闲时行为链：加权掷骰、相位错开、串门意图
- duet.ts 双宠编排：距离侦测、互怼对白、事件分发表（成功/失败/余额→指定角色）
- whispers.ts 碎碎念与表情包选择（文案表独立模块，全部原创）
- settings-panel.tsx 设置页（我们的信息架构）

## 3. 契约（自定）

- 画布 1280×720、脚底 y=660、hit 盒中心 1/2 处 400×560——摆脱上游 640×360 旧约束，素材管线 pad/对齐随之改
- 配置键自定：cast[]（角色表）+ directing{}（导演表：分工/互怼/串门）
- 路由前缀 /dsh-kylin-pet-7341 沿用；patch id=包名沿用引擎 STORE 契约
- 素材格式 VP9 alpha webm（公共事实），机检门沿用 check-assets.mjs

## 4. 关键决策

- D1 物理抛掷/碰撞：不做（YAGNI）
- D2 Electron 透明窗面：不做，web overlay 单面（hidpi/空进程问题设计上消失）
- D3 HEVC 双格式：不做，webm 单格式
- D4 余额/通知：做（账房角色专属职责，见角色 bible）
- D5 素材全部图像生成管线产出 + 绿幕抠像，禁止任何上游帧

## 5. 里程碑

- R1 素材收尾（不重出定妆——已全部完成）：补一张鲸鱼娘表情差分 → 裁 12 张 whale-memes 替换上游池；重写 encode 管线为自有脚本；两角色文案表（口吻/互怼台词）写入 docs/character-bible.md
- R2 本 spec 评审过 → 建 v2 孤儿分支，迁移「保留」清单
- R3 host 原实现 + 隔离实例（/tmp home）HTTP 验收：双角色配置、素材路由、no-store、余额联合类型
- R4 client 原实现 + 真浏览器双宠同框截图为唯一验收（不再让用户刷新验证）
- R5 设置页 + 文案表 + fork 分支归档注释 + openapi 全量重写

## 6. 验收硬门

- grep 上游特征串（表情包文件名/文案句/上游函数名）= 0
- 真浏览器截图：双角色同框、各自动作、互怼触发
- check-assets 19 项/角色全绿
- license 头注明「机制参考 PC2005-cloud/dsh-pet (MIT)，无代码派生」
## 7. 换血执行记录（2026-10-12）

- 换皮分支 kylin/v0.3.6 @ c3072c0 已废弃；删除前源码字节封存于 staging/attic/（dsh-pet-src 103 文件 + upstream-pipeline），不进 git，30 天后可清。
- 上游 remote（PC2005-cloud/dsh-pet）已移除；dsh-pet/ 目录与根级上游文件（API/ECOSYSTEM/LICENSE/README/openapi/prompts/tools/video/.github）已删。
- v2 = 孤儿分支，零上游 blob；根级 assets/pet（我们的表情包）保留。
