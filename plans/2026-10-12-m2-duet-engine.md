# M2 执行记录：双宠引擎（Duet）

日期：2026-10-11 · 分支：kylin/v0.3.6 · 状态：已验证，未提交

## 结论先行

上游 v0.3.6 已内建「PetMulti 多开容器 + pet pack 文件宠物 + 按宠定址的 say/anim 通道」，
M2 因此**没有造 PetActor/Duet 管理器**——双宠引擎缩窄为四件事，全部落地：

| # | 交付 | 位置 |
|---|---|---|
| T1 | 工作状态分工字段 workStatusKinds: ['ok'\|'fail']（缺省=全档，向后兼容） | shared/work-status.ts（terminalKind）、shared/types.ts、client/pet.ts（effect 门）、host/config.ts（读写白名单） |
| T2 | 拖近互怼（<120px、同对 5min 冷却、内置 4 组对白、POST /broadcast 双投喂、间隔 600ms） | client/duet.ts（planDuet 纯函数 + startDuet）+ pet.ts PetMulti effect + duet.test.ts（7 例） |
| T3 | 鲸鱼娘 pack 种子 + 安装器 | assets/pet/whale-config.jsonc + scripts/install-whale-pack.mjs（--force/--split/--remove/--home） |
| T4 | 分工配置落位 | 内置默认保持自洽（全开，注释文档化）；真机用户层 main-config.jsonc 经 --split 写入：麒麟仔 ['ok'] + balanceEnabled:false（余额归鲸鱼娘） |

## 设计判据（与 spec D2 对表）

- **余额分工**：零代码——上游已有 per-pet balanceEnabled（麒麟仔 false / 鲸鱼娘 true）。
- **工作状态分工**：新增可选字段而非第二套机制；terminalKind() 把终态归一 ok/fail，
  进行中档位（thinking/working/result/waiting）归对方、空闲收尾不受限。
- **互怼通道**：复用 /broadcast?pet=<id>（写 S 的 pets.<id>.say）——前端零新增渲染面。
- **鲸鱼娘素材（B 案）**：pack 不建 pet/whale-animation/ 独占目录 → /thumb/whale/...
  自动回落主素材链（共用上游蓝鲸池）；自制素材就绪后建独占目录即整条换装，配置零改动。

## 安装与验证（真机 ~/.kcoder）

    node scripts/install-whale-pack.mjs --home /Users/libing/.kcoder --split

- 真宿主 readAllConfig 直读真实 home：main（麒麟仔，ok/无余额）+ whale（鲸鱼娘，fail/有余额，
  bottom-left）两实例字段全对 ✅
- typecheck 双 pass（tsc --noEmit + tsconfig.test）exit 0 ✅
- 测试 **559/560**（新增 duet 7 例全绿；唯一红 = helper-process「Electron 落地路径」，
  M1 基线同族环境红——本机无 $DSH_HOME/electron 落地，与代码无关）✅
- 产物 grep：duet/workStatusKinds/terminalKind 在 lib/client.js 与 lib/index.js 在场；旧前缀/旧名 0 ✅

## 过程抓出的一个自己的坑（已修，测试钉住）

首版 mergePet 用 petBool(p.duetEnabled, base.duetEnabled, ...) —— petBool 缺省返回
Boolean(undefined)=false，把「缺省=参与」**写反**，且物化出的键让 config.test 的
「同步后成品 = 无用户层」deepStrictEqual 等价断言变红（无用户层走快路径不物化键，两侧不对称）。
修法：可选字段没写/非法一律**不产出键**（条件展开），语义与等价性同时归位（92/92）。

## 生效方式与边界

- **无需重启引擎**：config 每请求现读、client.js 刷新页面即换新——**刷新浏览器**即可见双宠。
- 桌面透明窗面（electron-helper）的分工/互怼**不在本轮**（display:web 下无影响），挂 M3。
- 互怼台词/半径/冷却为 duet.ts 常量，未做配置面（YAGNI，登记 M3 可选）。
- 设置页「保存」以 {...p} 展开携带新字段，PUT 白名单已放行——分工不会被保存洗掉。
  ⛔ **此判断被真机推翻，见 §M2.1**：表单 pets 不含 kinds，整包重建时缺席键即丢。

# M2.1 真机反馈收口（2026-10-11 下午）：形象区分 + 去同步 + 字段保全

用户真机反馈两问题：①两只形象都是鲸鱼娘；②两宠总是同步动作。勘察结论与处置：

## 反馈①的根因有两层

1. **分工被设置页「保存」抹掉（真 bug）**：--split 写入的 main.workStatusKinds=['ok'] 在
   12:35 设置页保存时消失（保存前 size=280→420 也证明走过设置页）。上文「不会被保存洗掉」
   判断错误——表单 pets 不含 kinds/duetEnabled，PUT 白名单重建把缺席键丢弃 → 麒麟仔回到
   全档响应 → 失败档两宠一起醒 = 「同步」的主因。
   **根修**：saveUserConfig 增加**宠物级字段认领**（从磁盘现有文件按 id 认领 incoming 缺席的
   workStatusKinds/duetEnabled，显式传了以 incoming 为准，认领值过同款合法性检查）；
   包内默认 config 的 main 再写一份 ['ok'] 作第二道保险（读取侧 undefined 不覆盖）。
2. **形象相同是占位设计**（whale pack 无独占目录 → 回落主蓝鲸池）。本轮完成换装（下）。

## 反馈②的另一半：空闲链同拍

两宠挂载即播同一段 idle（once=true）→ 同刻 ended → 同帧进随机链，动画时长同池 → 长期同步。
修：初始 once=false（loop 待机，循环相位差不可见）+ 挂载 effect 随机 0–2.5s 后才掷第一骰。
另加**串门**：随机链 move 档抽中时 45% 概率走向同伴（tryMove 增加 toward 参数——方向指向
对方中心、定距停在 80×scale 外，minDist=maxDist 让 planMove 退化为定距，motion.ts 纯函数
零改动），到位即落入 startDuet 的 120px 半径 → 互怼对白自动接上；90s 串门冷却防连访。

## 形象换装（占位 → 定妆照管线）

- 布局：麒麟仔 = `$DSH_HOME/dsh-kylin-pet/pet/main-animation/`（19 文件 564KB），
  鲸鱼娘 = `pet/whale-animation/`（19 文件 473KB）——独占规则：目录存在即只查自己、404 不回落。
- 生成：**scripts/gen-poses-direct.mjs**（直连 /v1/responses 双形态通吃：base64 落盘 / 文本藏
  Firefly S3 URL 下载；参考图本地路径须转 data URL——file:// 被网关 400）。每宠 8 姿势
  （idle 睁/闭眼、walk 左/右脚、happy、sad、drag、turn 背面），参考图=两张定妆照锁形象。
  装在 profile 的 dsh-kylin-images 还是旧解析：本轮再产 5 个孤儿且 **GET /v1/responses/{id}
  404 不可抢救**——已计费。v0.1.1 修复需重启 dsh 才生效（模块启动时加载）。
- 组装：**scripts/make-poses.mjs**（上游视频管线的静帧版）——HSV 色相抠像（绿相 70–170、
  饱和/明度下限、6° 羽化，蓝白角色零误伤）→ alphaextract,bbox → 裁剪缩放 → **pad 直拼**
  640×360（脚底 y=330 水平居中；踩坑：`[1]overlay` 会把唯一指定的 [1] 当主输入、色底被
  auto-connect 成第二输入 → 产物=裁剪尺寸 → concat 尺寸不匹配炸 libvpx -22）→ 双帧循环
  （待机 1.2s/帧 4.8s、走路 0.36s/帧 2.88s）与静帧 2.5s，libvpx-vp9 yuva420p CRF40。
- 事件档名别名拷贝（workStatus 六档/余额六档/碎碎念/开心跳跃 → 六姿势对应），19 文件/宠。
- 机检：check-assets 19/19×2 ✅；reconcile-anim-names.mjs 名称对账 0 缺 0 多 ✅；
  视觉实证 staging/m2/duet-alpha-proof.png（暗底双宠合成，零绿残留）✅。
- 局限如实登记：静帧+两帧循环非骨骼动画；turn 档=背面帧由 scaleX 翻转呈现；本轮成本
  16+5 张 gpt-image-2-4k。

## 代码面（本轮 10 处编辑，未提交）

| 文件 | 内容 |
|---|---|
| src/host/config.ts | saveUserConfig 宠物级认领（workStatusKinds/duetEnabled） |
| src/client/pet.ts | 初始 once=false + 首掷随机延迟 + tryMove toward + 串门分支/冷却 |
| assets/config.jsonc | main.workStatusKinds=['ok']（包内默认层保险）+ 注释纠偏（pet/main-animation 换装路径） |
| scripts/gen-poses-direct.mjs / make-poses.mjs / reconcile-anim-names.mjs | 素材管线三件套（常备） |

验证：typecheck ✅、测试 **559/560**（唯一红 = M1 已登记 helper-process 环境红，零新增）、
build ✅（client.js 296 处新前缀）、用户层配置已写（kinds + 精简动作集 animationWeights
{idle:30,turn:10,move:25}——精简集整段覆盖全局 animations，设置页保存不含该段不会被洗）。
**生效方式更正：本轮动了 src → 需重启引擎**（去同步/串门/字段保全才加载）+ 刷新页面（新素材
与配置每请求现读）。


## §八 气泡形象串门修复（真机验收反馈 ②）

**现象**：麒麟仔的演出气泡配图是鲸鱼娘形象（截图：大烧货梗图，图内自带「已思考13秒」字样）。

**根因**：气泡配图走表情包池（readMemePool），目录链 = `pet/<素材根>-memes/`（种类独占，存在即只认它）→ 用户 memes/ → 包内 assets/memes/。麒麟仔（main）没有独占目录 → 与鲸鱼娘共用包内上游默认池（27 张全是鲸鱼娘）→ 抽中鲸图。

**修法**（零引擎代码改动，全在资产与配置层）：
1. 从 kylinzi-expressions 差分表 3×3 逐格裁切 **9 张麒麟仔专属梗图**（在呢/稳了/快夸我/真的假的/我错了/有计了/气鼓鼓/没电了/让我想想），384×384，正本 `assets/pet/main-memes/`，装机脚本 `scripts/install-memes.mjs`；
2. 活目录 `$DSH_HOME/dsh-kylin-pet/pet/main-memes/`（独占生效）；
3. 包配置 memes 映射追加 9 条描述（36 条 = 鲸 27 + 麟 9），池按「磁盘存在」过滤出每宠自己的子集。

**验证**（活引擎 HTTP 全量断言）：main 链 9 张全 200；main/大烧货 404（修法生效）；whale/大烧货 200、whale/在呢 404（鲸鱼娘不受影响、反向不串）。无需重启引擎（池按请求现读）。

**过程排雷（登记）**：本会话 run_code 环境会剥离环境变量（HOME/DSH_HOME 均空）——首装把图建到了字面量 `undefined/.kcoder/...` 相对路径下。此后会话内一律用字面量绝对路径 /Users/libing/...，脚本一律 os.homedir() 兜底。另：v0.3.6 无 `/config.jsonc` 路由（M1 验收清单笔误，实际只 /config 与 /state）。


## 追加（14:2x）·「只见一只」第二层根因：/config 响应无缓存头

活体取证（本机引擎 49253）：GET /config 200 且正文含 main+whale，但响应头**无 cache-control/etag/last-modified**（/state 有 no-cache,no-store，/config 没有）——浏览器侧任何一层缓存住旧宠物清单，都会造成「文件级/服务端全对、页面永远旧世界」。Playwright 无法进鉴权页面，故采取双保险修复 + 开机自证：

| 修复 | 位置 |
|---|---|
| /config GET 补 `cache-control: no-store` | host/index.ts:783-785 |
| 客户端全部配置/模型拉取改 `cache:'no-store'` + `?t=Date.now()` 穿透 | pet.ts:1566 · notify.ts:129 · settings.ts:922/964/1004 |
| **开机自证日志**：拍平后打印 `[dsh-kylin-pet] pets loaded: main,whale (n=2)` | pet.ts:1562——下一轮排查零猜测 |

验证：node scripts/prepare.js ✅ · tsc 0 ✅ · 包内 vitest 10/10 ✅ · lib 三件 14:23 重建（client.js 含 pets loaded×1 / no-store×6）。
注：本会话终端环境变量剥离导致 `pnpm` 二进制解析损坏（Mach-O 被当 JS），构建改走 node scripts/prepare.js + 本地 .bin。

