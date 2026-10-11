# dsh-kylin-images 通道问题登记（不修，用户自处理）

> 2026-10-12 定案：**本仓不改 dsh-kylin-images 任何代码**；问题由用户在其插件仓库自行修复。本文件仅留痕，供 M2 出鲸鱼娘/麒麟仔动像素材时对照。

## 时间线事实

1. M0 期：「天域」通道探测阶段 `/v1/responses` 503、图像模型被判 unsupported、实请求 405 —— 定妆照生成被阻塞。
2. 用户出示通道状态：`鉴权=ok · 端点=responses-images · 模型 13 个 · /v1/images/generations=gateway-blocked · /v1/responses=routed`，判定通道实际可用。
3. 随后三张定妆照（麒麟仔三视图 / 表情差分 / 鲸鱼娘候选）生成成功出卡。

## 结论

- 通道可用路径 = **responses-images**（`/v1/responses`）；`/v1/images/generations` 被网关拦（gateway-blocked）。
- dsh-kylin-images 侧待处理：端点风格判定 / 网关拦截态的回退逻辑（以用户在插件仓的实际修法为准）。
- 对本仓的影响：**无代码依赖**。提示词按 ImagePrompt v1 协议编译即走通道；后续动像素材（图生视频首尾帧）同走 responses-images。
