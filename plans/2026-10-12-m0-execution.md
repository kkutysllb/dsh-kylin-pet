# dsh-kylin-pet — M0 资产管线执行记录（living plan）

> Spec: [2026-10-11-kylin-pet-duet-design.md](2026-10-11-kylin-pet-duet-design.md) · 2026-10-12 执行

## 任务板（收尾状态）

| # | 任务 | 状态 |
|---|---|---|
| M0-1 | ffmpeg 就绪 | ✅ brew 装 9.0.2（`/opt/homebrew/bin/ffmpeg`）；PATH 被 `~/.openclaw/bin/ffmpeg`（4.4）遮蔽，脚本一律显式路径 |
| M0-2 | 上游 fetch 预热 | ✅ `upstream/main=9266219`，最新 tag **v0.3.6**；origin（用户已建 `kkutysllb/dsh-kylin-pet`）未动 |
| M0-3 | 机检脚本 + 自测 | ✅ `scripts/check-assets.mjs`：4 坏样本各命中预期缺陷 + 假 alpha 被抓 + 真管线样本 PASS |
| M0-4 | 抠像→alpha 管线 | ✅ 改采**上游素材链**（`scripts/chroma_step02→normalize_step03→encode_thumbs`）；自建 chroma-to-alpha.sh 已退役；绿幕→透明→机检端到端 PASS |
| M0-5 | 定妆照生成 | ✅ 三张全出并验收（[design/](../staging/m0/design/)）：三视图 2048x1152 · 表情差分 2048x2048（九宫格九表情）· 鲸鱼娘 A/B 双案各三视图；排障过程见下节 |
| M0-6 | 汇报 | ✅ |

## 本轮排掉的两个技术雷（写进机检的设计依据）

1. **VP9 alpha 只在 libvpx 解码器下可见**：ffmpeg/ffprobe 默认原生 vp9 解码会把 `yuva420p` 丢成 `yuv420p`（编码从未丢 alpha，是「看」的方法错了；上游 encode_thumbs.py 注释同款警告）。→ 机检 pix_fmt 一律强制 `-c:v libvpx-vp9` 复测。
2. **pix_fmt 对 ≠ alpha 有内容**：吸收上游 check_alpha.py 思路，抽帧验 A 通道真实层次（max>200 且 min<100），整帧不透明的假 alpha 当场报 FAIL。

## 自测证据（staging/m0/selftest/，均可复跑）

| 样本 | 机检结果 | 验证点 |
|---|---|---|
| duet-sample.webm（绿幕→抠像） | PASS（640x360 yuva420p 3.00s alpha[0..255]） | 端到端真管线 |
| bad-size.webm | FAIL：尺寸 320x180 ≠ 640x360 | 尺寸门 |
| bad-audio.webm | FAIL：含 1 条音轨 + alpha 层次不足 | 音轨门 + alpha 门 |
| bad-duration.webm | FAIL：12.00s ∉ [2,8]s | 时长门 |
| alpha-proof.png（暗底合成帧） | 画面零绿残留 | 透明视觉实证 |

复跑：`node scripts/check-assets.mjs staging/m0/selftest`（期望：duet-sample PASS，三个 bad 各自 FAIL）

## 上游 v0.3.6 勘察增量（影响 M1/M2）

- 上游已是「三件套」：① `prompts/桌面宠物 10 秒动作提示词.md`（绿幕源视频配方：16:9、头顶~20%/脚底~85%、首尾帧正面站立）② `scripts/` 素材链（水印→HSV 抠像/PR 手抠→2160×1215 归一→640×360 转码，CRF40/FPS24）③ `dsh-pet/` 插件
- **webm 动画不入仓库**（Releases 分发），插件包只收 step04 播放变体；Safari 线 = Release `assets-mov` + `ANIMATION_EXT` 常量
- 功能增量：**多开同屏**、桌面模式（Electron 透明窗）、**pet pack**（新种类=独立动画池）、**工作状态联动**（思考/工作/整理/等待/成功/出错）、碎碎念与对话、右键点播、拖拽弹簧/甩抛物理
- ⇒ **M2 缩窄**：PetActor/多实例已被上游「多开」覆盖，Duet 剩余 = 事件分发表 + proximity 互怼 + 麒麟仔/鲸鱼娘双 pack；**M1 须按 v0.3.6 重过契约**（本仓 v0.2.0 分析已过时，见 spec 增量勘察节）

## M0-5 通道排障全记录（2026-10-11，值回票价的三课）

**症状演进**：405/503（上轮）→ 用户修通道后 probe 全绿 → `img_generate` 仍全灭。

1. **配置病根**：通道显式 `sizeStyle: ratio-resolution` 压过 openai-responses 端点默认的 `pixels`（catalog.ts effectiveSizeStyle：显式配置最优先），导致 size=`16:9` 原样发上游 → 活渠道报 `size must use WIDTHxHEIGHT`。**已修**：走插件自有管理端点 `POST /dsh-kylin-images/api/channels.upsert` 热更（vault 内存长驻、直接改文件无效；upsert 不带 apiKey 时沿用旧值），vault.json 同步落盘。当前声明模型 `[gpt-image-2-4k, gpt-image-2, gpt-image-2.5]`，sizeStyle=pixels。
2. **模型矩阵**（13 个模型里只有 1 个能用）：`gpt-image-2`/`gpt-image-2.5-flare`→400 unsupported_model；`gpt-image-2.5`→503 无可用渠道；`gpt-image-1/1.5`→405；**唯一活渠道 = `gpt-image-2-4k`**（上游报自己叫 gpt-image-2，实为 Firefly 系）。
3. **响应形态随机轮换**：同一模型有时回标准 `image_generation_call.result`(base64)、有时回「URL 藏在消息 text」的 Firefly 预签名 S3 链接——**插件 `extractImageCalls` 只认前者**，后者解析扑空但图已计费（孤儿）。本轮插件侧产生 3 个孤儿。M0-5 三张最终用「双形态通吃」直连脚本出图（b64→落盘 / URL→下载+curl 兜底）。

**登记待修（dsh-kylin-images 仓）**：`src/provider/openai-responses.ts` 的 `extractImageCalls` 增加文本 URL 兜底——output 遍历无 image_generation_call 时，收集全部 string 字段里的 `https://…`（过滤 amazonaws/firefly/images 特征），包装成 `{status:'completed', url}` 候选；健壮性同款：`img_generate` 对上游错误应抛异常而非返回字符串（本轮工具返回字符串曾骗过成功判定）。修后需重启 dsh 生效（模块已加载）。

## 遗留与下一步

- ✅ 定妆照三张已验收；**待用户拍板**：鲸鱼娘采用方案 A（水手服裙）还是 B（连帽开衫+鲸鱼包）
- ⛔ dsh-kylin-images 插件补丁（extractImageCalls 双形态兜底 + 工具失败应抛错）——待用户发话，修后重启 dsh
- 源视频生产需外部 AI 视频工具（可灵/豆包/Runway，按上游配方）——本机工具面暂无视频生成通道，登记为用户侧步骤或后续接入
- 下一里程碑 M1：按 v0.3.6 重过契约 → fork 改皮（包名/路由前缀/patch id/用户目录）→ 麒麟仔 pack 骨架上桌

## 约定遵守

- 未提交（沿用户「发话才提交」惯例）；origin/upstream 均 fetch-only 未推送
