# plans 索引

> 这个目录里有**两次努力**的文档。**当前有效的是「clean-room 重写」那一组**；另一组是本仓的**前史**，保留是因为它记录了「为什么不 fork」这个决定。

## ✅ 当前：clean-room 重写（v2 双宠舞台）

| 文件 | 作用 |
|---|---|
| [2026-10-11-v2-duet-stage-design.md](2026-10-11-v2-duet-stage-design.md) | **总设计 spec** —— 一切以它为准 |
| [2026-10-11-v2-v0-v1-implementation.md](2026-10-11-v2-v0-v1-implementation.md) | V0 仓务 + V1 client 重写（含取证记录） |
| [2026-10-11-v2-events-implementation.md](2026-10-11-v2-events-implementation.md) | V2 事件诱因面（**其取证记录已被 V3b 标注部分失效**） |
| [2026-10-11-v3-bond-balance-implementation.md](2026-10-11-v3-bond-balance-implementation.md) | V3 关系与余额（含取证记录 + 对 V2 的更正） |
| [2026-10-11-v3b-social-implementation.md](2026-10-11-v3b-social-implementation.md) | V3b 心智 / 导演 / 8 剧本（含取证记录） |
| [2026-10-11-v4-wrapup-implementation.md](2026-10-11-v4-wrapup-implementation.md) | V4 收口（`/pet` + 真机四层验证） |
| [2026-10-11-v5-agent-activity-implementation.md](2026-10-11-v5-agent-activity-implementation.md) | V5 执行期活动面（任务在忙 + 按类别的气泡） |

证据在 `evidence/{v1,v2,v3,v3b,v5}/`，共 16 张截图。

## 📜 前史：fork 改皮期（**不要照它执行**）

这一组记录的是一条**被放弃的路线** —— fork 上游仓库再改皮。用户当时的裁决是**「参考不是搬运，不搞 fork」**，于是有了上面那次 clean-room 重写。

| 文件 | 记录了 |
|---|---|
| [2026-10-12-clean-room-rebuild.md](2026-10-12-clean-room-rebuild.md) | **那条裁决本身**（本文档目录存在的理由） |
| [2026-10-11-kylin-pet-duet-design.md](2026-10-11-kylin-pet-duet-design.md) | 早期的双宠设计 spec（clean-room spec 的前身） |
| [2026-10-12-m0-execution.md](2026-10-12-m0-execution.md) | M0 资产管线 |
| [2026-10-12-m1-fork-rebrand.md](2026-10-12-m1-fork-rebrand.md) | M1 fork 改皮（分支 `kylin/v0.3.6`） |
| [2026-10-12-m2-duet-engine.md](2026-10-12-m2-duet-engine.md) | M2 双宠引擎（**fork 路线上的实现，已被重写取代**） |
| [2026-10-12-kylin-images-known-issue.md](2026-10-12-kylin-images-known-issue.md) | 素材通道问题的留痕（不在本仓修） |

> **为什么不删**：它们解释了「为什么会有 v2 重写」以及「为什么本仓一行上游代码都不带」。
> 但它们描述的那个实现**已经不存在于本仓** —— 照它们执行会走错路。
