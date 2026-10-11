# dsh-kylin-pet v2 · V0+V1 实施计划

**目标**：做出 v2 的第一片**可运行、可截图验收**的软件——V0 把 clean-room 清仓正式入册成孤儿分支的第一次提交；V1 让**两只宠在同一视口里各自活着**（宿主路由供配置与素材，客户端舞台/演员跑待机链、拖拽、点击、边界）。

**架构**：宿主半是零构建 plain ESM 插件（`export const name / inject / apply`，经 `ctx.effect(() => ctx.webServer.register({ kind:'prefix', path, handler }))` 挂到 `/dsh-kylin-pet-7341`）；客户端半是**单文件副作用脚本**（`window.__ModuleLoader__.load({ id, factory })`，全部实现收在 factory 作用域内，只经 `exports.inject` / `exports.apply` 暴露），直挂 `document.body` 自绘 overlay。共享常量以 `src/shared/contract.js` 为真源，client 逐字重复一份，由一致性测试钉死（**允许重复，禁止漂移**）。

**技术栈**：Node ≥22 原生 ESM + `node --test`（零依赖、零构建）；浏览器原生 DOM / `<video>`；ffprobe/ffmpeg 仅素材机检用。

**依据**：`plans/2026-10-11-v2-duet-stage-design.md`（§2 事实表是全部证据基础）。

---

## 与 spec 的两处偏差（先记在这里，免得实施中途才发现）

1. **不挂 `shell.overlay` 插槽，改直挂 `document.body`**。理由：插槽契约与 `require('react')` 都是**未实测**依赖（spec 事实 1 只证实了 client 条目契约），而桌宠是**装饰层**不是应用 UI；桌面壳自己的注入器（账号菜单、样式覆盖层）就是直挂 body 的既有先例。收益：验收台与生产走**同一条代码路径**，截图即生产行为。日后若确需进应用层树，V4 再评估。
2. **`/state`、`/bond`、`/balance` 不在 V1**：分别属于 V2（诱因板/余额）与 V3（关系账本）。V1 只落 `/config`、`/pet/**`、`/memes/**`，外加一条 `/health` 供冒烟。
3. **测试放 `test/` 而不是 `src/`**：package.json 的 `files` 只白名单 src/assets，测试留在包外才不会随包发货。

---

## 文件结构（V0+V1 结束时的全量）

| 文件 | 动作 | 职责 |
|---|---|---|
| `scripts/import-assets.mjs` | 新建 | 素材入册：用户目录 → 包内 `assets/pet/`，带数量断言 |
| `scripts/check-clean-room.mjs` | 新建 | clean-room 门：结构（无上游路径入册）+ 特征串（源码面零命中） |
| `README.md` | 改 | 路线图纠偏（删掉不实的 `[x]`） |
| `src/shared/contract.js` | 新建 | 共享常量真源：路由前缀 / 舞台几何 / 行为档→素材名表 |
| `src/server/pet-config.js` | 新建 | JSONC 容忍解析、深合并、三层读取 |
| `src/server/static-assets.js` | 新建 | 素材解析：角色白名单 + 名字守卫 + 用户目录优先 + 前缀复检 |
| `src/server/entry.js` | 新建 | 插件契约 + 路由表 + JSON/文件响应 |
| `src/stage/client.js` | 新建 | **单文件**：§1 契约 §2 工具 §3 演员 §4 世界 §5 手势 §6 挂载 |
| `test/*.test.mjs` | 新建 | `npm test`（= `node --test "test/**/*.test.mjs"`） |
| `tools/harness.mjs` | 新建 | 开发期验收台（真 host 模块 → 真浏览器截图） |
| `package.json` | 改 | test 指向 test/、补 harness、兼容表加 0.2.1-alpha.2 |
| `assets/pet/{main,whale}-animation/*.webm` | 入册 | 38 段（19×2） |
| `cordis.patch.yml`、`assets/default-config.jsonc`、`LICENSE` | 入册 | V0 一并提交（内容本轮不改） |

---

# Phase V0 — 仓务（清仓入册）

## Task 1: 素材入册脚本

**Files:** Create `scripts/import-assets.mjs`

**背景**：38 段 webm 目前**只存在于用户目录** `$DSH_HOME/dsh-kylin-pet/pet/{main,whale}-animation/`（各 19 段，已实测），包内 `assets/pet/` 只有 `main-memes` 9 张 png。`whale-memes` 全环境都不存在 ⇒ 出厂配置里 `xisha.memeDir='whale-memes'` 指向空目录，是**已知缺口**（献宝由鲸鱼娘发起时降级）。脚本必须显式 WARN，不许静默。

- [ ] **Step 1: 写脚本**

```js
#!/usr/bin/env node
/**
 * 把动画与表情包从「用户素材目录」收敛进包内 assets/pet/。
 * 用法: node scripts/import-assets.mjs [源目录]   默认 $DSH_HOME/dsh-kylin-pet/pet
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const src = resolve(process.argv[2] || join(home, 'dsh-kylin-pet', 'pet'))
const dst = resolve(import.meta.dirname, '..', 'assets', 'pet')

/** 目录 -> 期望文件数（不含隐藏文件） */
const EXPECT = { 'main-animation': 19, 'whale-animation': 19, 'main-memes': 9 }
/** 已知缺口：出厂配置引用它，但来源不存在 —— WARN 不报错 */
const OPTIONAL = { 'whale-memes': 9 }

const list = (dir) => readdirSync(dir).filter((f) => !f.startsWith('.'))

if (!existsSync(src)) {
  console.error('源目录不存在: ' + src)
  process.exit(2)
}

let total = 0
for (const [dir, want] of Object.entries(EXPECT)) {
  const from = join(src, dir)
  if (!existsSync(from)) { console.error('缺目录 ' + dir + '（源: ' + from + '）'); process.exit(1) }
  const files = list(from)
  if (files.length !== want) { console.error(dir + ': ' + files.length + ' 个文件，期望 ' + want); process.exit(1) }
  const to = join(dst, dir)
  mkdirSync(to, { recursive: true })
  for (const f of files) cpSync(join(from, f), join(to, f))
  console.log('OK   ' + dir + ': ' + files.length)
  total += files.length
}
for (const [dir, want] of Object.entries(OPTIONAL)) {
  const from = join(src, dir)
  if (existsSync(from) && list(from).length === want) {
    const to = join(dst, dir); mkdirSync(to, { recursive: true })
    for (const f of list(from)) cpSync(join(from, f), join(to, f))
    console.log('OK   ' + dir + ': ' + want); total += want
  } else {
    console.warn('WARN ' + dir + ' 无来源 —— 出厂配置引用它，相关剧本会降级（已知缺口）')
  }
}
console.log(''); console.log('共入册 ' + total + ' 个文件 -> ' + dst)
```

- [ ] **Step 2: 跑，并核对数量**

Run: `node scripts/import-assets.mjs`

Expected: 三行 `OK`（19 / 19 / 9）+ 一行 `WARN whale-memes` + `共入册 47 个文件`。

- [ ] **Step 3: 素材机检（硬门）**

Run: `node scripts/check-assets.mjs assets/pet/main-animation assets/pet/whale-animation; echo exit=$?`

Expected: 38 行 `PASS` + 末尾 `38 个文件全部合格 ✅` + `exit=0`。

> **执行期更正（Lead 实测，2026-10-11）**：原文写的是 `node scripts/check-assets.mjs assets/pet`，**实测 exit 2 /「没有可检文件」**。
> 根因：`scripts/check-assets.mjs:25-30` 的 `collect()` **不递归**——对目录只取第一层里扩展名为 `{.webm,.mov,.mp4}` 的文件；`assets/pet` 第一层只有三个子目录，`extname` 为空串，被过滤干净。
> 所以必须把两个动画目录显式传进去。**不要**为迁就旧命令把机检递归化：那会改动 M0 已验收的门禁语义。
> 数量 38 而非 47 是对的：`EXTS` 不含 `.png`，9 张表情包本就不进统计。

---

## Task 2: clean-room 门

**Files:** Create `scripts/check-clean-room.mjs`

**为什么**：spec §11 把「上游特征串 grep = 0」列为硬门，但没有落成可执行的东西。**绿不了、红不了的检验等于没检验**，所以这条门要能指名报错且能红。

- [ ] **Step 1: 写脚本**

```js
#!/usr/bin/env node
/**
 * clean-room 门（两条独立判据）：
 *  A 结构：上游工作树（staging/**）不得进入 git 索引；
 *  B 特征串：源码面（src/ tools/ scripts/）零命中上游标识。
 * 例外：README / package.json / plans 里的 PC2005-cloud/dsh-pet 是 MIT 出处的正当
 * 注明（披露机制来源），故**不在扫描面内** —— 这条例外必须留在代码注释里。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const NL = String.fromCharCode(10)
const SOURCE_GLOBS = ['src', 'tools', 'scripts']
/**
 * 门禁自身必须排除（自指）：它的 DENY 表与注释里必然逐字出现这些特征串，
 * 不排除则门永远红。这不是放水 —— 别的文件出现同样的字面量照样被抓。
 */
const SELF = 'scripts/check-clean-room.mjs'
const DENY = [
  'PC2005',          // 上游仓库作者
  'dsh-pet',         // 上游包名（本仓叫 dsh-kylin-pet，不含该子串）
  'whale-poses',     // 上游素材目录命名
  'KylinPetHost',    // 上游类名
]

/**
 * 源码面 = 已入册文件 ∪ 未跟踪但未被忽略的文件。
 * 为什么带上 --others：门要判的是「本仓可见的源码面是否干净」，
 * 而只在受控文件里判，会让「尚未 git add 的在飞源码 / 负对照诱饵」免疫 —— 绿得没有判别力。
 * staging/（上游工作树）与 node_modules 由 .gitignore 挡在 --exclude-standard 外。
 */
/**
 * -c core.untrackedCache=false：关掉未跟踪缓存。实测有一次刚建好的诱饵没被列出来
 * （目录 mtime 粒度内的缓存陈旧），门因此放过它 —— 一个会偶发漏看的门是不可信的。
 */
const listed = execFileSync('git', ['-c', 'core.untrackedCache=false', 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split(NL).filter(Boolean)
const leaked = listed.filter((p) => p.startsWith('staging/'))
const files = listed
  .filter((p) => SOURCE_GLOBS.some((g) => p === g || p.startsWith(g + '/')))
  .filter((p) => p !== SELF)

const hits = []
const missing = []
for (const f of files) {
  // 索引里可能留着「已删除但尚未重建索引」的源码文件（清仓期有 11 个上游遗留，实测会 ENOENT 崩）：
  // 磁盘上已不存在 ⇒ 不构成源码面，跳过而不是崩。Task 4 重建索引后这里恒为空。
  if (!existsSync(f)) { missing.push(f); continue }
  readFileSync(f, 'utf8').split(NL).forEach((line, i) => {
    for (const d of DENY) if (line.includes(d)) hits.push(f + ':' + (i + 1) + '  ' + d + '  | ' + line.trim().slice(0, 100))
  })
}

let bad = 0
if (leaked.length) { bad++; console.log('FAIL 结构：上游工作树入册 ' + leaked.length + ' 条'); leaked.slice(0, 5).forEach((p) => console.log('      - ' + p)) }
else console.log('PASS 结构：git 索引内无 staging/**')
if (missing.length) console.log('NOTE 跳过 ' + missing.length + ' 个索引内已删除的源文件（' + missing.slice(0, 3).join(', ') + ' …）；重建索引后应归零')
if (hits.length) { bad++; console.log('FAIL 特征串：源码面命中 ' + hits.length + ' 处'); hits.slice(0, 10).forEach((h) => console.log('      - ' + h)) }
else console.log('PASS 特征串：' + files.length + ' 个源码文件 / ' + DENY.length + ' 条特征串，零命中')

process.exit(bad ? 1 : 0)
```

- [ ] **Step 2: 跑（V0 时 src/ 还不存在，只该验结构）**

Run: `node scripts/check-clean-room.mjs; echo exit=$?`

Expected: `PASS 结构` + `PASS 特征串`，exit=0。

> 若在**重建索引之前**跑，会多一行 `NOTE 跳过 15 个索引内已删除的源文件`：清仓期索引里还留着 15 个上游遗留的「已删除」blob（工作树已无），裸 `readFileSync` 会 ENOENT 崩，所以门内有 `existsSync` 守卫。Task 4 重建索引后这一行消失。

- [ ] **Step 3: 负对照（证明这条门能红）**

```bash
mkdir -p src && printf 'x PC2005 y' > src/_negcontrol.js
node scripts/check-clean-room.mjs; echo "neg exit=$?"
rm -f src/_negcontrol.js; rmdir src 2>/dev/null || true
node scripts/check-clean-room.mjs; echo "clean exit=$?"
```

Expected: 第一跑 `FAIL 特征串：源码面命中 1 处` + `src/_negcontrol.js:1  PC2005` + `neg exit=1`；清理后复跑 `PASS 特征串` + `clean exit=0`。

> **执行期踩到的两个坑（都已修进上面的代码）**：
> 1. 门原先只扫 `git ls-files`（受控文件），而诱饵是**未跟踪**的 ⇒ 门看不见它，`neg exit=0`，**是一条红不了的假绿**。已改成 `--cached --others --exclude-standard`（未跟踪但未被忽略的文件也进扫描面，`staging/` 与 `node_modules` 由 .gitignore 挡住）。
> 2. 实测出现过一次「刚建好的诱饵没被列出来」——`git ls-files --others` 走**未跟踪缓存**，目录 mtime 粒度内会陈旧。已加 `-c core.untrackedCache=false` 关掉它；改后连跑 8 次，8/8 抓到。
>
> 命令里**不要**用 `set -e`：`node` 故意返回 1，`set -e` 会在清理之前把 shell 带走、留下诱饵文件。

---

## Task 3: README 纠偏

**Files:** Modify `README.md`（路线图段，`## 路线图` 到 `## License` 之间）

**事实**：`README.md:28` 把「骨架」勾成 `[x]`，但 `src/` 当时根本不存在。

- [ ] **Step 1: 整段替换为**

```markdown
## 路线图

- [ ] **V0 仓务**：clean-room 清仓入册（孤儿分支）· 38 段素材归位 · 文档纠偏
- [ ] **V1 上桌**：宿主路由（配置/素材）· 舞台与演员（待机链 / 拖拽 / 点击 / 边界）
- [ ] **V2 事件面**：工作状态分流（成功→麒麟仔，失败→鲸鱼娘）· 余额播报 · 失焦通知
- [ ] **V3 双宠社交**：心智 / 导演 / 8 个互动剧本 / 关系账本（跨会话）
- [ ] **V4 收口**：设置页（关系重置 + 只读状态）· 角色设定集 · 鲸鱼娘表情包差分

设计文档：[plans/2026-10-11-v2-duet-stage-design.md](plans/2026-10-11-v2-duet-stage-design.md)
```

- [ ] **Step 2: 核对没有残留的假勾**

Run: `grep -n '^- .x.' README.md; echo exit=$?`

Expected: 无输出、exit=1。

---

## Task 4: 孤儿分支 + 首次提交 + 门禁复跑

**Files:** 无（仓务）

**为什么用孤儿分支**：v2 是 clean-room 重写，历史里不该留着上游 fork 的 399 个 blob；孤儿分支 = 单提交、无上游祖先。旧分支 `kylin/v0.3.6` 原地保留作为 fork 档案。

- [ ] **Step 1: 先看清要入册的东西**

```bash
git status --short | cut -c1-2 | sort | uniq -c   # 实测 399 D / 4 M / 14 ??
git ls-files | wc -l                               # 实测 407（旧 fork 树）
```

> 4 个 M 实测是 `.gitignore / LICENSE / README.md / plans/2026-10-11-kylin-pet-duet-design.md`。注意 `package.json` 是**未跟踪新文件**（`??`），不是 M。

- [ ] **Step 2: 建孤儿分支并重建索引**

```bash
git checkout --orphan v2/clean-room
git read-tree --empty        # 清空索引（只动索引，不可能丢数据）
git add -A
git status --short | cut -c1-2 | sort | uniq -c    # 只应有 A，没有 D：实测 69 A
git status --short | wc -l                          # 实测 69（staging/ 被 .gitignore 挡）
```

> **执行期更正（Lead 实测）**：原文写的是 `git rm -r --cached . >/dev/null`，**实测 exit 1 拒绝执行**：
> `error: the following files have staged content different from both the file and the HEAD: .gitignore LICENSE README.md plans/…（use -f to force removal）`。
> 根因：孤儿分支上 HEAD 未诞生，而这 4 个文件「索引内容 ≠ 工作树内容、也没有 HEAD 可比」，`git rm --cached` 出于保护数据拒绝。
> 改用 `git read-tree --empty`：它只清空索引（派生数据），**不可能丢工作树内容**，且不留 `-f` 这种会掩盖问题的开关。
> 另外此步之后 `git rev-parse --abbrev-ref HEAD` 会因 HEAD 未诞生而**退出码 128**（但打印 `HEAD`）；要拿分支名请用 `git symbolic-ref --short HEAD`。

- [ ] **Step 3: 提交**

```bash
git commit -q -F - <<'MSG'
feat(v2): clean-room 重写入册（孤儿分支）

v2 是原创实现：机制参考 PC2005-cloud/dsh-pet（MIT），零上游代码/素材/文案。
本提交是孤儿分支的第一次提交，不含上游 fork 祖先。

- 清仓：移除 fork 期 399 个上游 blob（代码/文档/截图/工作流）
- 入册：assets/pet 38 段动画（19x2，机检 38/38）+ main-memes 9 张
- 契约：package.json（main/exports/dsh 三元组）、cordis.patch.yml（entry id = 包名）
- 出厂导演表：assets/default-config.jsonc（cast 两宠 + directing 档位）
- 门禁：scripts/check-assets.mjs（素材）、scripts/check-clean-room.mjs（结构+特征串）
- 文档：README 路线图纠偏（删掉 src/ 不存在时的假 [x]）
MSG
git log --oneline          # 期望只有一行
```

- [ ] **Step 4: 门禁复跑（硬门）**

```bash
node scripts/check-assets.mjs assets/pet/main-animation assets/pet/whale-animation | tail -2
                                                      # 38 个文件全部合格 ✅
node scripts/check-clean-room.mjs                    # PASS 结构 + PASS 特征串
git status --short | wc -l                           # 0
git ls-files | grep -c '^staging/' || true           # 0
git log --oneline                                    # 恰好一行（孤儿根提交）
```

> 第一行**必须**显式传两个子目录 —— 见 Task 1 Step 3 的执行期更正（`collect()` 不递归）。
> 本轮实测：素材 38/38 ✅ · clean-room 两行 PASS · 索引内 `staging/` = 0 · 工作树干净 · `69` 个文件入册 · 根提交 `6635b14`。

---

# Phase V1 — 上桌

> V1 起每个 Task 收尾都跑：`npm test`（= `node --test "test/**/*.test.mjs"`）+ `node scripts/check-assets.mjs assets/pet/main-animation assets/pet/whale-animation` + `node scripts/check-clean-room.mjs`。

## Task 5: 共享契约真源

**Files:** Create `src/shared/contract.js`；Test `test/contract.test.mjs`

- [ ] **Step 1: 写契约**

```js
/**
 * dsh-kylin-pet v2 共享契约 —— host 侧真源。
 * client（src/stage/client.js）因宿主契约必须是单文件，无法 import 本模块，
 * 因此内部逐字重复一份；test/contract.test.mjs 用 vm 装载 client 并逐键比对：
 * 允许重复、禁止漂移。
 */

/** 宿主路由前缀（除 cordis patch 外的唯一路由真源）。 */
export const ROUTE_PREFIX = '/dsh-kylin-pet-7341'

/** 素材盘几何：640x360 画布、角色高 300、脚底 y=330（实测包围盒，见 spec §4.3）。 */
export const ASSET = Object.freeze({
  W: 640,
  H: 360,
  FOOT_RATIO: 330 / 360,   // 0.91667：盘内脚底线
  CHAR_TOP: 30 / 360,      // 0.08333：命中区上沿（实测并集 y1）
  HIT_X: [0.30, 0.70],     // 命中区横向（实测并集 0.325-0.673，两侧各留 0.025）
  CHAR_RATIO: 300 / 640,   // 角色高 / 盘宽（换算用）
})

/** 行为档 -> 素材文件名（不含扩展名）。19 个名字对应 6 段真实美术（spec 事实 7）。 */
export const CLIPS = Object.freeze({
  idle: ['待机', '状态思考', '状态整理', '碎碎念'],
  walk: ['走路', '状态张望', '状态忙碌'],
  turn: ['转身'],
  held: ['被拎起'],
  sad: ['安抚失败', '余额偏低', '余额告急', '余额见底'],
  happy: ['点击开心', '开心跳跃', '庆祝成功', '余额健康', '余额充裕', '余额正常'],
})

/** 循环播放的档（其余为一次性，播完回 idle）。 */
export const LOOPING = Object.freeze(['idle', 'walk'])

export const ANIM_EXT = '.webm'
export const MEME_EXT = '.png'
```

- [ ] **Step 2: 写测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { ROUTE_PREFIX, ASSET, CLIPS, LOOPING } from '../src/shared/contract.js'

test('路由前缀是注册进 host 的那一个', () => {
  assert.equal(ROUTE_PREFIX, '/dsh-kylin-pet-7341')
})

test('几何常量与实测包围盒一致', () => {
  assert.equal(ASSET.W, 640)
  assert.equal(ASSET.H, 360)
  assert.ok(Math.abs(ASSET.FOOT_RATIO - 330 / 360) < 1e-12)
  assert.ok(Math.abs(ASSET.CHAR_TOP - 30 / 360) < 1e-12)
  assert.deepEqual(ASSET.HIT_X, [0.30, 0.70])
  assert.ok(ASSET.HIT_X[0] <= 0.325 && ASSET.HIT_X[1] >= 0.673, '命中区必须覆盖实测并集 0.325-0.673')
})

test('19 个素材名一个不少、不重复', () => {
  const names = Object.values(CLIPS).flat()
  assert.equal(names.length, 19)
  assert.equal(new Set(names).size, 19)
})

test('契约是冻结的（防运行期被改）', () => {
  assert.throws(() => { ASSET.W = 1 }, TypeError)
  assert.throws(() => { CLIPS.idle = [] }, TypeError)
  assert.ok(LOOPING.length === 2 && LOOPING.includes('idle') && LOOPING.includes('walk'))
})
```

- [ ] **Step 3: 跑**

Run: `npm test`  → Expected: **4 pass / 0 fail**。

> **执行期更正（Lead 实测）**：原文写 `node --test test/`，在 **Node v24.18.0** 下**必红**——`--test` 的目录位置参数不再被递归展开，而是被当成「一个测试文件」去跑：`✖ test (51ms) 'test failed'`，`tests 1 / pass 0 / fail 1`，exit 1。已在 `/tmp` 空白目录复现（与本仓无关，是 Node 的语义变化）。
> 正确形式是 glob：`node --test "test/**/*.test.mjs"`（由 Node 自己展开模式）。**不要**用 `node --test "test/**"`——它会把 `test` 目录本身也匹配进去，又踩同一个坑（实测 12 tests / 1 fail）。

- [ ] **Step 4: Commit**

```bash
git add src/shared/contract.js test/contract.test.mjs
git commit -m 'feat(contract): 共享契约真源（路由前缀/舞台几何/19 素材名）'
```

## Task 6: 配置层（JSONC 容忍解析 + 深合并 + 三层）

**Files:** Create `src/server/pet-config.js`；Modify `package.json`；Test `test/pet-config.test.mjs`

**为什么要自己写 JSONC 解析**：出厂配置带注释（`assets/default-config.jsonc` 已经有注释与尾逗号），而素材 URL 里会出现 `//` —— 用正则剥注释会误伤字符串。状态机 + 二次扫描尾逗号，零依赖。

- [ ] **Step 1: 写实现**

```js
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 包根（src/server/ 上两级）。 */
export const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url))

/** spec 事实 10：DSH_HOME 优先，否则 ~/.dsh（三行自实现，不引依赖包）。 */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

const BS = String.fromCharCode(92)
const NL = String.fromCharCode(10)
const WS = new Set([' ', String.fromCharCode(9), NL, String.fromCharCode(13)])

/**
 * 容忍 JSONC（注释 + 尾逗号）。状态机而非正则：字符串里的 // 必须原样保留。
 */
export function parseJsonc(text) {
  let stripped = ''
  let i = 0
  let inStr = false
  while (i < text.length) {
    const c = text[i]
    if (inStr) {
      stripped += c
      if (c === BS) { stripped += text[i + 1] === undefined ? '' : text[i + 1]; i += 2; continue }
      if (c === '"') inStr = false
      i++
      continue
    }
    if (c === '"') { inStr = true; stripped += c; i++; continue }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== NL) i++; continue }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    stripped += c
    i++
  }
  let out = ''
  for (let k = 0; k < stripped.length; k++) {
    if (stripped[k] === ',') {
      let j = k + 1
      while (j < stripped.length && WS.has(stripped[j])) j++
      if (stripped[j] === '}' || stripped[j] === ']') continue   // 丢掉这个尾逗号
    }
    out += stripped[k]
  }
  return JSON.parse(out)
}

/** 深合并：对象递归、**数组整组替换**、标量覆盖（spec §4.1 三层语义）。 */
export function deepMerge(base, over) {
  if (Array.isArray(over)) return over.slice()
  if (over === null || typeof over !== 'object') return over
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {}
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(out[k], v)
  return out
}

/** 校验：cast 非空、字段齐全、id 唯一。抛错必须能看出是哪个文件坏了。 */
export function validateConfig(config, source) {
  if (!config || typeof config !== 'object') throw new Error(source + ': 配置不是对象')
  if (!Array.isArray(config.cast) || config.cast.length === 0) throw new Error(source + ': cast 必须是非空数组')
  const seen = new Set()
  for (const pet of config.cast) {
    for (const k of ['id', 'name', 'anchor', 'size', 'animationDir', 'memeDir']) {
      if (pet === null || typeof pet !== 'object' || pet[k] === undefined) {
        throw new Error(source + ': cast[] 缺字段 ' + k + '（' + JSON.stringify(pet) + '）')
      }
    }
    if (seen.has(pet.id)) throw new Error(source + ': cast 里 id 重复: ' + pet.id)
    seen.add(pet.id)
    if (!Number.isFinite(pet.size) || pet.size <= 0) throw new Error(source + ': ' + pet.id + '.size 非法')
  }
  return config
}

/**
 * 三层读取：包内出厂 -> 用户覆盖（深合并）-> 校验。
 * @param {{packageDir?: string, home?: string}} [opts] 测试注入口
 */
export function loadPetConfig(opts = {}) {
  const packageDir = opts.packageDir || PACKAGE_DIR
  const home = opts.home || dshHome()
  const basePath = join(packageDir, 'assets', 'default-config.jsonc')
  const base = validateConfig(parseJsonc(readFileSync(basePath, 'utf8')), basePath)
  const userPath = join(home, 'dsh-kylin-pet', 'main-config.jsonc')
  if (!existsSync(userPath)) return base
  const merged = deepMerge(base, parseJsonc(readFileSync(userPath, 'utf8')))
  return validateConfig(merged, userPath)
}
```

- [ ] **Step 2: 写测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseJsonc, deepMerge, loadPetConfig, validateConfig } from '../src/server/pet-config.js'

const NL = String.fromCharCode(10)

/** 造一个「包内出厂配置 + 可选用户覆盖」的临时世界 */
function world(user) {
  const root = mkdtempSync(join(tmpdir(), 'kpet-'))
  const packageDir = join(root, 'pkg')
  const home = join(root, 'home')
  mkdirSync(join(packageDir, 'assets'), { recursive: true })
  writeFileSync(join(packageDir, 'assets', 'default-config.jsonc'), [
    '{',
    '  // 出厂注释',
    '  "cast": [ { "id": "a", "name": "甲", "anchor": "top-right", "size": 280, "animationDir": "main-animation", "memeDir": "main-memes" } ],',
    '  "directing": { "duet": { "distance": 120, "cooldownSec": 300 } },',
    '}',
  ].join(NL))
  if (user) {
    mkdirSync(join(home, 'dsh-kylin-pet'), { recursive: true })
    writeFileSync(join(home, 'dsh-kylin-pet', 'main-config.jsonc'), user)
  }
  return { packageDir, home }
}

test('parseJsonc: 注释与尾逗号被吃掉，字符串里的 // 不动', () => {
  assert.deepEqual(parseJsonc('{ "a": 1, /* x */ "b": "http://x/y", }'), { a: 1, b: 'http://x/y' })
})

test('deepMerge: 对象递归、数组整组替换', () => {
  const out = deepMerge({ a: { x: 1, y: 2 }, list: [1, 2], s: 'base' }, { a: { y: 9 }, list: [7], s: 'over' })
  assert.deepEqual(out, { a: { x: 1, y: 9 }, list: [7], s: 'over' })
})

test('无用户覆盖 -> 出厂配置', () => {
  const w = world(null)
  assert.equal(loadPetConfig(w).cast[0].id, 'a')
})

test('用户覆盖：深合并保留未提及的出厂键', () => {
  const w = world('{ "directing": { "duet": { "distance": 42 } } }')
  const cfg = loadPetConfig(w)
  assert.equal(cfg.directing.duet.distance, 42)
  assert.equal(cfg.directing.duet.cooldownSec, 300)
  assert.equal(cfg.cast[0].id, 'a')
})

test('用户 cast 整组替换（不按 id 合并）', () => {
  const w = world('{ "cast": [ { "id": "b", "name": "乙", "anchor": "bottom-left", "size": 200, "animationDir": "whale-animation", "memeDir": "whale-memes" } ] }')
  assert.deepEqual(loadPetConfig(w).cast.map((p) => p.id), ['b'])
})

test('校验：空 cast / 缺字段 / id 重复都要抛', () => {
  assert.throws(() => validateConfig({ cast: [] }, 'x'), /非空数组/)
  assert.throws(() => validateConfig({ cast: [{ id: 'a' }] }, 'x'), /缺字段 name/)
  const pet = { id: 'a', name: '甲', anchor: 'x', size: 1, animationDir: 'd', memeDir: 'm' }
  assert.throws(() => validateConfig({ cast: [pet, { ...pet }] }, 'x'), /id 重复/)
})

test('真实出厂配置能过校验（防 assets/default-config.jsonc 被改坏）', () => {
  const cfg = loadPetConfig({ home: '/nonexistent-home-for-test' })
  assert.deepEqual(cfg.cast.map((p) => p.id), ['kylinzi', 'xisha'])
  assert.deepEqual(cfg.directing.workStatus, { kylinzi: ['ok'], xisha: ['fail'] })
  assert.equal(cfg.directing.duet.distance, 120)
  assert.equal(cfg.directing.duet.cooldownSec, 300)
})
```

- [ ] **Step 3: 跑**

Run: `npm test` → Expected: **11 pass / 0 fail**（Task 5 的 4 + 本任务 7）。实测 `ℹ tests 11 / pass 11 / fail 0 / duration_ms 79`。

- [ ] **Step 4: 改 package.json（测试目录 + 验收台脚本）**

```json
"scripts": {
  "test": "node --test \"test/**/*.test.mjs\"",
  "harness": "node tools/harness.mjs",
  "check": "node --check src/shared/contract.js && node --check src/server/entry.js && node --check src/server/pet-config.js && node --check src/server/static-assets.js && node --check src/stage/client.js"
}
```

- [ ] **Step 5: Commit**

```bash
git add src/server/pet-config.js test/pet-config.test.mjs package.json
git commit -m 'feat(config): 三层配置（JSONC 状态机解析 + 深合并 + 校验）'
```

---

## Task 7: 素材解析（穿越守卫 + 用户目录优先）

**Files:** Create `src/server/static-assets.js`；Test `test/static-assets.test.mjs`

- [ ] **Step 1: 写实现**

```js
import { existsSync, realpathSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { MEME_EXT, ANIM_EXT } from '../shared/contract.js'
import { PACKAGE_DIR, dshHome } from './pet-config.js'

const BS = String.fromCharCode(92)
const NUL = String.fromCharCode(0)
const FORBIDDEN = new Set(['/', BS, NUL])

/**
 * 文件名守卫：它必须是个**名字**，不是路径。
 * 38 段素材全是中文名（必须放行），但分隔符 / 上跳 / NUL / 隐藏文件一律拒。
 */
export function isSafeName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 128) return false
  if (name === '.' || name === '..' || name.startsWith('.')) return false
  for (const ch of name) if (FORBIDDEN.has(ch)) return false
  return true
}

/** 真前缀复检（纵深防御：即便拼接被绕过，落点也必须仍在允许根内）。 */
function under(child, parent) {
  const c = resolve(child)
  const p = resolve(parent)
  return c === p || c.startsWith(p + sep)
}

/**
 * @param {{config: object, packageDir?: string, home?: string}} opts
 * @returns {(kind: 'pet'|'memes', role: string, encodedName: string) => null | {path: string, mime: string, size: number}}
 */
export function createAssetResolver(opts) {
  const config = opts.config
  const packageDir = opts.packageDir || PACKAGE_DIR
  const home = opts.home || dshHome()
  const byId = new Map(config.cast.map((pet) => [pet.id, pet]))
  const userRoot = join(home, 'dsh-kylin-pet', 'pet')
  const packageRoot = join(packageDir, 'assets', 'pet')

  return function resolveAsset(kind, role, encodedName) {
    if (kind !== 'pet' && kind !== 'memes') return null
    const pet = byId.get(role)          // role 白名单：只认 cast 里的 id（ASCII，故不解码）
    if (!pet) return null
    let name
    try { name = decodeURIComponent(encodedName) } catch { return null }
    if (!isSafeName(name)) return null
    const ext = kind === 'pet' ? ANIM_EXT : MEME_EXT
    if (!name.endsWith(ext)) return null

    const rel = join(kind === 'pet' ? pet.animationDir : pet.memeDir, name)
    for (const root of [userRoot, packageRoot]) {   // 用户目录优先（可覆盖单段素材）-> 包内出厂
      const candidate = join(root, rel)
      if (!under(candidate, root)) continue
      if (!existsSync(candidate)) continue
      const st = statSync(candidate)
      if (!st.isFile()) continue
      // 符号链接逃逸复检：**两侧都要规范化**。只规范化 candidate、拿未规范化的 root 去比，
      // 等于比较两个不同空间的路径：macOS 上 /var 是指向 /private/var 的符号链接，
      // 任何位于 /var 下的根（os.tmpdir()、软链安装的 store、软链 home）都会让**每一个**
      // 候选被判为逃逸 → 包内与用户覆盖素材全部静默 404。这是 2026-10-11 执行期实测到的 bug。
      let realRoot
      try { realRoot = realpathSync(root) } catch { continue }
      if (!under(realpathSync(candidate), realRoot)) continue
      return { path: candidate, mime: kind === 'pet' ? 'video/webm' : 'image/png', size: st.size }
    }
    return null
  }
}
```

- [ ] **Step 2: 写测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAssetResolver, isSafeName } from '../src/server/static-assets.js'

const BS = String.fromCharCode(92)
const CONFIG = { cast: [
  { id: 'kylinzi', name: '麒麟仔', anchor: 'top-right', size: 280, animationDir: 'main-animation', memeDir: 'main-memes' },
  { id: 'xisha', name: '鲸鱼娘', anchor: 'bottom-left', size: 280, animationDir: 'whale-animation', memeDir: 'whale-memes' },
] }

function world() {
  const root = mkdtempSync(join(tmpdir(), 'kpet-assets-'))
  const packageDir = join(root, 'pkg')
  const home = join(root, 'home')
  mkdirSync(join(packageDir, 'assets', 'pet', 'main-animation'), { recursive: true })
  mkdirSync(join(packageDir, 'assets', 'pet', 'main-memes'), { recursive: true })
  writeFileSync(join(packageDir, 'assets', 'pet', 'main-animation', '待机.webm'), 'PKG')
  writeFileSync(join(packageDir, 'assets', 'pet', 'main-memes', '笑.png'), 'PNG')
  return { root, packageDir, home, r: createAssetResolver({ config: CONFIG, packageDir, home }) }
}

test('中文名 + 正确扩展名 -> 命中包内', () => {
  const w = world()
  const hit = w.r('pet', 'kylinzi', encodeURIComponent('待机.webm'))
  assert.equal(hit.path, join(w.packageDir, 'assets', 'pet', 'main-animation', '待机.webm'))
  assert.equal(hit.mime, 'video/webm')
  assert.equal(hit.size, 3)
})

test('用户目录优先于包内，未覆盖则回落包内', () => {
  const w = world()
  mkdirSync(join(w.home, 'dsh-kylin-pet', 'pet', 'main-animation'), { recursive: true })
  writeFileSync(join(w.home, 'dsh-kylin-pet', 'pet', 'main-animation', '待机.webm'), 'USER')
  assert.equal(w.r('pet', 'kylinzi', encodeURIComponent('待机.webm')).path,
    join(w.home, 'dsh-kylin-pet', 'pet', 'main-animation', '待机.webm'))
  assert.equal(w.r('pet', 'kylinzi', encodeURIComponent('走路.webm')), null)
})

test('穿越与越权一律 null', () => {
  const w = world()
  const cases = [
    ['pet', 'kylinzi', encodeURIComponent('../../../etc/passwd')],
    ['pet', 'kylinzi', '..%2f..%2fsecret.webm'],
    ['pet', 'kylinzi', '%2e%2e%2f待机.webm'],
    ['pet', 'kylinzi', encodeURIComponent('/etc/passwd')],
    ['pet', 'nobody', encodeURIComponent('待机.webm')],
    ['pet', 'kylinzi', encodeURIComponent('待机.png')],
    ['memes', 'xisha', encodeURIComponent('笑.png')],
    ['pet', 'kylinzi', encodeURIComponent('.hidden.webm')],
    ['pet', 'kylinzi', 'bad%zz'],
    ['pet', 'kylinzi', ''],
    ['other', 'kylinzi', encodeURIComponent('待机.webm')],
  ]
  for (const c of cases) assert.equal(w.r(c[0], c[1], c[2]), null, JSON.stringify(c))
})

test('isSafeName 边界', () => {
  assert.ok(isSafeName('待机.webm'))
  assert.ok(isSafeName('a-b_c.png'))
  assert.ok(!isSafeName(''))
  assert.ok(!isSafeName('..'))
  assert.ok(!isSafeName('a/b'))
  assert.ok(!isSafeName('a' + BS + 'b'))
  assert.ok(!isSafeName('.x'))
})

test('符号链接逃逸被 realpath 复检挡住', () => {
  const w = world()
  writeFileSync(join(w.root, 'secret.webm'), 'SECRET')
  symlinkSync(join(w.root, 'secret.webm'), join(w.packageDir, 'assets', 'pet', 'main-animation', '逃.webm'))
  assert.equal(w.r('pet', 'kylinzi', encodeURIComponent('逃.webm')), null)
})
```

- [ ] **Step 3: 跑**

Run: `npm test` → Expected: **16 pass / 0 fail**。实测 `ℹ tests 16 / pass 16 / fail 0`。

（原文是 `node --test test/` —— Node v24 下必红，见 Task 5 Step 3 的执行期更正。）

- [ ] **Step 4: Commit**

```bash
git add src/server/static-assets.js test/static-assets.test.mjs
git commit -m 'feat(assets): 素材解析（角色白名单 + 名字守卫 + realpath 复检 + 用户目录优先）'
```

---

## Task 8: 宿主插件契约与路由

**Files:** Create `src/server/entry.js`；Test `test/entry.test.mjs`

**两个未知要先在测试里钉住**：① 前缀路由交给 handler 的 `req.url` 是**全路径**还是**去掉前缀的剩余段**（本实现两条都吃）；② `register` 的返回是否是 disposer（`ctx.effect` 只要求注册函数本身幂等/可回收）。实机安装时用 `/health` 一眼验证。

- [ ] **Step 1: 写实现**

```js
import { createReadStream } from 'node:fs'
import { ROUTE_PREFIX } from '../shared/contract.js'
import { loadPetConfig } from './pet-config.js'
import { createAssetResolver } from './static-assets.js'

/** 插件契约（spec 事实 2）：name / inject / apply 三个导出。 */
export const name = 'dsh-kylin-pet'
export const inject = ['webServer']

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text)),
    'cache-control': 'no-store',
  })
  res.end(text)
}

const ASSET_RE = /^\/(pet|memes)\/([^/]+)\/(.+)$/

/** 路由表：与 client 的 URL 契约一一对应（§4.2）。 */
export function createHandler(opts) {
  const config = opts.config
  const resolveAsset = opts.resolveAsset
  const castIds = config.cast.map((pet) => pet.id)
  return function handle(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    // 前缀路由可能给全路径，也可能给剩余段 —— 两条都吃
    const path = url.pathname.startsWith(ROUTE_PREFIX) ? url.pathname.slice(ROUTE_PREFIX.length) : url.pathname
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method-not-allowed' })
    if (path === '/health') return sendJson(res, 200, { ok: true, cast: castIds })
    if (path === '/config') return sendJson(res, 200, config)
    const m = ASSET_RE.exec(path)
    if (m) {
      const hit = resolveAsset(m[1], m[2], m[3])
      if (!hit) return sendJson(res, 404, { error: 'asset-not-found' })
      res.writeHead(200, {
        'content-type': hit.mime,
        'content-length': String(hit.size),
        'cache-control': 'no-store',
      })
      return createReadStream(hit.path).pipe(res)
    }
    return sendJson(res, 404, { error: 'not-found' })
  }
}

/** cordis 入口：注册一次前缀路由，disposer 交给 ctx.effect 管。 */
export function apply(ctx) {
  const config = loadPetConfig()
  const handle = createHandler({ config, resolveAsset: createAssetResolver({ config }) })
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: handle }),
    'dsh-kylin-pet routes @ ' + ROUTE_PREFIX,
  )
  if (ctx.logger && ctx.logger.info) {
    ctx.logger.info('[dsh-kylin-pet] ' + config.cast.map((p) => p.id).join(' + ') + ' @ ' + ROUTE_PREFIX)
  }
}
```

- [ ] **Step 2: 写测试（真 http server，不打桩）**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { name, inject, apply, createHandler } from '../src/server/entry.js'
import { ROUTE_PREFIX } from '../src/shared/contract.js'
import { loadPetConfig } from '../src/server/pet-config.js'
import { createAssetResolver } from '../src/server/static-assets.js'

function boot() {
  // 两处都钉同一个不存在的 home：**只有包内素材**，测试才是密闭的。
  // （原先只钉了配置层，素材解析层落到真实 $DSH_HOME —— 这条「真素材」测试于是在
  //   本机取到的是用户目录素材，而不是它声称要验的包内素材。2026-10-11 实测。）
  const home = '/nonexistent-home-for-test'
  const config = loadPetConfig({ home })
  const handler = createHandler({ config, resolveAsset: createAssetResolver({ config, home }) })
  const server = createServer(handler)
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({
    server,
    base: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((done) => server.close(done)),
  })))
}

test('插件契约三件套', () => {
  assert.equal(name, 'dsh-kylin-pet')
  assert.deepEqual(inject, ['webServer'])
  assert.equal(typeof apply, 'function')
})

test('apply 注册一条前缀路由，disposer 交给 effect 管', () => {
  const registered = []
  const effects = []
  const ctx = {
    webServer: { register: (r) => { registered.push(r); return () => {} } },
    effect: (fn, label) => { effects.push(label); return fn() },
    logger: { info: () => {} },
  }
  apply(ctx)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].kind, 'prefix')
  assert.equal(registered[0].path, ROUTE_PREFIX)
  assert.equal(typeof registered[0].handler, 'function')
  assert.match(effects[0], /dsh-kylin-pet/)
})

test('/health 与 /config', async () => {
  const app = await boot()
  try {
    const health = await fetch(app.base + ROUTE_PREFIX + '/health')
    assert.equal(health.status, 200)
    assert.deepEqual((await health.json()).cast, ['kylinzi', 'xisha'])
    const cfg = await fetch(app.base + ROUTE_PREFIX + '/config')
    assert.equal(cfg.headers.get('cache-control'), 'no-store')
    assert.deepEqual((await cfg.json()).cast.map((p) => p.id), ['kylinzi', 'xisha'])
  } finally { await app.close() }
})

test('真素材：中文名 URL 往返 + content-type + 非空 body', async () => {
  const app = await boot()
  try {
    for (const pet of ['kylinzi', 'xisha']) {
      const url = app.base + ROUTE_PREFIX + '/pet/' + pet + '/' + encodeURIComponent('待机.webm')
      const res = await fetch(url)
      assert.equal(res.status, 200, url)
      assert.equal(res.headers.get('content-type'), 'video/webm')
      const buf = Buffer.from(await res.arrayBuffer())
      assert.ok(buf.length > 10000, '素材不该是空壳：' + buf.length)
      assert.equal(buf.subarray(0, 4).toString('hex'), '1a45dfa3', 'EBML 魔数')
    }
  } finally { await app.close() }
})

test('404 / 405 / 越权', async () => {
  const app = await boot()
  try {
    assert.equal((await fetch(app.base + ROUTE_PREFIX + '/pet/nobody/' + encodeURIComponent('待机.webm'))).status, 404)
    assert.equal((await fetch(app.base + ROUTE_PREFIX + '/pet/kylinzi/' + encodeURIComponent('../../etc/passwd'))).status, 404)
    assert.equal((await fetch(app.base + ROUTE_PREFIX + '/nope')).status, 404)
    assert.equal((await fetch(app.base + ROUTE_PREFIX + '/health', { method: 'POST' })).status, 405)
  } finally { await app.close() }
})
```

- [ ] **Step 3: 跑**

Run: `npm test` → Expected: **21 pass / 0 fail**。实测 `ℹ tests 21 / pass 21 / fail 0`。

若「真素材」一条红：先确认 `boot()` 里 `createAssetResolver` **钉了不存在的 home**（否则它读的是用户目录素材，排查方向会跑偏），再回去跑 Task 1（38 段没入册）。

- [ ] **Step 4: Commit**

```bash
git add src/server/entry.js test/entry.test.mjs
git commit -m 'feat(host): 插件契约与路由（/health /config /pet /memes）'
```

---

## Task 9: 客户端单文件（契约 + 演员 + 世界 + 手势 + 挂载）

**Files:** Create `src/stage/client.js`；Test `test/client-contract.test.mjs`

**三条硬约束**（spec 事实 1，都是实机踩过的）：① 必须 `window.__ModuleLoader__.load({ id, factory })`；② 工厂**接收 require 形参**，漏了则整个条目激活失败；③ 所有实现收在 factory 作用域内，只经 `exports` 暴露——裸 CJS 顶层标识符会与他人相撞（`Identifier 'name' has already been declared`），整个 client 装配失败。

- [ ] **Step 1: 写 client.js**

```js
/**
 * dsh-kylin-pet — client 半（单文件，宿主契约强制）。
 * §1 契约  §2 小工具  §3 演员  §4 世界  §5 手势  §6 挂载与主循环
 * 直挂 document.body：桌宠是装饰层（见实施计划的「与 spec 的偏差」）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-kylin-pet',
  factory: (require) => {
    'use strict'
    const exports = {}

    /* ==================== §1 契约（与 src/shared/contract.js 逐字一致） ==================== */
    const ROUTE_PREFIX = '/dsh-kylin-pet-7341'
    const ASSET = Object.freeze({
      W: 640,
      H: 360,
      FOOT_RATIO: 330 / 360,
      CHAR_TOP: 30 / 360,
      HIT_X: [0.30, 0.70],
      CHAR_RATIO: 300 / 640,
    })
    const CLIPS = Object.freeze({
      idle: ['待机', '状态思考', '状态整理', '碎碎念'],
      walk: ['走路', '状态张望', '状态忙碌'],
      turn: ['转身'],
      held: ['被拎起'],
      sad: ['安抚失败', '余额偏低', '余额告急', '余额见底'],
      happy: ['点击开心', '开心跳跃', '庆祝成功', '余额健康', '余额充裕', '余额正常'],
    })
    const LOOPING = Object.freeze(['idle', 'walk'])
    const ANIM_EXT = '.webm'
    const STAGE_ID = 'dsh-kylin-pet-stage'
    const DROP_DISTANCE = 120   // spec §8：拖到一起放下即触发一次近距离互动

    exports.inject = []
    exports.__kylinContract = Object.freeze({ ROUTE_PREFIX, ASSET, CLIPS, LOOPING, ANIM_EXT })

    /* ==================== §2 小工具 ==================== */
    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
    const rand = (a, b) => a + Math.random() * (b - a)

    /** 稳定种子：同 id 每次刷新得到同一条序列（两宠互不相同 -> 空闲链不同拍，spec R7）。 */
    const fnv = (s) => {
      let h = 2166136261
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
      return h >>> 0
    }
    const rngOf = (seed) => () => {
      seed = (seed + 0x6D2B79F5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = (list, rng) => list[Math.floor(rng() * list.length)]
    const animUrl = (pet, name) =>
      ROUTE_PREFIX + '/pet/' + encodeURIComponent(pet.id) + '/' + encodeURIComponent(name + ANIM_EXT)

    /* ==================== §3 演员 ==================== */
    function createActor(pet) {
      const w = pet.size
      const h = pet.size * ASSET.H / ASSET.W

      const el = document.createElement('div')
      el.style.position = 'absolute'
      el.style.left = '0'
      el.style.top = '0'
      el.style.width = w + 'px'
      el.style.height = h + 'px'
      el.style.willChange = 'transform'
      el.style.pointerEvents = 'none'

      const mkVideo = () => {
        const v = document.createElement('video')
        v.muted = true
        v.playsInline = true
        v.preload = 'auto'
        v.style.position = 'absolute'
        v.style.left = '0'
        v.style.top = '0'
        v.style.width = '100%'
        v.style.height = '100%'
        v.style.objectFit = 'contain'
        v.style.opacity = '0'
        v.style.transition = 'opacity 110ms linear'
        return v
      }
      const vids = [mkVideo(), mkVideo()]   // 双缓冲：换片不闪黑

      // 命中区 = 盘内角色实际占位（实测并集），其余区域点击穿透
      const hit = document.createElement('div')
      hit.style.position = 'absolute'
      hit.style.pointerEvents = 'auto'
      hit.style.cursor = 'grab'
      hit.style.left = (ASSET.HIT_X[0] * 100) + '%'
      hit.style.width = ((ASSET.HIT_X[1] - ASSET.HIT_X[0]) * 100) + '%'
      hit.style.top = (ASSET.CHAR_TOP * 100) + '%'
      hit.style.height = ((ASSET.FOOT_RATIO - ASSET.CHAR_TOP) * 100) + '%'

      el.appendChild(vids[0])
      el.appendChild(vids[1])
      el.appendChild(hit)

      const a = {
        pet: pet, el: el, hit: hit, box: { w: w, h: h },
        x: 0, y: 0,                 // 脚点（px）
        facing: 1,
        clip: null,
        held: false,
        front: 0,
        rng: rngOf(fnv(pet.id)),
        next: 1.5 + (fnv(pet.id) % 1000) / 500,   // 首拍错开
        target: null,
        immunityUntil: 0,
        onEnded: null,
      }

      a.setFacing = (f) => {
        if (f === a.facing) return
        a.facing = f
        const t = f < 0 ? 'scaleX(-1)' : 'none'
        vids[0].style.transform = t
        vids[1].style.transform = t
      }

      a.play = (clip) => {
        if (a.clip === clip) return
        a.clip = clip
        const url = animUrl(pet, pick(CLIPS[clip], a.rng))
        const back = vids[1 - a.front]
        back.loop = LOOPING.indexOf(clip) >= 0
        back.setAttribute('src', url)
        back.currentTime = 0
        back.play().then(() => {
          back.style.opacity = '1'
          vids[a.front].style.opacity = '0'
          vids[a.front].pause()
          a.front = 1 - a.front
        }, () => { /* 素材缺失不该打断舞台：静默保留上一帧 */ })
      }

      for (const v of vids) {
        v.addEventListener('ended', () => {
          if (v !== vids[a.front]) return
          if (LOOPING.indexOf(a.clip) >= 0) return
          if (a.onEnded) a.onEnded()
        })
      }

      a.layout = () => {
        const left = a.x - w / 2
        const top = a.y - h * ASSET.FOOT_RATIO
        el.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)'
      }
      a.destroy = () => el.remove()
      return a
    }

    /* ==================== §4 世界（唯一位移权威） ==================== */
    const ANCHORS = {
      'top-right': [0.86, 0.34],
      'bottom-left': [0.14, 0.88],
      'top-left': [0.14, 0.34],
      'bottom-right': [0.86, 0.88],
    }

    function createWorld(opts) {
      const root = opts.root
      const actors = opts.config.cast.map(createActor)
      const W = () => root.clientWidth || window.innerWidth
      const H = () => root.clientHeight || window.innerHeight

      for (const a of actors) {
        const home = ANCHORS[a.pet.anchor] || [0.5, 0.88]
        a.x = home[0] * W()
        a.y = home[1] * H()
        root.appendChild(a.el)
        a.layout()
        a.play('idle')
      }

      /** 两只靠太近时沿 x 推开 —— 世界是唯一裁决点（spec 铁律 1）。 */
      function separate() {
        for (let i = 0; i < actors.length; i++) {
          for (let j = i + 1; j < actors.length; j++) {
            const x = actors[i]
            const y = actors[j]
            const minGap = (x.box.w + y.box.w) * 0.28
            const dx = y.x - x.x
            if (Math.abs(dx) > minGap) continue
            const push = ((minGap - Math.abs(dx)) / 2) * (dx >= 0 ? -1 : 1)
            x.x += push
            y.x -= push
          }
        }
      }

      /** V1 的独处链：待机 / 散步 / 转身（V3 起由心智 Mind 接管）。 */
      function idleChain(a, dt) {
        if (a.held || a.target) return
        a.next -= dt
        if (a.next > 0) return
        const r = a.rng()
        if (r < 0.45) {
          a.play('walk')
          a.target = { x: rand(0.15, 0.85) * W(), y: rand(0.5, 0.92) * H() }
        } else if (r < 0.70) {
          a.play('turn')
          a.setFacing(a.facing < 0 ? 1 : -1)
          a.next = rand(1.2, 2.4)
        } else {
          a.play('idle')
          a.next = rand(2.5, 7)
        }
      }

      function step(dt) {
        const w = W()
        const h = H()
        for (const a of actors) {
          if (!a.held && a.target) {
            const dx = a.target.x - a.x
            const dy = a.target.y - a.y
            const d = Math.sqrt(dx * dx + dy * dy)
            if (d < 4) {
              a.target = null
              a.play('idle')
              a.next = rand(2.5, 7)
            } else {
              const v = Math.min(90 * dt, d)
              a.x += (dx / d) * v
              a.y += (dy / d) * v
              if (Math.abs(dx) > 1) a.setFacing(dx < 0 ? -1 : 1)
            }
          }
          idleChain(a, dt)
        }
        separate()
        for (const a of actors) {
          a.x = clamp(a.x, a.box.w / 2, w - a.box.w / 2)
          a.y = clamp(a.y, a.box.h * ASSET.FOOT_RATIO + 4, h - 4)
          a.layout()
        }
      }

      function nearest(a, within) {
        let best = null
        let bestD = Infinity
        for (const b of actors) {
          if (b === a) continue
          const d = Math.hypot(b.x - a.x, b.y - a.y)
          if (d < bestD) { bestD = d; best = b }
        }
        return bestD <= within ? best : null
      }

      /** 拖到一起放下后的 V1 占位：转身面对面 + 各放一次开心。V3 换成真 Interaction。 */
      function bump(a, b) {
        a.setFacing(b.x < a.x ? -1 : 1)
        b.setFacing(a.x < b.x ? -1 : 1)
        a.play('happy')
        b.play('happy')
        a.next = rand(2, 4)
        b.next = rand(2, 4)
      }

      return { actors: actors, step: step, separate: separate, nearest: nearest, bump: bump, W: W, H: H }
    }

    /* ==================== §5 手势 ==================== */
    function wireGestures(world) {
      for (const a of world.actors) {
        let grab = null

        a.onEnded = () => {
          if (a.held || a.target) return
          a.play('idle')
          a.next = rand(2.5, 7)
        }

        a.hit.addEventListener('pointerdown', (e) => {
          e.preventDefault()
          try { a.hit.setPointerCapture(e.pointerId) } catch (err) { /* 合成事件/已释放的 pointer 不该炸 */ }
          grab = { id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: e.clientX - a.x, dy: e.clientY - a.y, moved: false }
          a.hit.style.cursor = 'grabbing'
        })

        a.hit.addEventListener('pointermove', (e) => {
          if (!grab || e.pointerId !== grab.id) return
          if (!grab.moved && Math.hypot(e.clientX - grab.sx, e.clientY - grab.sy) > 4) {
            grab.moved = true
            a.held = true
            a.target = null
            a.play('held')
          }
          if (!grab.moved) return
          a.x = e.clientX - grab.dx
          a.y = e.clientY - grab.dy
          a.layout()
        })

        const release = (e) => {
          if (!grab || e.pointerId !== grab.id) return
          const dragged = grab.moved
          grab = null
          a.hit.style.cursor = 'grab'
          if (!dragged) {
            a.play('happy')
            const mate = world.nearest(a, Infinity)
            // spec §8：对方是否好奇凑过来由关系决定；V1 无账本，先 50% 占位，V3 换 affinity
            if (mate && !mate.held && Math.random() < 0.5) {
              mate.setFacing(a.x < mate.x ? -1 : 1)
              mate.play('walk')
              mate.target = { x: a.x + (a.x < mate.x ? 90 : -90), y: a.y }
            }
            return
          }
          a.held = false
          a.immunityUntil = performance.now() + 2000
          a.play('idle')
          a.next = rand(2, 5)
          const mate = world.nearest(a, DROP_DISTANCE)
          if (mate && !mate.held) world.bump(a, mate)
        }
        a.hit.addEventListener('pointerup', release)
        a.hit.addEventListener('pointercancel', release)
      }
    }

    /* ==================== §6 挂载与主循环 ==================== */
    function createStageRoot() {
      const root = document.createElement('div')
      root.id = STAGE_ID
      root.style.position = 'fixed'
      root.style.left = '0'
      root.style.top = '0'
      root.style.right = '0'
      root.style.bottom = '0'
      root.style.overflow = 'hidden'
      root.style.pointerEvents = 'none'   // 整层穿透，只有宠的命中区收事件
      root.style.zIndex = '2147483000'
      root.style.contain = 'layout style'
      return root
    }

    async function start() {
      if (document.getElementById(STAGE_ID)) return
      let config
      try {
        const res = await fetch(ROUTE_PREFIX + '/config', { cache: 'no-store' })
        if (!res.ok) throw new Error('HTTP ' + res.status)
        config = await res.json()
      } catch (err) {
        console.warn('[dsh-kylin-pet] 配置读取失败，舞台未启动：', err)
        return
      }
      if (!config || !Array.isArray(config.cast) || config.cast.length === 0) {
        console.warn('[dsh-kylin-pet] 配置里没有 cast，舞台未启动')
        return
      }
      const root = createStageRoot()
      document.body.appendChild(root)
      const world = createWorld({ config: config, root: root })
      wireGestures(world)
      let last = performance.now()
      const frame = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        if (!document.hidden) world.step(dt)   // spec R4：后台标签页不跑
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
      console.info('[dsh-kylin-pet] 舞台已就绪：' + config.cast.map((p) => p.id).join(' + '))
    }

    exports.apply = () => {
      start().catch((err) => console.warn('[dsh-kylin-pet] 启动失败：', err))
    }
    return exports
  },
})
```

- [ ] **Step 2: 写一致性测试（vm 装载真 client）**

**原生陷阱**：vm 里跑出来的对象属于**另一个 realm**，`deepStrictEqual` 会比 `[[Prototype]]` 而直接判不等 —— 所以先 JSON 归一化再比（下面的 `canon`）。

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as host from '../src/shared/contract.js'

const SHARED_KEYS = ['ROUTE_PREFIX', 'ASSET', 'CLIPS', 'LOOPING', 'ANIM_EXT']

/** JSON 归一化 + 键排序：跨 realm 对象不能直接 deepStrictEqual。 */
function canon(value) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, walk(v[k])]))
    }
    return v
  }
  return JSON.stringify(walk(JSON.parse(JSON.stringify(value))))
}

/** 在裸 realm 里跑 client.js：只提供 window.__ModuleLoader__，不碰 DOM。 */
function loadClient() {
  const src = readFileSync(new URL('../src/stage/client.js', import.meta.url), 'utf8')
  let captured = null
  const win = {
    __ModuleLoader__: {
      load: (mod) => {
        assert.equal(mod.id, 'dsh-kylin-pet')
        captured = mod.factory(() => { throw new Error('client 不该在装载期 require 任何模块') })
      },
    },
  }
  vm.runInNewContext(src, { window: win, console: console, performance: performance })
  assert.ok(captured, 'client.js 必须调用 window.__ModuleLoader__.load')
  return captured
}

test('client 与 host 契约逐键对齐（允许重复，禁止漂移）', () => {
  const client = loadClient()
  assert.ok(client.__kylinContract, 'client 必须暴露 __kylinContract 供一致性测试')
  for (const k of SHARED_KEYS) {
    assert.equal(canon(client.__kylinContract[k]), canon(host[k]), '契约漂移：' + k)
  }
})

test('client 只暴露 inject / apply / __kylinContract', () => {
  const client = loadClient()
  assert.deepEqual(Object.keys(client).sort(), ['__kylinContract', 'apply', 'inject'])
  assert.deepEqual(client.inject, [])
  assert.equal(typeof client.apply, 'function')
})

test('工厂能接住 require 形参（漏了它整个条目会激活失败）', () => {
  const src = readFileSync(new URL('../src/stage/client.js', import.meta.url), 'utf8')
  assert.match(src, /factory:\s*\(\s*require\s*\)/)
})
```

- [ ] **Step 3: 跑**

Run: `npm test` → Expected: **24 pass / 0 fail**。

- [ ] **Step 4: Commit**

```bash
git add src/stage/client.js test/client-contract.test.mjs
git commit -m 'feat(stage): 单文件客户端（契约/演员/世界/手势/挂载）'
```

---

## Task 10: 开发期验收台

**Files:** Create `tools/harness.mjs`（`package.json` 的 `scripts.harness` 已在 Task 6 加好）

**它为什么值得存在**：它用**真 host 模块**（`loadPetConfig` / `createAssetResolver`）伺服配置与素材，再用**真 client.js** 在真浏览器里跑舞台——与生产只差一个 DSH webServer。于是「双宠同框」这条硬门有了可复现、可脚本化的取证手段，不再需要「你刷新一下看看」。

- [ ] **Step 1: 写验收台**

```js
#!/usr/bin/env node
/**
 * dsh-kylin-pet 开发期验收台。
 * 用法: node tools/harness.mjs [端口]   默认 7391
 */
import { createReadStream, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { loadPetConfig } from '../src/server/pet-config.js'
import { createAssetResolver } from '../src/server/static-assets.js'
import { ROUTE_PREFIX } from '../src/shared/contract.js'

const NL = String.fromCharCode(10)
const port = Number(process.argv[2] || process.env.PORT || 7391)
const config = loadPetConfig()
const resolveAsset = createAssetResolver({ config })
const clientPath = new URL('../src/stage/client.js', import.meta.url)

const PAGE = [
  '<!doctype html><html lang="zh"><head><meta charset="utf-8">',
  '<title>dsh-kylin-pet harness</title>',
  '<style>html,body{margin:0;height:100%;background:#0e1116;overflow:hidden}</style>',
  '</head><body>',
  '<script>',
  'window.__ModuleLoader__ = { load: function (m) {',
  '  var ex = m.factory(function (id) { throw new Error("harness: client 不该 require " + id) })',
  '  window.__petExports = ex',
  '  ex.apply({})',
  '} }',
  '</script>',
  '<script src="/client.js"></script>',
  '</body></html>',
].join(NL)

const ASSET_RE = new RegExp('^' + ROUTE_PREFIX + '/(pet|memes)/([^/]+)/(.+)$')

createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(PAGE)
  }
  if (url.pathname === '/client.js') {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(readFileSync(clientPath))
  }
  if (url.pathname === ROUTE_PREFIX + '/health' || url.pathname === ROUTE_PREFIX + '/config') {
    const body = url.pathname.endsWith('/health')
      ? { ok: true, cast: config.cast.map((p) => p.id) }
      : config
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(JSON.stringify(body))
  }
  const m = ASSET_RE.exec(url.pathname)
  if (m) {
    const hit = resolveAsset(m[1], m[2], m[3])
    if (hit) {
      res.writeHead(200, { 'content-type': hit.mime, 'content-length': String(hit.size), 'cache-control': 'no-store' })
      return createReadStream(hit.path).pipe(res)
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
}).listen(port, '127.0.0.1', () => {
  console.log('harness: http://127.0.0.1:' + port)
  console.log('  cast: ' + config.cast.map((p) => p.id).join(', '))
})
```


- [ ] **Step 2: 手工冒烟（三条 curl）**

```bash
node tools/harness.mjs 7391 &
sleep 0.5
curl -s http://127.0.0.1:7391/dsh-kylin-pet-7341/health
curl -s http://127.0.0.1:7391/dsh-kylin-pet-7341/config | head -c 200
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' 'http://127.0.0.1:7391/dsh-kylin-pet-7341/pet/kylinzi/%E5%BE%85%E6%9C%BA.webm'
```

Expected: `{"ok":true,"cast":["kylinzi","xisha"]}` / 配置 JSON / `200 video/webm`。

- [ ] **Step 3: Commit**

```bash
git add tools/harness.mjs
git commit -m 'test(harness): 开发期验收台（真 host 模块 -> 真浏览器）'
```

---

## Task 11: 真浏览器取证（V1 的唯一验收）

**为什么要脚本化**：spec §11.3 明写「不以『用户刷新一下看看』作为验收」。以下步骤跑完，V1 才算完。

- [ ] **Step 1: 起验收台**

用后台作业跑 `node tools/harness.mjs 7391`，等它打印 `harness: http://127.0.0.1:7391`。

- [ ] **Step 2: 双宠同框 —— 待机**

Playwright：`browser_navigate` -> `http://127.0.0.1:7391`，等 3s，截图存 `staging/v1/01-idle.png`。

然后用 `browser_evaluate` 断言（只看 DOM，不依赖内部闭包）：

```js
const root = document.querySelector('#dsh-kylin-pet-stage')
const actors = [...root.children]
JSON.stringify({
  actors: actors.length,                              // 期望 2
  videos: root.querySelectorAll('video').length,       // 期望 4（每宠双缓冲）
  canvas: [root.clientWidth, root.clientHeight],
  transforms: actors.map((el) => el.style.transform),  // 两只位置必须不同
})
```

Expected: `actors:2`、`videos:4`、两条 transform 不同。

- [ ] **Step 3: 间隔取样证明「各自在动」**

隔 2s 再取一次同样表达式 —— 至少一只的 transform 变化（待机链在跑）；两次取样里两只的变化时刻不同（spec R7：空闲链不同拍）。

- [ ] **Step 4: 点击 + 拖到一起放下 + 边界**

1. `browser_click` 麒麟仔的命中区（其 `> div:last-child`）→ 截图 `staging/v1/02-click-happy.png`（前台 video 的 src 应命中 `CLIPS.happy` 的某个别名）。
2. `browser_drag`：从麒麟仔命中区拖到鲸鱼娘命中区放下 → 截图 `staging/v1/03-dropped-together.png`，并断言两只的朝向组合为「相对」（`bump()` 的可见后果）。
3. 边界：把一只拖到视口外再松手，断言下一帧它被 clamp 回视口内。

- [ ] **Step 5: 结论写回计划并 Commit**

在本文件末尾**新增一节「V1 取证记录」**，把三张截图路径 + 四条断言的实际输出写进去，然后：

```bash
git add staging/v1 plans/2026-10-11-v2-v0-v1-implementation.md
git commit -m 'test(v1): 真浏览器取证（双宠同框/点击/拖到一起/边界）'
```

---

## Task 12: 实机安装与收口

**Files:** Modify `package.json`（兼容表）、`README.md`（勾 V0/V1）

- [ ] **Step 1: 兼容表补上真实运行时**

`package.json` 现在只声明 `0.2.0-rc.1 / 0.2.0-rc.2`，而本机运行时是 `dsh 0.2.1-alpha.2`（`dsh --version` 实测）。改成：

```json
"compatibility": { "dshReleases": { "0.2.0-rc.1": "compatible", "0.2.0-rc.2": "compatible", "0.2.1-alpha.2": "compatible" } }
```

- [ ] **Step 2: 实机安装（这一条我替你跑不了，需要你点头）**

```bash
# 装进 web profile（file: 指向本仓）
dsh plugin --profile web add file:/Users/libing/kk_Projects/dsh-kylin-pet
# 起引擎（web profile）
dsh web
```

Expected：引擎日志出现 `[dsh-kylin-pet] kylinzi + xisha @ /dsh-kylin-pet-7341`，页面出现两只宠。若插件条目 pending/激活失败，先 `curl http://127.0.0.1:<端口>/dsh-kylin-pet-7341/health` 定位是「路由没挂上」还是「client 没跑起来」。

- [ ] **Step 3: README 勾选**

把 `- [ ] **V0 仓务**` 与 `- [ ] **V1 上桌**` 改成 `[x]`（**有证据了才勾**——这是 M1 那轮踩过的坑）。

- [ ] **Step 4: 提交**

```bash
git add package.json README.md
git commit -m 'chore(v1): 兼容表补 0.2.1-alpha.2 + README 勾 V0/V1'
git log --oneline
```

---

# 自审（写完回头对 spec 逐条核）

## 1. Spec 覆盖

| spec 章节 | 落在哪个 Task |
|---|---|
| §2 事实 1（client 契约） | Task 9（三条硬约束 + 工厂 require 断言） |
| §2 事实 2（host 契约） | Task 8（name/inject/apply + 前缀路由） |
| §2 事实 4/5/5b（素材与几何） | Task 1（入册 + 机检）、Task 5（几何常量来自实测包围盒） |
| §2 事实 7（6 段真实美术） | Task 5 的 `CLIPS` 表：19 名 -> 6 档 |
| §2 事实 9（仓状态） | Task 4（孤儿分支 + 首次提交） |
| §2 事实 10（DSH home） | Task 6 的 `dshHome()` |
| §4.1 三层配置 + 语义 | Task 6 |
| §4.2 路由（config / pet / memes） | Task 8 + Task 10 |
| §4.3 舞台几何（比例制） | Task 5 + Task 9 §1 契约 + `layout()` |
| §4.4 素材语义表 | Task 5 的 `CLIPS` + Task 9 的 `play(clip)` |
| §8 点击 / 拖拽（含拖到一起放下） | Task 9 §5 + Task 11 Step 4 |
| §9 文件布局 | 全部 Task（新增 `src/shared/` 与 `test/`；去掉 state/stimuli/ledger——属 V2/V3） |
| §10 V0/V1 | 本计划 |
| §11 硬门 1（clean-room） | Task 2 + Task 4 Step 4 |
| §11 硬门 2（素材机检） | Task 1 Step 3 |
| §11 硬门 3（双宠同框截图） | Task 11 |
| §11 硬门 5（零构建） | 全计划无构建步骤；Task 8/10 直接跑源码 |
| §11 硬门 6（契约不漂移） | Task 9 Step 2 |
| §12 R4（解码开销） | Task 9 的 `document.hidden` 闸 |
| §12 R5（中文名 URL） | Task 8 Step 2 的真素材往返 |
| §12 R6（2D 观感） | Task 9 的 `ANCHORS` 默认值（观感不佳只改这张表） |
| §12 R7（同拍） | Task 9 的 `fnv(pet.id)` 种子 + 首拍错开 |

**明确不在本计划**（各自单独一份计划，V1 落地后再写）：§4.5 关系账本、§5 心智、§6 导演与 Interaction、§7 八个剧本（V3）；§8 的 DSH 诱因与 `/state`、余额（V2 —— R2/R3 要求先实测宿主事件名与 `credentials` 形状，不能靠猜写计划）；V4 设置页。

## 2. 占位符扫描

零 TBD / 零 TODO / 零「类似 Task N」：每个改代码的步骤都给了完整代码，每条验证都给了命令与期望输出。

## 3. 类型 / 签名一致性（自己抓到的两处，已在计划里规避）

1. `resolveAsset(kind, role, encodedName)` 在 Task 7 定义、Task 8 的 handler 调用、Task 10 的验收台调用，**三处签名一致**；role 走 cast id 白名单直接匹配（ASCII，不解码），只有 name 做 `decodeURIComponent` —— 这个不对称是刻意的，已写进 Task 7 注释。
2. 契约比较不能用 `deepStrictEqual`：vm 里出来的对象在另一个 realm，`[[Prototype]]` 不同会误判。Task 9 用 `canon()` 先 JSON 归一化。这是写计划时先踩到的坑，不留给执行期。

---

# 验收（V1 done 的定义）

| # | 判据 | 证据 |
|---|---|---|
| 1 | 素材入册 | `node scripts/check-assets.mjs assets/pet` -> 38/38 PASS |
| 2 | clean-room | `node scripts/check-clean-room.mjs` -> 两行 PASS，且负对照能红 |
| 3 | 单元 / 集成测试 | `npm test` -> 24 pass / 0 fail |
| 4 | 双宠同框 | Task 11 的三张截图 + DOM 断言输出 |
| 5 | 实机 | 你装进 web profile 后看到两只宠（Task 12 Step 2） |

---

# 执行交接

计划已落盘：`plans/2026-10-11-v2-v0-v1-implementation.md`。两种执行方式：

**1. 子代理驱动（推荐）** —— 每个 Task 派一个干净上下文的子代理，Task 之间我来审（尤其 V0 的孤儿分支提交与 Task 11 的取证），迭代快、上下文不污染。

**2. 本会话内联执行** —— 我按 Task 顺序直接干，每个 Task 结束停一下给你看证据（提交点就是检查点）。

你要哪种？（也可以说「V0 先做、V1 再说」——V0 的 4 个 Task 完全独立，做完就是一个可交付的仓务节点。）

