# dsh-kylin-pet v2 · V4 实施计划（收口）

**目标**：把 v2 从「能跑」变成「**可交付**」——文档与事实对齐、设定集与代码钉死、关系重置有可执行入口。

**验收句（三条）**：
1. **README 的路线图勾选与真实交付状态逐条对得上**（有证据才勾 —— 本仓在 M1 那轮踩过「假勾」的坑）。
2. **设定集与代码一致是「可执行的」**，不是文档里的一句声称：一条测试对 `docs/character-bible.md` 与 `client.js` 的 `LINES` 做**双向对账**，任一方向多出条目就红。
3. **关系重置有明确入口且真的生效**：执行后 `GET /bond` 回空账、`bond.json` 被清（或归档），且**两只宠的后续行为随之改变**（点击时「好奇凑过来」的概率回到中性）。

**依据**：spec §10 的 V4 行 / §11 各硬门 / §15 与 §15.1 的 V4 侦察。

---

## 0. 交付顺序与依赖（**先说清，免得又当成漏了**）

| Task | 依赖 | 说明 |
|---|---|---|
| 1 README 收口 | V1/V2/V3 已交付 | 只勾**已经有证据**的那些；V3b 未执行 ⇒ V3b 那条**不勾** |
| 2 文案一致性测试 | **V3b 已落地** | V3b 之前 `LINES` 里只有 3 条诱因文案，而设定集记了 8 个剧本的 —— 此时对账**必然红**。所以本 Task 排在 V3b 之后 |
| 3 关系重置入口 | 无 | 主路 = `/pet` 命令；**降级路 = 文档化文件操作**。见 §2 |
| 4 真机安装与终验 | **用户执行** | B 步要重启 web profile 引擎，**会杀掉 Lead 自己的会话**（spec §15 / V1 Task12 已查清） |

---

## 1. 关系重置：两条路，按实测结果选（**不把未验证的前提当既成事实**）

spec §15.1 已钉死两条事实：
- `inject` 的语义是 **required services** ⇒ 为一条命令声明 `inject: ['commands']`，会在 commands 缺席时让**整个桌宠插件 pending**（本仓踩过 33 条 pending 的事故）。
- 有一条**不需要 inject 就能读服务**的路：`ctx.get(name)`（cordis 源码注释原文 *"Read a service from the store without the inject requirement"*）。

**但「读得到」不等于「读得到时服务已就绪」** —— 这是唯一未实测的点。所以本 Task 分主/降级两路：

| 路 | 触发条件 | 内容 |
|---|---|---|
| **主路 3a** | 在真 profile 里实测 `apply()` 执行时 `ctx.get('commands')` **有值** | 注册 `/pet` 命令：`/pet status`（回账本与两只的 mood/energy 摘要）、`/pet reset`（清账本） |
| **降级路 3b** | 实测时**无值**（或时有时无） | **不注册命令**（插件保持零依赖、零 pending 风险），改为：`README.md` 增加「关系重置」一节，写明**删/改名 `<dsh家目录>/dsh-kylin-pet/bond.json` 后重启引擎**即重置，并把这一步写进 `docs/character-bible.md` 的脚注 |

**实测怎么做（Lead 亲跑，Task 3 Step 1）**：在真 profile 里加一条**只读**日志——`apply(ctx)` 里 `ctx.logger.info('commands? ' + String(!!(ctx.get && ctx.get('commands'))))`——装包并起引擎后看日志。**这一步就是 V1 Task12 Step2 的 B 步本身**，所以它顺带把「真加载器 + 真插件激活层」这条**唯一未证明环节**也证了。

> **为什么降级路也可接受**：spec §13 裁决②要的是「关系重置 + 只读状态」的最小版。`/pet status` 的价值可以用「`GET /bond` + `GET /balance` 两条已存在的只读路由」替代（用户可 `curl`，也可以由将来的 UI 消费）；而重置本质上就是**一个文件操作**，把它文档化不是偷懒，是**承认这个能力不需要代码**。

---

## 2. 文件增量

| 文件 | 动作 | 职责 |
|---|---|---|
| `README.md` | 改 | 路线图勾选与事实对齐 + 「关系重置」一节（3a 或 3b 二选一） |
| `docs/character-bible.md` | 改 | 3b 时补脚注；2 之后与代码一致 |
| `test/bible.test.mjs` | 新建 | 设定集 ↔ `LINES` 双向对账 |
| `src/server/entry.js` | 改（仅 3a） | 注册 `/pet` 命令 |
| `test/entry.test.mjs` | 改（仅 3a） | 命令注册与两条子命令 |

---

## Task 1: README 收口（**有证据才勾**）

**Files:** Modify `README.md`

路线图逐条按**实际状态**处理：

| 条目 | 处置 | 依据 |
|---|---|---|
| V0 仓务 | 已是 `[x]` | 38/38 机检 + clean-room 两门 + 孤儿分支 `6ec09e5` |
| V1 上桌 | 已是 `[x]` | `evidence/v1/` 三张截图 + 12/12 硬门 |
| V2 事件面 | **改 `[x]`** | `evidence/v2/` 四张截图 + 12/12 硬门 |
| V3 双宠社交 | **拆成两行**：`V3 关系与余额` 勾（V3 落地后）、`V3b 心智/导演/剧本` 留给 V3b | 本仓的 V3/V3b 切分与 spec 原表不同，README 要反映**实际**切分 |
| V4 收口 | 本 Task 完成后勾 | —— |

另加两节：
- **「开发期验收台」**：`node tools/harness.mjs [端口] [账本路径]` 的用法 + 两条开发期后门（`/__emit`、`/__balance`）**明写「只在 harness、不在生产」**；
- **「关系重置」**：按 3a/3b 的实测结果写（见 §1）。

Run: `grep -n '^- .x.' README.md` → 逐条与上表核对，**多勾或少勾都算错**。

---

## Task 2: 设定集 ↔ 代码一致性（**把声称变成可执行**）

**Files:** Create `test/bible.test.mjs`；可能 Modify `docs/character-bible.md`

设定集第 5 节声称「台词全量清单」。**声称要么可执行，要么迟早变成假话**（写这份设定集时我就犯过一次：把「计划中」的表标成「与代码逐条对应」）。所以：

```js
// test/bible.test.mjs（要点）
// 1) 从 docs/character-bible.md 的表里解析出 { 场景/剧本 -> 台词 } 的映射
// 2) 从 src/stage/client.js 的源码里正则取出 LINES 的两张表（诱因面 / 剧本面）
// 3) **双向对账**：
//    - 代码里有的，设定集必须有；
//    - 设定集标为「已实现」的，代码里必须有；
//    - 设定集标为「计划中」却已在代码里的 ⇒ 红（说明忘了更新状态标注）
```

覆盖：
1. 诱因面三条（`turn-ok` / `turn-fail` / `waiting`）与 `client.js:33` 的 `LINES` 逐值相等；
2. V3b 落地后，剧本面七条与 `client.js` 的剧本 `LINES` 逐值相等（**V3b 之前这条要 skip 并打印原因**，不能静默绿）；
3. **反向**：代码里有、设定集里没有的键 ⇒ 红；
4. 状态标注校验：「计划中」的表里若出现代码已有的键 ⇒ 红（防止状态过期）。

Run: `npm test` → Expected: 全绿（V3b 落地后生效；V3b 之前第 2 条 skip 且**打印 skip 理由**）。

---

## Task 3: 关系重置入口（**先实测，再二选一**）

**Files:** 3a 时 Modify `src/server/entry.js`、`test/entry.test.mjs`；两种情况下都 Modify `README.md`

### Step 1: 实测顺序前提（Lead 亲跑；**这一步同时是 V1 Task12 Step2 的 B 步**）

1. 在 `apply(ctx)` 里加一行**只读**探针：
   ```js
   if (ctx.logger && ctx.logger.info) ctx.logger.info('[dsh-kylin-pet] commands service at apply: ' + String(!!(ctx.get && ctx.get('commands'))))
   ```
2. 按 V1 Task12 Step2 的可逆转流程装包 + 挂 bundle + 起引擎（**用户执行**）；
3. 看引擎日志那一行：`true` ⇒ 走 **3a**；`false` ⇒ 走 **3b**；
4. 探针行**无论走哪条都保留**（它是唯一能在真机上观测服务就绪时机的窗口，日志一行不吵）。

### Step 2a: 注册 `/pet`（仅当 Step 1 为 `true`）

```js
function registerPetCommand(ctx, bond) {
  const commands = ctx.get && ctx.get('commands')
  if (!commands || typeof commands.register !== 'function') return false
  commands.register({
    definitionId: 'dsh-kylin-pet/pet',        // branding 是编译期的；运行时字符串即可（**不加 @deepseek-ai 依赖**）
    name: 'pet',
    description: '麒麟仔与鲸鱼娘：查看关系状态 / 重置关系',
    input: { hint: '[status|reset]', attachments: false },
    handler: (invocation) => {
      const raw = String((invocation && invocation.rawInput) || '').trim()
      if (raw === 'reset') {
        bond.reset()
        return { text: '关系已重置：两只回到刚认识的样子。' }
      }
      const snap = bond.snapshot()
      const keys = Object.keys(snap.pairs || {})
      if (keys.length === 0) return { text: '还没有互动记录。' }
      const p = snap.pairs[keys[0]]
      return { text: keys[0] + ' 熟悉度 ' + p.familiarity + '，好感 ' + p.affinity + '（共 ' + (p.history || []).length + ' 次互动）' }
    },
  })
  return true
}
```

配套给 `bond.js` 加 `reset()`（清空 `pairs` 并落盘）—— 它必须走**同一个 flush 路径**，不许另写一份写文件逻辑。

### Step 2b: 文档化重置（仅当 Step 1 为 `false`）

不注册命令。`README.md` 增加一节，写明：

```markdown
## 关系重置

删掉（或改名）下面这个文件后重启引擎，两只就回到刚认识的样子：

    <dsh家目录>/dsh-kylin-pet/bond.json

它是纯数据文件，删了不会影响插件加载；下次互动会重新建。
```

### Step 3: 测试（仅 3a）

1. 注入一个假 `commands` 服务（记录 `register` 的调用）→ `apply` 后**恰好注册一次**，`name === 'pet'`；
2. `ctx.get('commands')` 缺席时 `apply` **不抛**、也不注册（降级不崩）；
3. `handler({ rawInput: 'status' })` 在空账本时回「还没有互动记录」；有记录时回**含 affinity 与 familiarity 数值**的文本；
4. `handler({ rawInput: 'reset' })` 后 `GET /bond` 回空账，且**磁盘文件也被清**（不只看内存）。

Run: `npm test` → Expected: 全绿（3a 时 +4；3b 时计数不变）。

---

## Task 4: 真机安装与终验（**用户执行，Lead 记录**）

**Files:** Modify `README.md`（勾 V4）、本文件（追加「终验记录」）

按 V1 Task12 Step2 的可逆转流程执行（备份 → `dsh plugin add` → 挂 `bundles[]` → 起引擎）。验收：
1. 引擎日志出现 `[dsh-kylin-pet] kylinzi + xisha @ /dsh-kylin-pet-7341`；
2. 页面出现两只宠；
3. `curl <端口>/dsh-kylin-pet-7341/health` 回 `{ok:true,...}`；
4. **Spec 事实 1 的那条唯一未证明环节**（真加载器 + 真插件激活层）**此时才算证完** —— 若 client 没跑起来，按 V1 Task12 Step2.4 的三步定位顺序排查；
5. 把上述四条的实际输出写进本文件末尾的「终验记录」。

---

## 自审

**Spec 覆盖**

| spec | 落在 |
|---|---|
| §10 的 V4 行（设置页 + 设定集 + 路线图） | Task 1（路线图）/ Task 3（**把「设置页」替换成命令或文档，理由见 §1**）/ 设定集已在 V4 计划期完成 |
| §13 裁决②「最小版」 | Task 3 的两条路都是最小版；**主路更省，降级路也不失能** |
| §11.1 clean-room（文档里不许有上游措辞） | Task 1/2 只动我们自己的文档；clean-room 门照跑 |
| §15.1 的 inject 事实 | Task 3 Step 1 用**只读探针**实测，不靠推断 |

**占位符扫描**：无 TODO / 后续补 / 类似前面。

**已知取舍**：
1. **把 spec §13 的「设置页」改成「命令或文档」** —— 这是**对已裁决事项的修改**，必须由用户确认（spec §15 已标「改到 V4 计划期由用户拍板」）。**在用户点头之前，Task 3 不执行。**
2. **Task 3 Step 1 与 V1 Task12 Step2 是同一步** —— 不为它单独再走一遍安装；两件事一次做完。
3. **`/pet` 的 `definitionId` 用普通字符串**，不 import `@deepseek-ai/dsh-commands/brand`（「零依赖」是硬承诺；branding 是编译期的）。若真机实测发现必须 brand，那就在 Step 1 一并记录并改用文档路 —— **不为一条命令破例引入依赖**。
4. **README 的 V3 行要拆成 V3/V3b** —— 本仓的切分与 spec 原表不同，README 反映**实际**切分，不为对齐文档而改代码。

**执行交接**：Task 1/2 可派子代理；**Task 3 Step 1 与 Task 4 必须 Lead + 用户**（涉及真机安装与重启会话）。


---

## Task 4 的**实测当前状态**（2026-10-11 由 Lead 查清，执行前必读）

真机安装前，web profile 的实际状态是：

```
$ ls -la ~/.coder/profiles/web/node_modules | grep kylin
dsh-kylin-pet -> ../../../../kk_Projects/dsh-kylin-pet/dsh-pet      ← **悬空软链**（目标目录不存在）

$ dsh.profile.bundles  (共 22 项)
含 "dsh-kylin-pet": **false**                                         ← 根本没被加载
```

**两条都要处理**：

1. **悬空软链**：它指向 `kk_Projects/dsh-kylin-pet/dsh-pet` —— 而重写后的仓库**根目录就是包根**，`dsh-pet/` 子目录已不存在（那是重写前的布局）。留着它，即使把名字挂进 `bundles[]` 也只会加载失败，而且报错会指向一个「看起来存在」的路径。
2. **`bundles[]` 里没有它**：所以当前引擎**完全没有加载这个插件** —— 「真加载器 + 真插件激活层」这条唯一未证明的环节，到现在仍然未被证明。

### 建议的执行步骤（用户执行；**会重启引擎，因此会杀掉 Lead 的会话**）

```bash
REPO=/Users/libing/kk_Projects/dsh-kylin-pet

# 0) 备份 profile 元数据（可逆）
cp ~/.coder/profiles/web/package.json ~/.coder/profiles/web/package.json.bak-$(date +%s)

# 1) 清掉悬空软链（它指向不存在的 dsh-pet/）
rm -f ~/.coder/profiles/web/node_modules/dsh-kylin-pet

# 2) 把仓库根装成依赖（file: 协议，指向仓库根而不是 dsh-pet/）
dsh plugin --profile web add file:$REPO

# 3) 把名字挂进 bundles[]（顺序无所谓；commands 在更早的基础层，所以 ctx.get('commands') 时它已就绪）
node -e "const f=process.env.HOME+'/.coder/profiles/web/package.json';const p=require(f);const b=p.dsh.profile.bundles;if(!b.includes('dsh-kylin-pet'))b.push('dsh-kylin-pet');require('fs').writeFileSync(f,JSON.stringify(p,null,2)+String.fromCharCode(10))"

# 4) 重启引擎（这一步会结束当前会话）
```

### 起来之后应当看到（验收句）

1. 引擎日志出现 `[dsh-kylin-pet] kylinzi + xisha @ /dsh-kylin-pet-7341`；
2. 页面出现两只宠；
3. `curl <端口>/dsh-kylin-pet-7341/health` 回 `{ok:true,...}`；
4. `/pet status` 能回话（**若回不了**，说明 `ctx.get('commands')` 在 `apply` 时还没就绪 —— 那就走 README 里的文件操作式重置，并在日志里找 `commands service at apply` 那一行报告给我）。

### 回滚

```bash
cp ~/.coder/profiles/web/package.json.bak-* ~/.coder/profiles/web/package.json
```
并删掉 `node_modules/dsh-kylin-pet`。


---

## 🎉 Task 4 的**验证部分已在隔离环境里做完**（2026-10-11 由 Lead 完成）

上面那节的结论是「必须由用户执行，因为要重启引擎」。**那个结论是错的** —— 有一条不需要碰用户 profile、也不需要重启的路：

```bash
# 探针 home 放在工作区内；profiles 根由 DSH_HOME 决定（dsh --help: "the profile under $DSH_HOME/profiles"）
mkdir -p .probe/profiles/web/node_modules
cp ~/.coder/profiles/web/{cordis.yml,cordis.patch.yml} .probe/profiles/web/
# node_modules：逐项软链到用户的（只读解析），再把我们的仓库根另链一个**真目录**
for e in ~/.coder/profiles/web/node_modules/*; do ln -s "$e" .probe/profiles/web/node_modules/$(basename "$e"); done
ln -s /Users/libing/kk_Projects/dsh-kylin-pet .probe/profiles/web/node_modules/dsh-kylin-pet
# package.json 副本：加依赖 + 往 bundles[] 里追加
# 然后：不启动，先看真加载器怎么组合
DSH_HOME=$PWD/.probe dsh --profile web --dump-config
# 再：随机端口 + 不开浏览器，真启动
DSH_HOME=$PWD/.probe dsh --profile web --no-open --port 0
```

### 四层验证结果

| # | 验的是什么 | 证据 |
|---|---|---|
| 1 | **真加载器解析我们的包** | `--dump-config` 退出码 0，树里有 `- id: dsh-kylin-pet / name: dsh-kylin-pet`，且上一行注释写明它来自**我们自己的** `cordis.patch.yml` |
| 2 | **`apply(ctx)` 在真 ctx 上跑了** | `/dsh-kylin-pet-7341/health` → `{"ok":true,"cast":["kylinzi","xisha"]}` |
| 3 | **配置与账本都活了** | `/config` 回真 cast（麒麟仔/鲸鱼娘）· `/state?since=0` → `{"cursor":0,"stimuli":[]}` · `/bond` → `{"version":1,"pairs":{}}`（账本建在**探针 home** 里，不是用户的） |
| 4 | **client 半边在真 UI 里挂载** | 引擎日志打印带令牌的 URL → Playwright 打开 → `{stage:true, actors:2, clips:["走路.webm","碎碎念.webm"], hitBox:[112,131]}` |

**第 4 条就是 V1 以来一直标着「唯一未证明环节」的那一条** —— 真 `__ModuleLoader__`、真插件激活层、真浏览器。截图见 `/tmp/real-ui.png`（真 UI 上两只宠在渲染）。

### 所以 Task 4 还剩什么

只剩**把插件装进用户自己的 profile 并重启**这一步 —— 而它的性质变了：

- 原判断：这是唯一能证明「真加载器 + 真激活层」的动作，**风险未知**；
- 实测之后：那两层**已经证明**，剩下的安装是**例行操作，没有未知**（悬空软链与 `bundles[]` 两件事已在上一节查清并写明）。

> **教训**：我原本写「必须由用户执行，因为它会杀掉会话」—— 这个判断**只对了一条路**。真正该问的是「有没有一条不需要重启的路」，而答案就写在 `dsh --help` 里（`--dump-config` + `--port 0` + `DSH_HOME`）。**「只有用户能做」这句话，应当先被当成一个待验证的假设。**


---

## Task 4 终验记录：**已装入用户的 web profile**（2026-10-11 17:00，用户指令后执行）

用户指令：`「你直接装到 ~/.coder 下，我验证通过后，删除就行了」` —— 因此安装由 Lead 执行，**重启留给用户**（重启会终止 Lead 的会话）。

### 装了什么

| 动作 | 值 |
|---|---|
| 备份 | `~/.coder/profiles/web/package.json.bak-kylin-20261011-170053`（另一份在仓库 `.install-backup/`） |
| 软链 | `node_modules/dsh-kylin-pet`：由**悬空**的 `…/dsh-kylin-pet/dsh-pet` 改为 `/Users/libing/kk_Projects/dsh-kylin-pet`（仓库根） |
| `dependencies` | 加 `"dsh-kylin-pet": "file:/Users/libing/kk_Projects/dsh-kylin-pet"` |
| `dsh.profile.bundles[]` | 追加 `"dsh-kylin-pet"`（原 22 项 → 23） |

### 未重启即已完成的验证

```
DSH_HOME=~/.coder dsh --profile web --dump-config     →  exit=0
1553: - id: dsh-kylin-pet
1554:   name: dsh-kylin-pet
1555: # == /Users/libing/.coder/profiles/web/cordis.patch.yml     ← 来自我们自己的 patch
stderr 里与 kylin 相关的报错：无
node_modules/dsh-kylin-pet/package.json 可读：是
```

⇒ **真加载器在用户 profile 上成功解析并挂载了本插件。**（`apply(ctx)` 真跑与 client 挂载，已在隔离探针里证过 —— 见上一节。）

### 用户重启后应当看到

1. 引擎日志出现 `[dsh-kylin-pet] kylinzi + xisha @ /dsh-kylin-pet-7341`；
2. 页面出现两只宠（若没有，看 `dsh-kylin-pet` 是否 pending —— 它唯一的硬依赖是 `webServer`）；
3. `curl <端口>/dsh-kylin-pet-7341/health` → `{"ok":true,"cast":["kylinzi","xisha"]}`；
4. `/pet status` 可回话（回不了 ⇒ `ctx.get('commands')` 在 apply 时未就绪，走 README 的文件操作式重置即可，两条路都已交付）。

### 回滚（回到「未安装」）

```bash
cp ~/.coder/profiles/web/package.json.bak-kylin-20261011-170053 ~/.coder/profiles/web/package.json
rm -f ~/.coder/profiles/web/node_modules/dsh-kylin-pet
# 然后重启引擎
```

> 用户已表明「验证通过后就删掉、之后从 GitHub/npm 装发布版」—— 上面这段就是那条路径。
