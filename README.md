# dsh-kylin-pet

麒麟仔 vs 鲸鱼娘 —— 跑在 DSH Web UI 里的双宠同台桌宠插件。

## 出处声明（clean-room）

- 本包为**原创实现**：架构、代码、配置契约、文案均为本仓自有。
- 机制层面参考了 PC2005-cloud/dsh-pet（MIT）的**公开设计思想**（透明视频桌宠、双缓冲交叉淡入、事件驱动反应链），属公共知识；**未携带其任何代码、素材或文案**，无代码派生。
- 角色资产（麒麟仔、鲸鱼娘「汐」）由本仓图像管线生成，版权与形象归本仓库所有。

## 架构（v2，零依赖 plain ESM）

| 半侧 | 入口 | 职责 |
|---|---|---|
| host | src/server/entry.js | 配置三层收敛、素材路由（防穿越、no-store）、状态端点 |
| client | src/stage/client.js | 双宠舞台：锚点摆放、待机动画链、拖拽 |

无构建步骤：引擎按 package.json 的 main/exports 直接加载源文件（plain ESM + JSDoc）。
测试用 Node 内置 runner：node --test src/。

## 配置

出厂导演表 assets/default-config.jsonc（cast[] + directing{}）；
用户覆盖 <dsh家目录>/dsh-kylin-pet/main-config.jsonc；素材目录按宠独立（main-animation / whale-animation / main-memes / whale-memes）。

## 路线图

- [x] **V0 仓务**：clean-room 清仓入册（孤儿分支）· 38 段素材归位 · 文档纠偏
- [x] **V1 上桌**：宿主路由（配置/素材）· 舞台与演员（待机链 / 拖拽 / 点击 / 边界）
- [ ] **V2 事件面**：工作状态分流（成功→麒麟仔，失败→鲸鱼娘）· 余额播报 · 失焦通知
- [ ] **V3 双宠社交**：心智 / 导演 / 8 个互动剧本 / 关系账本（跨会话）
- [ ] **V4 收口**：设置页（关系重置 + 只读状态）· 角色设定集 · 鲸鱼娘表情包差分

设计文档：[plans/2026-10-11-v2-duet-stage-design.md](plans/2026-10-11-v2-duet-stage-design.md)

## License

MIT
