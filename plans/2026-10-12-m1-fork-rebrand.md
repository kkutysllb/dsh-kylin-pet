# M1 执行记录 —— fork 改皮（kylin/v0.3.6 分支）

> 2026-10-12。分支 `kylin/v0.3.6`（自 tag `v0.3.6` = `eb7426771` 建立），main 未动；未提交、未推送（惯例：等用户发话）。

## 一、基线纠偏

| 项 | M0 记录 | M1 实钉 |
|---|---|---|
| v0.3.6 commit | `9266219`（误） | **`eb7426771`**（`git rev-parse v0.3.6^{commit}`） |
| `9266219` 真身 | — | 彼时 upstream/main tip，**领先 tag 14 提交**（DPI 补偿、置顶看门狗等 fix/feat） |

按「钉 tag 不钉 main tip」纪律取 tag；14 笔增量登记为后续 cherry-pick 候选（`git log v0.3.6..upstream/main`）。

## 二、改皮清单（全部实证）

| 面 | 旧 | 新 | 位置 |
|---|---|---|---|
| 包名 = patch 行 id = 模块 id | `dsh-pet` | `dsh-kylin-pet` | package.json / cordis.patch.yml / client/index.ts（**v0.3.6 STORE 契约：id 必须与包名一致**，spec D7 初稿短 id `kylin-pet` 作废） |
| 路由前缀 | `/dsh-pet-7340` | `/dsh-kylin-pet-7341` | host/index.ts `ROUTE_PREFIX` 单常量 + 注释/测试/报错文案（sed 全清） |
| 用户数据目录 | `$DSH_HOME/dsh-pet` | `$DSH_HOME/dsh-kylin-pet` | host/index.ts:242（唯一拼点） |
| slot id | `pet` / `pet-config` | `kylin-pet` / `kylin-pet-config` | client/app.ts:147/155 |
| 桌面 helper | `dsh-pet-electron-helper` / `dsh-pet-bridge:` | `dsh-kylin-pet-*` | storage-paths.ts / helper-process.ts + runtime/electron-helper |
| bin / 余额 UA / standalone 名 | 同前缀盲换 | `dsh-kylin-pet-*` | package.json bin / balance internal / cli.ts |
| openapi | 前缀+说明 | 同步 | 根 openapi.yaml（check:openapi 校验对齐） |
| 上游署名 | — | **保留** `PC2005-cloud/dsh-pet` 原样（URL 保护两遍替换法） | package.json description 等 |

## 三、麒麟仔上桌（占位）

- `config.jsonc` `pets[0]`：name → **麒麟仔**（id 保持 `main`，继续吃 `main-animation` → 包内蓝鲸素材池回落）；whisperPrompt → 麒麟仔人设（占位）；已加注释声明「素材为上游蓝鲸包占位，自制素材就绪后迁 `pet/kylin-animation/`」。
- 上游默认宠本来就是蓝鲸人设 → **鲸鱼娘 B 案的占位素材天然现成**（M2 建种类文件时直接引用）。

## 四、验证矩阵

| 门 | 结果 |
|---|---|
| pnpm install | ✅ 6.2s（pnpm 12.9.1；corepack 自动写入 `packageManager` 字段，保留作钉版） |
| typecheck（tsc ×2） | ✅ |
| test | **550/553**：1 红 + 2 取消全在 helper-process（桌面 Electron 通道）；**干净 v0.3.6 基线 worktree 对照实测同红同数** ⇒ 预存环境问题（沙箱剥离子进程 PATH / 真进程语义），与改名无关，登记 |
| build（prepare.js） | ✅（含 desktop-core、gen-types、files 清单收敛） |
| check:openapi | ✅（13 路径 / 16 操作与路由全对齐；首红系 scripts/ 校验脚本未进首轮 sed，已补） |
| lib 产物 grep | `dsh-kylin-pet` 在场（72/333/86 处）、`/dsh-kylin-pet-7341` 在场、**旧前缀 0、旧名 0**（src+scripts+runtime+patch+package+config+openapi 全扫） |

## 五、登记事项（不阻塞）

1. **斜杠命令名通用**（`balance` / `pet` / `chat`）：与上游 dsh-pet 同装可能撞名；本 fork 为替代关系，M2 再议是否命名空间化。
2. **沙箱 PATH 剥离**：execSync 子进程 `process.env.PATH` 为 undefined，`#!/usr/bin/env node` 全灭——所有命令须显式注入 `env.PATH`（本轮已绕过；helper-process 3 红疑与此相关）。
3. 测试跑 `node --experimental-strip-types`，node 22.11.0 实测可用。

## 六、profile 实机安装（符号链接开发态，2026-10-11）

```sh
dsh plugin --profile web add "link:/Users/libing/kk_Projects/dsh-kylin-pet/dsh-pet"
```

| 落位 | 方式 | 证据 |
|---|---|---|
| dependencies | `dsh-kylin-pet`: `link:/Users/…/dsh-pet` | profile package.json |
| node_modules | symlink `dsh-kylin-pet → ../../../../kk_Projects/dsh-kylin-pet/dsh-pet` | ls -la 确认 |
| bundles 登记 | `dsh.plugin` 包装器自动追加到 `dsh.profile.bundles`（pnpm 本身不认识 dsh 键） | 数组含 dsh-kylin-pet |
| 挂载行 | **不手改 profile patch**——包自带 `dsh.bundle.patch: "./cordis.patch.yml"` 随 bundles 成员启动时自动合并（dsh-kylin-memory 同款模式） | 曾误加重复 insert 行，已撤销，YAML 复验 21 blocks / 6 inserts、串零残留 |

验证：host entry 自 profile cwd 导入 OK（模块导出名 `pet` 为上游自带 cordis 服务名，patch 行 `name:` 才是包解析名，无碍）；client.js 经 symlink 可读且 `__ModuleLoader__` 在场（浏览器端是引擎按文件伺服，不走 ESM exports）。

**注意**：跑的是源仓 lib/ 构建产物——改 src 后须 `cd dsh-pet && pnpm build` 再重启引擎。激活在引擎启动时，**重启引擎生效**。

### 验收清单（重启后）
1. 桌宠上桌（左下角蓝鲸占位素材 = 麒麟仔，idle/walk 随机链、拖拽、点击反应）；
2. 设置页出现「桌宠」分区（pet-config 槽）；
3. `/dsh-kylin-pet-7341/config.jsonc` 与 `/dsh-kylin-pet-7341/thumb/<动画>.webm` 可访问。

### 清理（验证完、转 npm 正式安装时）
```sh
dsh plugin --profile web remove dsh-kylin-pet
# remove 后核对 bundles 键是否残留（add 由包装器登记，remove 是否同步未验证）——残留则手动删该行
dsh plugin --profile web add dsh-kylin-pet@^0.3.6   # npm publish 之后
```


### 实机验收修复：一宠两画与默认瘦身（2026-10-11 12:15）

用户实测「一大一小两只」。归因（全部一手证据）：

| # | 事实 | 证据 |
|---|---|---|
| 1 | v0.3.6 默认 `display: "both"` = 浏览器 overlay + Electron 透明窗**双面各画一只** | config.jsonc:170；进程 44095 = `runtime/electron-helper/main.js`（12:08 引擎重启时由 host 拉起） |
| 2 | 透明窗 Helper 强制 `--force-device-scale-factor=1` → Retina 屏上那只只有 overlay **一半大** | ps aux 44097/44102 参数 |
| 3 | 默认 `size: 462`（上游为多宠 pack 设的基准）单屏偏大 | config.jsonc:154 |

**修法（只动包内 assets/config.jsonc，改完即生效——readAllConfig 每请求现读，无需 rebuild）**：
`display: "web"`（占位期单面）+ `size: 280`（行进距离按 size/462 等比缩放，moves 参数零改动）。
JSONC 解析 + 字段断言 PASS（1 只 / 280 / web）。

**用户侧生效动作**：重启引擎（顺带收掉旧 Helper 进程）+ 刷新页面。

**登记 M3 项**：① 桌面透明窗面的 hidpi 修正（scale 因子随屏）；② Helper 按需拉起（无 desktop 宠物时不 spawn）；③ 到时把 display 放回 both/设置页可调。home 对账备注：终端 `dsh` 在无 DSH_HOME 环境下默认 `~/.dsh`（另一套 profile），KCoder 桌面版实为 `~/.kcoder`——对 profile 操作一律显式核对 home。
