# dsh-kylin-pet

麒麟仔 vs 鲸鱼娘 —— 跑在 DSH Web UI 里的双宠同台桌宠插件。

## 安装

```bash
dsh plugin --profile web add dsh-kylin-pet     # npm 发布版
# 或本地开发版（注意：file: 是**拷贝**不是链接，改动后要重装；开发请用 link:）
dsh plugin --profile web add file:/path/to/dsh-kylin-pet
```

装完刷新页面即可；卸载：`dsh plugin --profile web remove dsh-kylin-pet`。
镜像分发：[kkutysllb/dsh-plugins](https://github.com/kkutysllb/dsh-plugins) 的 `dsh-kylin-pet/` 子目录（`npm run sync:mirror` 同步）。

## 出处声明（clean-room）

- 本包为**原创实现**：架构、代码、配置契约、文案均为本仓自有。
- 机制层面参考了 PC2005-cloud/dsh-pet（MIT）的**公开设计思想**（透明视频桌宠、双缓冲交叉淡入、事件驱动反应链），属公共知识；**未携带其任何代码、素材或文案**，无代码派生。
- 角色资产（麒麟仔、鲸鱼娘「汐」）由本仓图像管线生成，版权与形象归本仓库所有。

> 上面这段是 clean-room 门（`scripts/check-clean-room.mjs`）的**唯一豁免面**：源码面（`src/ tools/ scripts/ docs/`）零命中上游标识，出处注明只允许出现在本文件与 `package.json` 里。

## 架构（v2，零依赖 plain ESM）

| 半侧 | 入口 | 职责 |
|---|---|---|
| host | `src/server/entry.js` | 配置三层收敛 · 素材路由（防穿越 / no-store）· `/health` · `/config` · `/state`（诱因板轮询）· `/bond`（GET/PUT，账本唯一写入口）· `/balance`（联合类型） |
| client | `src/stage/client.js` | **单文件**：契约常量 / 演员（双缓冲 video）/ **世界（位移权威）** / 手势 / 气泡 / **心智 Mind**（效用打分，决策与推进分离）/ **导演 Director**（动作槽 · 仲裁 · Interaction 四阶段的推进与结算）/ **8 个剧本**（声明式编排表 + 原创文案）/ 诱因消费（**只改心智，不直接点播**）/ 关系账本镜像与防抖提交 / 余额档位播报 |

无构建步骤：引擎按 `package.json` 的 main/exports 直接加载源文件（plain ESM + JSDoc）。

```bash
npm test        # node --test "test/**/*.test.mjs"
npm run check   # 对全部 10 个源文件做 node --check
```

> **不要用 `node --test test/`** —— Node v24 起，`--test` 的目录位置参数不再被递归展开（会当成「一个测试文件」去跑，必红）。

## 开发期验收台

```bash
node tools/harness.mjs [端口] [账本路径]      # 默认 7391 / <dsh家目录>/dsh-kylin-pet/bond.json
```

它用**真 host 模块**（`loadPetConfig` / `createAssetResolver` / `createHandler` / `createBondStore`）伺服配置、素材、诱因与账本，再用**真 `client.js`** 在真浏览器里跑舞台 —— 与生产只差一个 DSH webServer。前缀路由**整体委托给真 handler**，验收台只额外提供三条本地路由：

| 路由 | 用途 |
|---|---|
| `/` | 验收页（`window.__ModuleLoader__` 垫片 + `/client.js`） |
| `POST /__emit?name=<真宿主事件名>` | 按真事件名派发一次监听器（waterfall 给计数 next） |
| `POST /__balance?case=<no-credentials-service\|not-configured\|ok\|tier-null>` | 切换余额探针返回，供取证降级路径 |

> ⚠️ **后两条只存在于 harness，不存在于 `entry.js`，生产路径也没有。**

## 开发期安装：必须用 `link:`，不要用 `file:`

```bash
dsh plugin --profile web add link:/path/to/this/repo      # ✅ 符号链接：改完刷新页面即可见
dsh plugin --profile web add file:/path/to/this/repo      # ❌ 拷贝：改了代码**永远不会生效**
```

**这不是风格问题，是一次真实的抓瞎**：`file:` 把仓库**拷贝**进 `node_modules/`，
于是之后所有提交都不在运行中的插件里。表现是「我明明修了，用户说还是老样子」——
而两边看到的是**两份不同的代码**。2026-10-11 就这么白查了好几轮「屏幕闪烁」。

> 判断当前装的是哪种：`readlink ~/.coder/profiles/web/node_modules/dsh-kylin-pet` ——
> 打印路径 = 链接（会跟着改）；打印 `(真目录)` = 拷贝（**已经过时了**）。

另注：**client 半边**改完刷新页面即可；**host 半边**（`src/server/**`）改动需要重启引擎。

## 关系重置

**两条路，任选一条**：

**① 引擎里敲 `/pet`**（推荐）

```
/pet status     查看两只的熟悉度与好感（含互动次数）
/pet reset      清空关系，两只回到刚认识的样子
```

> 它是**优雅注册**的：启动时探测 `commands` 服务在不在（`ctx.get('commands')`，**不声明 `inject`** ——
> `inject` 是硬依赖，服务缺席会让整个桌宠 pending，为一条命令赌上全部功能不成比例）。
> **服务缺席时插件其余功能照常**，只是没有这条命令 —— 那就走下面第 ② 条。

**② 删掉（或改名）数据文件后重启引擎**

删掉（或改名）下面这个文件后重启引擎，两只就回到刚认识的样子：

```text
<dsh家目录>/dsh-kylin-pet/bond.json
```

它是纯数据文件，删了不影响插件加载；下次互动会重新建。
> 首次写入前若发现文件**解析不了**，会先把它改名成 `bond.json.suspect` 留底再写新的 —— 「不覆盖坏数据」不是只在没人写的时候成立。

## 路线图

- [x] **V0 仓务**：clean-room 清仓入册（孤儿分支）· 38 段素材归位 · 文档纠偏
- [x] **V1 上桌**：宿主路由（配置 / 素材）· 舞台与演员（待机链 / 拖拽 / 点击 / 边界）—— `evidence/v1/`，10/10 硬门
- [x] **V2 事件诱因面**：真宿主事件 → 诱因板 → 按 `directing.workStatus` 分流 → 气泡 —— `evidence/v2/`，12/12 硬门
- [x] **V3 关系与余额**：关系账本跨会话（host 独占写入 / 原子落盘）· 余额联合类型（**诚实降级，绝不伪造数字**）—— `evidence/v3/`，11/11 硬门
- [x] **V3b 双宠社交**：心智 Mind（效用打分，**决策与推进分离**）· 导演 Director（动作槽 / 仲裁 / Interaction 四阶段推进与结算）· 8 个互动剧本（声明式编排表 + 原创文案）· 诱因改为**交给心智**（不再直接点播）—— `evidence/v3b/`，8/8 硬门
- [x] **V4 收口**：关系重置的 `/pet status|reset`（**优雅注册**，服务缺席不 pending）+ 文件操作式兜底 · 路线图与文档对齐 · **真机四层验证**（真加载器解析 / `apply(ctx)` 跑通 / 路由全活 / client 在真 UI 挂载）· 已装入 web profile
- [x] **V5 执行期活动面**：`agent/status` + `tools/pre-execute` → **任务在跑时两只播「状态忙碌」，气泡按工具类别说**（「在翻文件」「在跑命令」…）· 合演在任务期间主动让位 —— `evidence/v5/`，10/10 硬门

已完成但不属某个版本片的交付物：**角色设定集** [docs/character-bible.md](docs/character-bible.md)。

设计文档：[plans/2026-10-11-v2-duet-stage-design.md](plans/2026-10-11-v2-duet-stage-design.md)

## License

MIT
