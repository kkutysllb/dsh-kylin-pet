/**
 * dsh-kylin-pet — client 半（单文件，宿主契约强制）。
 * §1 契约  §2 小工具  §3 演员  §4 世界  §5 手势  §6 挂载与主循环
 * 挂进宿主槽位 `shell.overlay`（`Slots.listSubTree`: kind=list, purpose="Frame-wide floating layer"）。
 * **不直挂 document.body** —— 官方 ui-plugin 契约明写「Do not replace the app root or append a
 * second application to document.body」；挂在 body 上的树没有主人，插件被禁用时没人摘它。
 * （V5b 踩过这个坑：开关关掉、桌宠不消失。）
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
    // 点击反应池镜像（host 契约 CLICKS）：独立于 happy 档 —— 那档混着余额播报段。
    const CLICKS = Object.freeze(['点击开心', '开心跳跃', '庆祝成功'])
    const KINDS = Object.freeze(['turn-ok', 'turn-fail', 'waiting', 'working', 'working-done'])
    // 镜像 `contract.BUSY_CLIP`。**它必须在 SHARED_KEYS 里** —— 我第一次改 client 时
    // 在 idleChain 里用了它却忘了镜像，测试全绿（因为没有一条测试走过忙碌分支），
    // 一进真实任务就是 ReferenceError。手工核对不是门，键表才是。
    const BUSY_CLIP = '状态忙碌'
    /** 账本边界（spec §4.5）。夹取与环形上限都从这里取，别在实现里写魔数。 */
    const BOND = Object.freeze({
      AFFINITY_MIN: -100,
      AFFINITY_MAX: 100,
      HISTORY_MAX: 50,
      PAIR_SEP: '|',
    })
    /** 档位阈值，降序。判定 = 第一个满足 值 >= 阈值 的档；解析不出数字则 tier=null（不猜）。 */
    const BALANCE_TIERS = Object.freeze([
      ['充裕', 100], ['健康', 50], ['正常', 20], ['偏低', 5], ['告急', 1], ['见底', 0],
    ])
    /** 意图族 → 候选。独处 4 个 + 社交 9 个 = 13 个候选（spec §5）。 */
    const INTENTS = Object.freeze({
      solo: ['idle', 'walk', 'nap', 'look'],
      social: ['approach', 'greet', 'gift', 'tease', 'comfort', 'shoulder', 'chase', 'reconcile', 'contest'],
    })
    /** 权重与门限。所有魔数只能出现在这里。 */
    const TUNING = Object.freeze({
      TICK_SEC: 1,                 // 与 /state 轮询对齐（spec §5：每拍约 1s）
      SOCIAL_RADIUS: 360,          // px：超出这个距离的社交候选改判为 approach 或淘汰
      NEAR_RADIUS: 300,            // px：算「已经在旁边」。
      // **必须大于 separate() 强制的最小间距**（两只 280 宽的宠 → (280+280)*0.28 = 156.8）。
      // 原来的 150 比它还小 ⇒ near / veryNear 都是**恒假式** ⇒ approach 阶段永远不结束
      // ⇒ 6s 撞超时 abort ⇒ abort 不上冷却 ⇒ 立刻重开同一场，无限循环。
      // 2026-10-11 由 Task 6 真机取证发现（单测发现不了：两个常量分属两个子系统）。
      DRAG_THRESHOLD: 5,           // px：按下后位移 ≥ 此值才算拖拽，小于它松开 = 点击。host 契约同名字段，漂移门对齐。
      ENERGY_DRAIN: 0.012,         // 每拍衰减
      ENERGY_RECOVER: 0.02,        // 每拍恢复（sleep 时）
      MOOD_REGRESS: 0.01,          // 每拍向 0 回归（spec §4.5：缓慢回归）
      COOLDOWN_SEC: {              // 每个剧本的冷却（**同一对**之间）
        greet: 45, gift: 120, tease: 90, comfort: 150,
        shoulder: 180, chase: 90, reconcile: 300, contest: 120,
      },
      WEIGHT: {
        affinity: 0.02,            // 每点 affinity 对社交候选的加成
        familiarity: 0.01,         // 每点 familiarity 的加成
        moodMatch: 0.6,            // 候选与 mood 的匹配度
        energy: 0.8,               // 精力对独处候选的影响
        distance: 0.4,             // 距离惩罚
        jitter: 0.15,              // 抖动，防止两只永远同拍
      },
      UNLOCK: {                    // spec §7 的解锁条件
        gift: { familiarity: 3 },
        tease: { familiarity: 5 },
        shoulder: { affinity: 20 },
        reconcile: { affinityMax: -1 },
      },
      EFFECT: {                    // spec §7 的关系效果
        greet: { affinity: 2, familiarity: 1 },
        gift: { affinity: 3, familiarity: 1 },
        giftIgnored: { affinity: -1, familiarity: 0 },
        tease: { affinity: -3, familiarity: 1 },
        comfort: { affinity: 5, familiarity: 1 },
        shoulder: { affinity: 3, familiarity: 1 },
        chase: { affinity: 2, familiarity: 1 },
        reconcile: { affinity: 8, familiarity: 2 },
        contest: { affinity: 2, familiarity: 1 },
      },
      PHASE_TIMEOUT_SEC: { approach: 6, open: 2, exchange: 6, settle: 2 },
      MEMORY_MAX: 8,
    })
    const BOND_FLUSH_MS = 2000      // §4.5：客户端防抖 2s；host 是唯一写者，这里只排队
    const BALANCE_POLL_MS = 30000   // 余额变化慢、还要打外部网络：与 1s 的 /state 分开，频率低一点更礼貌
    /** 诱因气泡文案（原创）。**STIMULUS 后缀由 V3b Task 4 加的**：LINES 这个名字让给了 §3.9 的剧本台词表。 */
    const LINES_STIMULUS = Object.freeze({
      'turn-ok': '稳了', 'turn-fail': '让我想想', waiting: '在呢',
      'working-done': '干完了',
    })
    /**
     * 执行期主讲**按工具类别**说话（用户定的口径：只说类别，不说工具名与内容）。
     * 未收录的类别一律 `other`（「在忙着」）—— 与 `classifyTool` 的落点一致，不猜。
     */
    const LINES_WORKING = Object.freeze({
      read: '在翻文件', write: '在改代码', exec: '在跑命令',
      web: '在查资料', agent: '在派活', other: '在忙着',
    })
    /** 收工时**另一只**的应和。只在收工这一下，不在「在忙」期间 —— 那会变成两条气泡互相刷。 */
    const ECHO_DONE = '嗯'
    const ANIM_EXT = '.webm'
    const STAGE_ID = 'dsh-kylin-pet-stage'
    const SLOT_NAME = 'shell.overlay'   // 宿主槽位名（Slots.listSubTree 里的 Frame-wide floating layer）
    const DROP_DISTANCE = 120   // spec §8：拖到一起放下即触发一次近距离互动

    exports.inject = ['slots']

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

    /** 诱因 -> 档位。waiting 是「双方探头」，不查表。 */
    const STATUS_OF = { 'turn-ok': 'ok', 'turn-fail': 'fail' }

    /**
     * 诱因 -> 有资格的宠 id（纯函数、无 DOM）。
     * 刻意放工厂作用域而非 createWorld 内：挂上 __kylinContract 才能被跨 realm 单测钉住。
     */
    function qualified(kind, config) {
      const cast = (config && config.cast) || []
      if (kind === 'waiting') return cast.map((p) => p.id)
      const map = (config && config.directing && config.directing.workStatus) || {}
      // V5 执行期：主讲 = 工作状态挂在「成功/进展」那条线上的那只（人设上就是更主动的那只）。
      // **复用 workStatus 而不新加配置键** —— 它表达的本就是「这只负责进展这条线」；
      // 新加一个键意味着用户还要再配一次，而配错的表现是「两只都不说话」。
      if (kind === 'working' || kind === 'working-done') {
        const ok = cast.filter((p) => (map[p.id] || []).indexOf('ok') >= 0).map((p) => p.id)
        return ok.length ? ok : cast.map((p) => p.id)   // 没分工（单宠/未配置）就都算主讲
      }
      const want = STATUS_OF[kind]
      return cast.filter((p) => (map[p.id] || []).indexOf(want) >= 0).map((p) => p.id)
    }

    /* ==================== §2.5 账本与余额（契约镜像 + 纯函数 + 实时状态） ==================== */
    // 全部放工厂作用域：__kylinContract 在**装载期**就冻结了，只有那里的引用才活到运行期。
    const numOf = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

    /** 同一对宠永远同一个键：排序后拼接（与 host 的 bond.js 逐字同语义）。 */
    function pairId(a, b) {
      return [String(a), String(b)].sort().join(BOND.PAIR_SEP)
    }

    /** 把任意输入整形为合法的一对记录。永不抛 —— 坏数据只该降级，不该让舞台起不来。 */
    function normalizeBondPair(raw) {
      const src = raw && typeof raw === 'object' ? raw : {}
      const history = Array.isArray(src.history) ? src.history.slice(-BOND.HISTORY_MAX) : []
      return {
        affinity: clamp(numOf(src.affinity, 0), BOND.AFFINITY_MIN, BOND.AFFINITY_MAX),
        familiarity: Math.max(0, numOf(src.familiarity, 0)),
        lastAt: Math.max(0, numOf(src.lastAt, 0)),
        history: history,
      }
    }

    /**
     * 本地施加一批事件 —— **必须与 host 的 bond.js 同语义**：affinity 夹 [-100,100]、
     * familiarity 只增（负增量丢弃）、history 环形 50。允许重复、禁止漂移。
     */
    function applyBondEvents(pair, events) {
      let out = normalizeBondPair(pair)
      const list = Array.isArray(events) ? events : []
      for (const ev of list) {
        const dA = numOf(ev && ev.affinityDelta, 0)
        const dF = numOf(ev && ev.familiarityDelta, 0)
        const at = numOf(ev && ev.at, Date.now())
        out = {
          affinity: clamp(out.affinity + dA, BOND.AFFINITY_MIN, BOND.AFFINITY_MAX),
          familiarity: Math.max(0, out.familiarity + Math.max(0, dF)),   // 只增：负增量被丢弃
          lastAt: Math.max(out.lastAt, at),
          history: out.history.concat([{
            kind: String((ev && ev.kind) || 'unknown'),
            at: at,
            affinityDelta: dA,
            familiarityDelta: dF,
          }]).slice(-BOND.HISTORY_MAX),
        }
      }
      return out
    }

    /** 档位判定（与 host 的 ledger.js 同语义）：解析不出有限数就 null —— 不猜。 */
    function tierOf(total) {
      if (total === null || total === undefined) return null
      if (typeof total === 'string' && total.trim() === '') return null
      const n = typeof total === 'string' ? Number(total.trim()) : Number(total)
      if (!Number.isFinite(n)) return null
      for (const entry of BALANCE_TIERS) if (n >= entry[1]) return entry[0]
      return BALANCE_TIERS[BALANCE_TIERS.length - 1][0]
    }

    /** 档位名 -> [表现档, 素材名]；CLIPS 里没有这一段就 null（不猜、不乱播）。 */
    function tierClip(tier) {
      const name = '余额' + String(tier)
      if (CLIPS.happy.indexOf(name) >= 0) return ['happy', name]
      if (CLIPS.sad.indexOf(name) >= 0) return ['sad', name]
      return null
    }

    /**
     * 余额播报判定（纯函数）—— 「绝不伪造数字」的落地点：
     * 只有 kind==='ok' 且档位与上次**不同**才回档位名；tier===null 或 kind==='unavailable' 一律 null。
     */
    function balanceCue(entry, prevTier) {
      if (!entry || entry.kind !== 'ok') return null
      const tier = typeof entry.tier === 'string' && entry.tier !== '' ? entry.tier : null
      if (tier === null || tier === prevTier) return null
      return tier
    }

    /** affinity 越高越容易「好奇凑过来」（取代 V1 写死的 50%）；affinity=0 时仍是 0.5，旧观感不变。 */
    function curiosityOf(affinity) {
      return clamp(0.5 + clamp(numOf(affinity, 0), BOND.AFFINITY_MIN, BOND.AFFINITY_MAX) / 200, 0.25, 0.9)
    }

    /* ---------- 实时状态（契约里的 readBond 读的就是这里的当前值） ---------- */
    let bondState = { pairKey: '', affinity: 0, familiarity: 0, lastAt: 0, history: [] }
    let bondQueue = []   // 待发 delta：PUT 失败**不清空** —— 丢了就是关系丢了
    let bondTimer = null
    let lastTier = null  // 上次播报过的档位（只在变化时播）

    /** 账本实时快照（不是加载时的副本）—— 验收靠它证「客户端确实读到了」。 */
    function readBond() {
      return { pairKey: bondState.pairKey, affinity: bondState.affinity, familiarity: bondState.familiarity }
    }

    /**
     * 取某只宠的关系快照。
     * ⚠️ 计划 Task 5 Step 1 直接调用 `bondFor(a.pet.id)` / `bondFor('*')`，但**全仓没有这个名字**
     * （2026-10-11 预检：src/ 与 test/ 对 bondFor 零命中）。按计划注释「V3 读回的账本快照；
     * 读不到就是 {affinity:0, familiarity:0}」最小补上：只读 bondState，任何坏值降级成 0/0，永不抛。
     * 当前是单对舞台（pairKey 由 cast[0]/cast[1] 定死），两只宠共用同一对账本，故 petId 暂不参与取值。
     */
    function bondFor(petId) {
      return { affinity: numOf(bondState.affinity, 0), familiarity: numOf(bondState.familiarity, 0) }
    }

    /** 启动读一次账本；任何失败（宿主不在 / 404 / 坏 JSON）都回 null，由 normalizeBondPair 降级成 0/0。 */
    async function loadBondPair(pairKey) {
      try {
        const res = await fetch(ROUTE_PREFIX + '/bond', { cache: 'no-store' })
        if (!res.ok) return null
        const body = await res.json()
        return body && body.pairs ? body.pairs[pairKey] : null
      } catch (err) {
        return null
      }
    }

    /**
     * 本地先记（affinity 立刻影响行为），再 2s 防抖提交。host 是账本唯一写者，这里只排队。
     * @param {{pair?: string, kind?: string, affinityDelta?: number, familiarityDelta?: number, at?: number}} ev
     */
    function queueBondEvent(ev) {
      const pair = String((ev && ev.pair) || bondState.pairKey || '')
      if (!pair) return null
      const full = {
        pair: pair,
        kind: String((ev && ev.kind) || 'unknown'),
        affinityDelta: numOf(ev && ev.affinityDelta, 0),
        familiarityDelta: numOf(ev && ev.familiarityDelta, 0),
        at: numOf(ev && ev.at, Date.now()),
      }
      bondState = Object.assign({ pairKey: pair }, applyBondEvents(bondState, [full]))
      bondQueue.push(full)
      if (bondTimer === null) bondTimer = setTimeout(flushBondQueue, BOND_FLUSH_MS)
      return full
    }

    /** 到点把这批 delta 交给 host；**成功才清队列**，失败保留并等下一个窗口重试。 */
    async function flushBondQueue() {
      bondTimer = null
      if (bondQueue.length === 0) return
      const events = bondQueue.slice()
      try {
        const res = await fetch(ROUTE_PREFIX + '/bond', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ events: events }),
          cache: 'no-store',
        })
        if (!res || !res.ok) throw new Error('HTTP ' + String(res && res.status))
        let body = null
        try { body = await res.json() } catch (err) { body = null }   // 回账可选：读不到就信本地
        bondQueue.splice(0, events.length)
        const saved = body && body.pairs ? body.pairs[bondState.pairKey] : null
        if (saved) bondState = Object.assign({ pairKey: bondState.pairKey }, normalizeBondPair(saved))
      } catch (err) {
        // PUT 失败：保留待发队列，下一个 2s 窗口重试。丢了就是关系丢了。
        if (bondTimer === null) bondTimer = setTimeout(flushBondQueue, BOND_FLUSH_MS)
      }
    }

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

      // 气泡：角色上方的对白层，永远不吃事件（命中区才是唯一入口）
      const bubble = document.createElement('div')
      bubble.style.position = 'absolute'
      bubble.style.left = '50%'
      bubble.style.top = '-4%'
      bubble.style.transform = 'translate(-50%,-100%)'
      bubble.style.padding = '3px 9px'
      bubble.style.borderRadius = '11px'
      bubble.style.background = 'rgba(18,22,30,0.88)'
      bubble.style.color = '#eaf1fa'
      bubble.style.font = '500 13px/1.4 system-ui, sans-serif'
      bubble.style.whiteSpace = 'nowrap'
      bubble.style.pointerEvents = 'none'
      bubble.style.opacity = '0'
      bubble.style.transition = 'opacity 160ms ease'

      el.appendChild(vids[0])
      el.appendChild(vids[1])
      el.appendChild(hit)
      el.appendChild(bubble)

      const a = {
        pet: pet, el: el, hit: hit, box: { w: w, h: h },
        x: 0, y: 0,                 // 脚点（px）
        lx: NaN, ly: NaN,           // 上一次写进 transform 的值（NaN ⇒ 首帧必写）
        facing: 1,
        clip: null,
        clipName: null,             // 当前实际素材名（余额档位要播指定那一段，不能随机）
        held: false,
        front: 0,
        gen: 0,                      // 切换代次：作废过期的 loadeddata 回调（见 a.play ③）
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

      /**
       * 播表现档；给了 exact 就播**那一段**素材（余额档位必须精确到「余额充裕」这类名字）。
       *
       * ⚠️ **这段的时序是对着参考实现逐条抄的**（参考笔记 pet.ts 的 switchTo），
       * 五条防线缺一条就会重现「屏幕闪烁 + 人物闪烁」：
       *   ① 写**后台**缓冲 —— 前台还在播，用户任何一帧看到的都是完整画面；
       *   ② 等 §loadeddata§（readyState ≥ 2）才翻 opacity。**不能等 play() 的 promise** ——
       *      它 resolve 的时点早于首帧绘制（于是切到一片空白），且不保证与请求同序；
       *   ③ **代次检查**：切换途中又来了新请求就放弃本次。没有它，旧切换的 promise 后到时
       *      会把 front 翻回去 ⇒ 在 A/B 之间来回翻 ⇒ 两只一起闪；
       *   ④ 降级的视频 pause()（ended 监听另按「只认前台」过滤，等价于参考实现的清 handler）；
       *   ⑤ readyState ≥ 2 直接切 —— 已缓存的素材不该卡在事件上。
       */
      a.play = (clip, exact) => {
        if (!exact && a.clip === clip) return
        const chosen = exact || pick(CLIPS[clip], a.rng)
        if (a.clip === clip && a.clipName === chosen) return
        a.clip = clip
        a.clipName = chosen
        const back = vids[1 - a.front]
        const gen = ++a.gen
        back.loop = LOOPING.indexOf(clip) >= 0
        back.src = animUrl(pet, chosen)
        back.muted = true
        back.playsInline = true
        back.load()
        const onReady = () => {
          back.removeEventListener('loadeddata', onReady)
          if (a.gen !== gen) return          // ③ 过期的切换：一个字都不许改
          const old = vids[a.front]
          back.style.opacity = '1'
          old.style.opacity = '0'
          old.pause()
          a.front = 1 - a.front
          back.play().catch(() => { /* 自动播放被拦：画面已就位，不打断舞台 */ })
        }
        back.addEventListener('loadeddata', onReady)
        if (back.readyState >= 2) onReady()   // ⑤
      }

      /** 冒一句对白；ms 到点自动淡出。空文案当「不说」——别把气泡点亮成空气泡。 */
      a.say = (text, ms) => {
        if (!text) return
        bubble.textContent = text
        bubble.style.opacity = '1'
        if (a.sayTimer) clearTimeout(a.sayTimer)
        a.sayTimer = setTimeout(() => { bubble.style.opacity = '0' }, ms || 2200)
      }

      for (const v of vids) {
        v.addEventListener('ended', () => {
          if (v !== vids[a.front]) return
          if (LOOPING.indexOf(a.clip) >= 0) return
          if (a.onEnded) a.onEnded()
        })
      }

      /**
       * 把脚点写进 transform。
       *
       * ⚠️ **只在真的动了才写**。原来是每帧无条件写一次 —— 而 `layout()` 被 `step()` 每帧
       * 对每只宠调用，两只就是 **120 次/秒的样式写入 + 合成层失效**。桌宠大部分时间静止，
       * 这些写入全是噪声；在每 token 都重渲染的宿主页面里，它表现为可见的抖动/闪烁。
       * 位移本身由世界推进，位置没变就没有任何理由碰 style。
       */
      a.layout = () => {
        const left = a.x - w / 2
        const top = a.y - h * ASSET.FOOT_RATIO
        if (left === a.lx && top === a.ly) return
        a.lx = left
        a.ly = top
        el.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)'
      }
      a.destroy = () => el.remove()
      return a
    }

    /* ==================== §3.5 心智 Mind（纯逻辑、无 DOM；供导演决策） ==================== */
    /** 每只宠的心智状态。mood/energy 是连续量，recent 是环形记忆。 */
    function createMind(petId) {
      return {
        petId: petId,
        mood: 0,            // [-1, 1]
        energy: 1,          // [0, 1]
        attention: 'free',  // free | drawn | focused
        // V5：任务执行期标记。**刻意放心里智而不是 actor** —— actor 上的 `busy` 已经被
        // 合演系统占用了（`separate()` / `freePartner` / `socialGate` 都在读它），
        // 复用它会让「任务在忙」把两只宠的合演资格也锁掉。
        working: false,
        // 默认中性关系（V3b Task 5 硬要求）：unlocked/socialGate 直接读 bond.familiarity / bond.affinity，
        // 补上它「心智永远有 bond」才是类型级的不变式 —— 先建心智、后读账本（读失败）时也只走 0/0。
        bond: { affinity: 0, familiarity: 0 },
        recent: [],         // 最近 MEMORY_MAX 次互动（导演写，心智读）
        cooldown: {},       // 剧本名 -> 剩余秒
      }
    }

    /** 每拍推进：精力衰减 / 恢复、心情向 0 回归、冷却递减。**纯状态推进，不做决策**。 */
    function stepMind(mind, dt) {
      const T = TUNING
      const asleep = mind.energy <= 0.15
      mind.energy = clamp(mind.energy + (asleep ? T.ENERGY_RECOVER : -T.ENERGY_DRAIN) * dt, 0, 1)
      mind.mood = clamp(mind.mood - Math.sign(mind.mood) * Math.min(Math.abs(mind.mood), T.MOOD_REGRESS * dt), -1, 1)
      for (const k of Object.keys(mind.cooldown)) {
        mind.cooldown[k] = Math.max(0, mind.cooldown[k] - dt)
        if (mind.cooldown[k] === 0) delete mind.cooldown[k]
      }
      return mind
    }

    /** 解锁判定（spec §7 的「解锁条件」列）。缺条件即恒可用。 */
    function unlocked(candidate, bond) {
      const need = TUNING.UNLOCK[candidate]
      if (!need) return true
      if (need.familiarity !== undefined && bond.familiarity < need.familiarity) return false
      if (need.affinity !== undefined && bond.affinity < need.affinity) return false
      if (need.affinityMax !== undefined && bond.affinity > need.affinityMax) return false
      return true
    }

    /**
     * 门控（spec §5：**门控优先、再加权**）。返回淘汰原因，或 null 表示放行。
     * 顺序刻意：冷却 → 解锁 → 对方可响应性 → 距离。
     */
    function socialGate(candidate, self, other, dist) {
      if (self.cooldown[candidate]) return 'cooldown'
      if (!unlocked(candidate, self.bond)) return 'locked'
      if (!other) return 'no-partner'
      if (other.held) return 'partner-held'
      if (other.busy) return 'partner-busy'          // 正在合演
      // V5：任务执行期间**不开新合演**。理由是实测出来的 —— 取证发现两只在采样窗口里
      // 有 16/18 拍在演剧本，「在忙」的档位被挤到几乎不可见 ⇒ 用户要的「动作反应」看不见。
      // 让正在进行的合演自然演完，但不新开：工作期间它们该看起来在干活。
      if (self.working) return 'working'
      if (other.working) return 'partner-working'
      if (dist > TUNING.SOCIAL_RADIUS) return candidate === 'approach' ? null : 'too-far'
      if (candidate === 'comfort' && !(other.mood < -0.3)) return 'no-need'   // spec §7：对方 mood < -0.3
      if (candidate === 'reconcile' && !(self.bond.affinity < 0)) return 'locked'
      return null
    }

    /** 独处候选的打分：energy 低 → nap，mood 高 → walk。 */
    function soloScore(candidate, self) {
      const W = TUNING.WEIGHT
      if (candidate === 'nap') return (1 - self.energy) * W.energy
      if (candidate === 'walk') return Math.max(0, self.mood) * W.moodMatch
      if (candidate === 'look') return (1 - Math.abs(self.mood)) * 0.3
      return 0.4 - Math.abs(self.mood) * 0.1          // idle 兜底
    }

    /** 社交候选的打分。affinity 越高越愿意社交，距离越远越不愿意。 */
    function socialScore(candidate, self, other, dist) {
      const W = TUNING.WEIGHT
      const bond = self.bond || { affinity: 0, familiarity: 0 }
      // **底分 0.6**：能走到这里的候选，门已经放行过（chooseIntent 只对 gate === null 的候选调本函数）。
      // 所以「打分的候选」=「此刻做得到的事」—— 做得到的事不该比发呆（idle 0.4）更差。
      // 没有它，affinity=0 时 8 个剧本全在 idle 之下 ⇒ 两只走近之后什么都不做，
      // 而 greet 在 UNLOCK 里明明是 0 好感就解锁的 ——「解锁了但永远选不上」等于没解锁。
      let s = 0.6 + bond.affinity * W.affinity + bond.familiarity * W.familiarity
      if (candidate === 'comfort') s += Math.max(0, -other.mood) * 1.2      // 对方越难过越想安慰
      if (candidate === 'tease') s += Math.max(0, self.energy - 0.5) * 1.0
      if (candidate === 'shoulder') s += Math.max(0, bond.affinity) * 0.02
      if (candidate === 'approach') {
        // 只按「值不值得过去」打分：越远越想过去，已经在身边就没有「过去」可言。
        // 因此它**不参与**下面的距离惩罚 —— 那条惩罚与它的语义正好相反。
        return 0.5 * Math.min(1, dist / TUNING.SOCIAL_RADIUS)
      }
      s -= (dist / TUNING.SOCIAL_RADIUS) * W.distance
      return s
    }

    /**
     * 选一个意图。返回 `{ intent, family, score, gate }`。
     * **不修改任何状态**（决策与推进分离，才好测）。
     */
    function chooseIntent(self, other, rng) {
      const T = TUNING
      const dist = other ? Math.hypot(other.x - self.x, other.y - self.y) : Infinity
      const cands = []
      for (const c of INTENTS.solo) cands.push({ intent: c, family: 'solo', gate: null, score: soloScore(c, self) })
      for (const c of INTENTS.social) {
        const g = socialGate(c, self, other, dist)
        cands.push({ intent: c, family: 'social', gate: g, score: g ? -Infinity : socialScore(c, self, other, dist) })
      }
      const live = cands.filter((c) => c.gate === null)
      if (live.length === 0) return { intent: 'idle', family: 'solo', gate: null, score: 0, all: cands }
      let best = live[0]
      for (const c of live) {
        const j = (rng() - 0.5) * T.WEIGHT.jitter
        if (c.score + j > best.score + (best._j || 0)) { best = c; best._j = j }
      }
      return { intent: best.intent, family: best.family, gate: null, score: best.score, all: cands }
    }

    /* ==================== §3.6 诱因 → 心智（V3b：诱因不再直接点播） ==================== */
    /**
     * 诱因不再直接点播动画，而是**推动心智状态**；下一拍由导演决定这只宠要做什么。
     * 计划 Task 5 Step 3 原文把这段定义在 start() 里、闭包 minds/world/config —— 那样跨 realm
     * 单测够不到（__kylinContract 在**装载期**就冻结了，start() 还没跑），而 Step 5 第 1 条
     * 「没有任何 actor 的 play 被同步调用」必须有观测口。故把**同一份逻辑**提为显式参数的
     * 工厂作用域函数（函数体逐字照抄计划原文，只把 minds / actors / config 变成形参）。
     */
    function deliverStimulus(minds, actors, stimulus, config) {
      // V2 react() 的守卫，必须保留：没有它，deliverStimulus(null) 会抛，被 poll 的 try/catch 吞掉
      // ⇒ since 不推进 ⇒ **整批诱因每 1s 反复重投**。
      if (!stimulus || KINDS.indexOf(stimulus.kind) < 0) return []
      const ids = qualified(stimulus.kind, config)
      // V5：忙碌标记是**全员**的（两只都在同一台机器上干活），气泡只由主讲出。
      // 分开处理是因为 `qualified()` 回答的是「谁该开口」，不是「谁该进入忙碌态」——
      // 把两者混在一个循环里，就会出现「没开口的那只看起来在闲逛」的观感。
      if (stimulus.kind === 'working' || stimulus.kind === 'working-done') {
        const busy = stimulus.kind === 'working'
        for (const p of (config && config.cast) || []) {
          const mm = minds[p.id]
          if (mm) mm.working = busy
        }
        if (busy) {
          // 「听到有活就停下手里的散步」—— 不清掉 target 的话，正在走向某处的宠会带着
          // 走路档走完那几秒，忙碌档要等它到站才出现（实测里那 2 拍空闲就是这么来的）。
          for (const a of actors) { if (!a.held) a.target = null }
        }
      }
      const touched = []
      for (const id of ids) {
        const m = minds[id]
        const a = actors.find((x) => x.pet.id === id)
        if (!m || !a || a.held) continue
        if (stimulus.kind === 'turn-ok') { m.mood = clamp(m.mood + 0.35, -1, 1); m.energy = clamp(m.energy + 0.1, 0, 1) }
        if (stimulus.kind === 'turn-fail') { m.mood = clamp(m.mood - 0.45, -1, 1) }
        if (stimulus.kind === 'waiting') { m.attention = 'drawn'; a.say(LINES_STIMULUS.waiting) }
        if (stimulus.kind === 'working') a.say(LINES_WORKING[stimulus.detail] || LINES_WORKING.other)
        if (stimulus.kind === 'working-done') {
          a.say(LINES_STIMULUS['working-done'])
          // 收工这一下让**另一只**应一声。刻意只在收工：在忙期间每次换类都应和，
          // 会变成两条气泡互相刷，而这一面本来就是高频的。
          const other = actors.find((x) => x.pet.id !== id && !x.held)
          if (other) other.say(ECHO_DONE)
        }
        touched.push(id)
      }
      return touched
    }

    /**
     * 任务执行期，这只宠该不该播「状态忙碌」？返回要播的**那一段**素材名，或 null。
     *
     * **纯函数、无 DOM**，刻意放工厂作用域 —— 原因与本文件其他地方同款：
     * 装进 `idleChain` 内部的判断没有 DOM 就够不到，而「忙的时候到底播不播、播哪段」
     * 正是最该被单测钉住的判断。
     *
     * 三个否定条件各有理由：
     * - `held`：被用户拎在手上时该播「被拎起」，不该显示在忙；
     * - `busy`：**正在合演** —— 合演的档位由导演点播，这里接管会把合演中途盖成「忙碌」，
     *   看起来像宠演到一半突然去干活了；
     * - `!mind.working`：没有任务在跑。
     * 注意**不检查 `target`**（正在走向某处）：走上几秒再切忙碌比半路急停自然，
     * 而气泡是立刻出的，用户不会觉得没反应。
     */
    /** 点击反应选段：从档位里随机挑一段、**不与正在播的相同**（档位只有一段时只能原样返回）。 */
    function pickDifferent(pool, current, rng) {
      const rest = pool.filter((n) => n !== current)
      return pick(rest.length ? rest : pool, rng)
    }

    function busyClipOf(mind, actor) {
      if (!mind || !actor) return null
      if (actor.held || actor.busy) return null
      if (!mind.working) return null
      return BUSY_CLIP
    }

    /* ==================== §3.7 导演 Director 与互动 Interaction ==================== */
    /** 剧本的可见编排：每个阶段该做什么。剧本**只允许**用这些动作，不得碰 DOM。 */
    const PHASES = ['approach', 'open', 'exchange', 'settle']

    /**
     * 建一个导演。
     * 铁律（spec §6）：动作槽最多 1 个合演 + 每宠 1 个独演；仲裁败者**退回独处链，不报错不排队**；
     * 收尾唯一入口 —— 账本与记忆只在这里写。
     */
    function createDirector(opts) {
      const world = opts.world
      const minds = opts.minds          // petId -> mind
      const model = opts.model          // { cooldowns, affinity, familiarity, ... } 由外部镜像
      const rng = opts.rng || Math.random
      const stick = opts.onStimulus || function () {}
      let duet = null                   // 当前唯一的合演
      let clock = 0                     // **导演自己的时钟**：只由 step(dt) 推进；时间戳一律显式传参，不塞进心智状态
      const memories = []               // { at, kind, actors, outcome }

      const pairKey = world.pairKey
      function bondOf() { return model.bond || { affinity: 0, familiarity: 0 } }

      /** 优先级 = |affinity| × 意图强度 × 新鲜度（spec §6）。这里用「上次同剧本距今越久越新鲜」。 */
      function priority(intent, mind, at) {
        const a = Math.abs(bondOf().affinity)
        const strength = mind.energy
        const last = (mind.recent || []).filter((r) => r.kind === intent).pop()
        const fresh = last ? clamp((at - last.at) / 300, 0, 1) : 1
        return a * strength * fresh + strength
      }

      /** 找一个可配对的对手：对方此刻空闲、没被拎起、且不是我自己。 */
      function freePartner(self) {
        for (const a of world.actors) {
          // 计划原文写 a === self.actor，但调用点是 freePartner(actor)（见本节的 step）——
          // 逐字照抄会把「自己」当对手返回，乃至与自己合演。按本节文档注释「不是我自己」最小改写。
          if (a === self) continue
          if (a.held) continue
          if (a.busy) continue
          // V5：**别招募正在干活的宠** —— 招募它会把它从「忙碌」拽进合演，
          // 而合演会设 target、点播档位，等于换个方式把忙碌画面掀掉。
          const pm = minds[a.pet.id]
          if (pm && pm.working) continue
          return a
        }
        return null
      }

      /** 开一场合演。**同一时刻只允许一场**（动作槽）。 */
      function open(initiatorActor, responderActor, kind, at) {
        if (duet) return null
        duet = {
          kind: kind,
          initiator: initiatorActor.pet.id,
          responder: responderActor.pet.id,
          phase: 'approach',
          deadline: TUNING.PHASE_TIMEOUT_SEC.approach,
          outcome: null,
          at: at,
        }
        initiatorActor.busy = true
        responderActor.busy = true
        return duet
      }

      /** 终局：写账本 + 双方记忆 + 冷却。**这是唯一写账本的地方**。 */
      function settle(kind, actorA, actorB, effectName, at) {
        const eff = TUNING.EFFECT[effectName] || { affinity: 0, familiarity: 0 }
        const ev = {
          pair: pairKey,
          kind: kind,
          affinityDelta: eff.affinity,
          familiarityDelta: eff.familiarity,
          at: at,
        }
        model.bond = {
          affinity: clamp(bondOf().affinity + eff.affinity, BOND.AFFINITY_MIN, BOND.AFFINITY_MAX),
          familiarity: Math.max(0, bondOf().familiarity + Math.max(0, eff.familiarity)),
        }
        for (const a of [actorA, actorB]) {
          if (!a) continue
          const m = minds[a.pet.id]
          if (!m) continue
          m.mood = clamp(m.mood + (eff.affinity > 0 ? 0.2 : eff.affinity < 0 ? -0.2 : 0), -1, 1)
          m.recent = m.recent.concat([{ kind: kind, at: at, delta: eff.affinity }]).slice(-TUNING.MEMORY_MAX)
          m.cooldown[kind] = TUNING.COOLDOWN_SEC[kind] || 60
        }
        // 计划注释②：busy 的清除必须在 settle 与 abort **两条路**上都发生（只清 abort 会让宠永久卡住）。
        // 原文此处漏了 —— 按注释补上；置空后 freePartner 才可能配到新的一对。
        for (const a of [actorA, actorB]) if (a) a.busy = false
        memories.push({ kind: kind, at: at, affinity: eff.affinity })
        if (memories.length > 50) memories.shift()
        // ⚠️ 必须传**单个事件对象**：V3 的 queueBondEvent(ev) 逐个读 ev.pair / ev.kind /
        // ev.affinityDelta。传数组（原写法 stick([ev])）会让这些字段全是 undefined ⇒
        // 落盘成 {kind:"unknown", affinityDelta:0} ⇒ **互动永不改变关系**。
        // 2026-10-11 由 Task 6 真机取证发现（单测发现不了：测试替身的形状是从这个调用点抄的）。
        stick(ev)                       // V3 的 queueBondEvent：防抖 + PUT /bond，**不在这里**
        return ev
      }

      /** 中断：被用户拎走 / 超时。要**写记忆**（被谁打断是心智的输入）。 */
      function abort(reason) {
        if (!duet) return null
        const done = duet
        done.outcome = 'abort:' + reason
        for (const id of [done.initiator, done.responder]) {
          const m = minds[id]
          if (m) m.recent = m.recent.concat([{ kind: done.kind, at: done.at, delta: 0, aborted: reason }]).slice(-TUNING.MEMORY_MAX)
        }
        for (const a of world.actors) a.busy = false
        memories.push({ kind: done.kind, at: done.at, aborted: reason })
        duet = null
        return done
      }

      /** 按 id 找演员；找不到回 null（不抛）。 */
      function actorById(id) { return world.actors.find((a) => a.pet.id === id) || null }

      /** 本阶段的声明；剧本或阶段缺失回 null。 */
      function phaseSpec(kind, phase) {
        const s = SCRIPTS[kind]
        return s && s.phases ? (s.phases[phase] || null) : null
      }

      /**
       * 这一段的**动作**该播在谁身上。默认发起方；`who` 可指定对方或「先到者」。
       * 台词仍归发起方（谁主动谁说话）—— `who` 只管动作，这是刻意的。
       */
      function actorFor(spec, actorA, actorB, cur) {
        if (spec.who === 'responder') return actorB || actorA
        if (spec.who === 'winner') return cur && cur.winner === (actorB && actorB.pet.id) ? actorB : actorA
        return actorA
      }

      /** 进入新阶段的一次性动作：播片 / 设朝向 / 放台词 / 起步。只在 sincePhase === 0 那一拍做。 */
      function enterPhase(spec, actorA, actorB, cur) {
        if (spec.clip) {
          if (spec.who) {
            // 声明了 who：动作**独占**给那一只（败者不该也一起乐）。
            const target = actorFor(spec, actorA, actorB, cur)
            if (target) target.play(spec.clip)
          } else {
            // 没声明 who：**逐字保留原行为** —— happy 阶段两只都播（spec §7「打招呼 → 各放 happy」）。
            // ⚠️ 这一行曾被改写时整段吞掉，导致 greet.exchange / gift.open / reconcile.exchange
            // 从「两只都播」退化成「只有发起方播」。2026-10-11 由 Task 5b 子代理发现。
            if (actorA) actorA.play(spec.clip)
            if (actorB && spec.clip === 'happy') actorB.play(spec.clip)
          }
        }
        if (spec.facing === 'toward' && actorA && actorB) actorA.setFacing(actorB.x < actorA.x ? -1 : 1)
        if (spec.say) {
          const line = LINES[spec.say]
          if (line && actorA) actorA.say(typeof line === 'string' ? line : (line[actorA.pet.id] || line[actorB.pet.id] || ''))
        }
        if (spec.move === 'toward' && actorA && actorB) {
          // 不自己算间距：原来用 ASSET.W*0.28（素材原生宽 640 → 179.2），而 separate() 用的是
          // 演员渲染宽 280（→ 156.8）。两个「0.28 的宽」不是同一个宽 ⇒ 终点与下限只差 22px。
          // 直接以对方为目标，**能走多近由 separate() 决定**（它是唯一的裁决点）。
          actorA.target = { x: actorB.x, y: actorB.y }
        } else if (spec.move === 'apart' && actorA && actorB) {
          // 并肩之后各自退回一点。退回量用**演员渲染宽**（与世界同一把尺子），
          // 不是 ASSET.W —— 那是素材原生宽 640，算出来的 179.2 与 minGap 156.8 不同尺。
          const back = ((actorA.box.w + actorB.box.w) * 0.28) / 2
          actorA.target = { x: actorA.x + (actorA.x <= actorB.x ? -back : back), y: actorA.y }
          actorB.target = { x: actorB.x + (actorA.x <= actorB.x ? back : -back), y: actorB.y }
        } else if (spec.move === 'point' && actorA && actorB) {
          // 双方冲向同一个中点 —— 谁离得近谁先到，这就是 contest 的胜负。
          const mid = { x: (actorA.x + actorB.x) / 2, y: (actorA.y + actorB.y) / 2 }
          actorA.target = { x: mid.x, y: mid.y }
          actorB.target = { x: mid.x, y: mid.y }
        }
      }

      /** 推进一拍。返回 'settled' / 'aborted' / null（仍在演）。 */
      function runDuet(dt) {
        const actorA = actorById(duet.initiator)
        const actorB = actorById(duet.responder)
        const spec = phaseSpec(duet.kind, duet.phase)
        if (!spec) { abort('no-phase'); return 'aborted' }
        // sincePhase 由执行器第一拍惰性补上（计划 Step 2 采纳的执行期修正 2026-10-11）：
        // open() 的返回对象形状保持 Task 3 的原样，test/director.test.mjs 的逐键断言才保住判别力。
        if (duet.sincePhase === undefined) duet.sincePhase = 0
        if (duet.sincePhase === 0) enterPhase(spec, actorA, actorB, duet)
        duet.sincePhase += dt
        const done = spec.until && ADVANCE[spec.until] ? ADVANCE[spec.until](duet, world) : true
        if (!done) return null
        // 离开 approach 时定胜负（contest 的 who:'winner' 靠它，否则那个分支永远取不到 ——
        // 「声明了但无法到达」和「没声明」是一样的）。
        // 判据是 spec §7 的「**先到者得**」：进入 approach 结束时**距自己的目标更近**的那只。
        // 注意不能用「离对方多远」——contest 的 approach 是 move:'point'，两只 target 都指向
        // 双方中点，而中点到两人的距离**恒相等**，用那个判永远平局。要比的是**各自到各自 target**。
        if (duet.phase === 'approach') {
          const distToTarget = (a) => (a && a.target) ? Math.hypot(a.target.x - a.x, a.target.y - a.y) : Infinity
          duet.winner = distToTarget(actorB) < distToTarget(actorA) ? duet.responder : duet.initiator
        }
        const i = PHASES.indexOf(duet.phase)
        if (i < PHASES.length - 1) {
          duet.phase = PHASES[i + 1]
          duet.sincePhase = 0
          duet.deadline = TUNING.PHASE_TIMEOUT_SEC[duet.phase]
          return null
        }
        const script = SCRIPTS[duet.kind]
        const eff = Array.isArray(script.effect)
          ? (bondOf().affinity >= 0 ? script.effect[0] : script.effect[1])
          : script.effect
        settle(duet.kind, actorA, actorB, eff, clock)
        duet = null
        return 'settled'
      }

      /** 每拍推进一次合演。返回本拍发生的事（给测试与取证观察）。 */
      function step(dt) {
        clock += dt                      // 时钟只在这里走
        const events = []
        for (const a of world.actors) {
          const m = minds[a.pet.id]
          if (m) stepMind(m, dt)
        }

        if (duet) {
          // 对手被拎走 ⇒ 立即中断（spec §6）
          // D3 修正：必须先筛「被拎起的」，再判断它是不是本场两只之一。
          // 原文 find((a) => a.pet.id === duet.responder || a.pet.id === duet.initiator)
          // 返回的是数组里第一个匹配任一 id 的 actor —— 实际只检查了一只，
          // 拎起另一只不会中断（执行期实测：拎 responder → events=[]，duet 仍在）。
          const held = world.actors.find((a) => a.held && (a.pet.id === duet.responder || a.pet.id === duet.initiator))
          if (held) { events.push({ type: 'abort', detail: abort('partner-held') }); return events }
          duet.deadline -= dt
          if (duet.deadline <= 0) { events.push({ type: 'abort', detail: abort('timeout') }); return events }
          const r = runDuet(dt)
          if (r) events.push({ type: r === 'settled' ? 'settle' : 'abort', detail: r })
          return events
        }

        // 没有合演：每只宠各选一个意图；社交意图要配对成功才升格为合演
        for (const a of world.actors) {
          if (a.held || a.busy) continue
          const m = minds[a.pet.id]
          if (!m) continue
          // V5：**正在干活的宠对导演不可用**。
          // ⚠️ 2026-10-11 真浏览器取证发现：这里原本只挡了下面「独处」那一条路
          // （`if (!m.working) a.play(...)`），而**社交路径一条都没挡** —— approach 会
          // `a.target = {…}` + `play('walk')`、败者仲裁会 `play('idle')`。
          // 结果就是导演与上面的忙碌分支**每帧互抢**：导演设 target ⇒ idleChain 早退 ⇒
          // 忙播不出；走到目的地 ⇒ target 清空 ⇒ 忙播出来 ⇒ 导演又设 target……
          // 用户看到的是**屏幕闪烁**（90 帧内档位跳 6 个状态）。
          // 正确的语义不是「导演别播」，而是「这只宠此刻在忙，导演别碰它」。
          if (m.working) continue
          const other = freePartner(a)
          const pick = chooseIntent(m, other ? minds[other.pet.id] : null, rng)
          events.push({ type: 'intent', pet: a.pet.id, intent: pick.intent, family: pick.family })
          if (pick.family !== 'social' || !other) {
            // **独处动作一字不排。** 独处的唯一写者是世界（`idleChain`）——
            // 这里曾经还会 `a.play(...)` + 设 `a.target` + 重挂 `a.next`，于是同一只宠有**两个写者**：
            //
            //   · 帧序是 world.step → director.step，导演是**最后写者**；
            //   · 世界的 `idleChain` 走 walk 分支时**不重挂 `a.next`**（它靠 `a.target` 早退），
            //     所以「`a.next <= 0`」这道闸在那个瞬间**是开着的** ⇒ 下一帧导演立刻把刚播的「走路」盖掉。
            //   · 实测切换间隔出现 **233ms 的双切** —— 交叉淡入（110ms）还没走完就再切一次，
            //     这就是用户报的「屏幕闪烁 + 人物闪烁」。
            //
            // 参考实现的教训是一致的：**只有一个决策点** —— 它在 `ended` 回调里
            // `pickNext()`，除此之外没有任何地方 `play`。多一个写者，就多一种时序竞态。
            //
            // 导演保留它的**决策**（上面那行 `intent` 事件照发，社交路径照走），只是不再动手播。
            continue
          }
          // 意图名 ≠ 剧本名。approach 是「走过去」这个前导动作，SCRIPTS 里没有它。
          // 没有剧本就**不开合演** —— 否则会 open 一个不存在的剧本，下一拍 abort('no-phase')，
          // 而 abort 不上冷却 ⇒ 每两拍空转一次（执行期实测）。
          if (!SCRIPTS[pick.intent]) {
            if (pick.intent === 'approach' && other) {
              a.target = { x: other.x, y: other.y }
              a.play('walk')
            } else {
              a.play('idle')
            }
            continue
          }
          // 仲裁：两只都要同一场时才成；否则按优先级，败者退回独处链
          const mine = priority(pick.intent, m, clock)
          const theirs = priority(pick.intent, minds[other.pet.id], clock)
          if (theirs > mine) { a.play('idle'); continue }     // 败者退回独处链，不报错、不排队
          const created = open(a, other, pick.intent, clock)
          if (created) events.push({ type: 'open', detail: created })
          return events
        }
        return events
      }

      return {
        get duet() { return duet },
        get memories() { return memories.slice() },
        step: step, settle: settle, abort: abort, open: open,
        priority: priority, freePartner: freePartner,
      }
    }

    /* ==================== §3.9 剧本（声明式编排表 + 原创文案 + 阶段推进谓词） ==================== */
    /**
     * 8 个剧本的编排表（spec §7）。每阶段只允许三件事：
     *   clip  —— 播哪一档（**必须**来自 CLIPS 的 6 档之一）
     *   say   —— 冒哪句气泡（来自 LINES）
     *   move  —— 谁朝谁走近（approach / contest 用）
     * `until` 是阶段推进谓词名，实现见 §Director 的 ADVANCE。
     */
    const SCRIPTS = Object.freeze({
      greet: {
        effect: 'greet',
        phases: {
          approach: { clip: 'walk', move: 'toward', until: 'near' },
          open:     { clip: 'turn', facing: 'toward', until: 'turned' },
          exchange: { clip: 'happy', say: 'greet', until: 'once' },
          settle:   { clip: 'idle', until: 'immediate' },
        },
      },
      gift: {
        effect: ['gift', 'giftIgnored'],      // 对方接不接受是 Outcome；两条 effect 由 exchange 的结果选
        phases: {
          approach: { clip: 'walk', move: 'toward', until: 'near' },
          open:     { clip: 'happy', say: 'gift', until: 'once' },
          exchange: { clip: 'turn', until: 'once' },          // 对方开心或无视，表现相同、账本不同
          settle:   { clip: 'idle', until: 'immediate' },
        },
      },
      tease: {
        effect: 'tease',
        phases: {
          approach: { clip: 'walk', move: 'toward', until: 'veryNear' },
          open:     { clip: 'turn', facing: 'away', say: 'tease', until: 'turned' },
          exchange: { clip: 'sad', who: 'responder', until: 'once' },   // 只有**对方**难过（spec §7）
          settle:   { clip: 'idle', until: 'immediate' },
        },
      },
      comfort: {
        effect: 'comfort',
        phases: {
          approach: { clip: 'walk', move: 'toward', until: 'near' },
          open:     { clip: 'idle', say: 'comfort', until: 'once' },
          exchange: { clip: 'happy', who: 'responder', until: 'once' },
          settle:   { clip: 'idle', until: 'immediate' },
        },
      },
      shoulder: {
        effect: 'shoulder',
        phases: {
          approach: { clip: 'walk', move: 'toward', until: 'near' },
          open:     { clip: 'idle', facing: 'toward', until: 'immediate' },
          exchange: { clip: 'idle', until: 'hold3s' },                  // 相向而立，呼吸相位错开
          settle:   { clip: 'idle', move: 'apart', until: 'once' },
        },
      },
      chase: {
        effect: 'chase',
        phases: {
          approach: { clip: 'walk', move: 'toward', until: 'veryNear' },
          open:     { clip: 'walk', say: 'chase', until: 'once' },
          exchange: { clip: 'walk', until: 'hold4s' },                  // 位置驱动：撞边界换向
          settle:   { clip: 'idle', until: 'immediate' },
        },
      },
      reconcile: {
        effect: 'reconcile',
        phases: {
          approach: { clip: 'walk', move: 'toward', until: 'near' },
          open:     { clip: 'sad', say: 'reconcile', until: 'once' },
          exchange: { clip: 'happy', say: 'gift', until: 'once' },      // 主动 + 献宝（spec §7）
          settle:   { clip: 'idle', until: 'immediate' },
        },
      },
      contest: {
        effect: 'contest',
        phases: {
          approach: { clip: 'walk', move: 'point', until: 'arrived' },  // 双方冲向同一点
          open:     { clip: 'turn', say: 'contest', until: 'once' },
          exchange: { clip: 'happy', who: 'winner', until: 'once' },    // 先到者得
          settle:   { clip: 'idle', until: 'immediate' },
        },
      },
    })

    /** 文案表：剧本 × 角色。**全原创**（不带任何上游措辞），V4 可顺势换表情包图。 */
    const LINES = Object.freeze({
      greet:     { kylinzi: '来啦',     xisha: '嗯' },     // 「在呢」与 waiting 撞句，已拆
      gift:      { kylinzi: '看看这个', xisha: '……谢谢' },
      tease:     { kylinzi: '略',       xisha: '……' },
      comfort:   { kylinzi: '别难过',   xisha: '我没事' },
      chase:     { kylinzi: '别跑',     xisha: '你追不上' },
      reconcile: { kylinzi: '我错了',   xisha: '……算了' },
      contest:   { kylinzi: '我先',     xisha: '我先' },
    })

    /**
     * 合演双方的当前距离（纯读）。
     * 计划正文的 ADVANCE 引用了 dist(d, w)，但计划没有给它的定义 —— 这里按同一语义补上（不改任何状态）。
     */
    function dist(d, w) {
      const a = w.actors.find((x) => x.pet.id === d.initiator)
      const b = w.actors.find((x) => x.pet.id === d.responder)
      if (!a || !b) return Infinity
      return Math.hypot(b.x - a.x, b.y - a.y)
    }

    /** 谓词：给 (duet, world, dt) 判「本阶段结束了吗」。全部是**纯读**，不改状态。 */
    const ADVANCE = {
      near:      (d, w) => dist(d, w) <= TUNING.NEAR_RADIUS,
      veryNear:  (d, w) => dist(d, w) <= TUNING.NEAR_RADIUS * 0.6,
      turned:    (d) => d.sincePhase >= 0.4,        // 转身动作放完约 0.4s
      once:      (d) => d.sincePhase >= 0.6,        // 一次性档播完就够
      immediate: (d) => d.sincePhase >= 0.2,
      hold3s:    (d) => d.sincePhase >= 3.0,
      hold4s:    (d) => d.sincePhase >= 4.0,
      arrived:   (d) => d.sincePhase >= 1.5,        // 争抢：谁先到由 world 的位置比较决定，这里只做兜底
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
            // 被拎起的那只这一刻由**用户**定位：世界不跟用户抢位置。
            // 不跳过的话，拖拽期间每帧都在把它们推开，松手时距离已被推到 minGap(156.8)，
            // 而 spec §8 的「拖到一起放下触发互动」要求 ≤ DROP_DISTANCE(120) —— 永远够不着。
            // 2026-10-11 由 V3 Task6 真浏览器取证发现（V1/V2 的取证没抓到这个）。
            if (x.held || y.held) continue
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
      function idleChain(a, dt, isWorking) {
        if (a.held || a.target) return
        // V5：任务执行期间播「状态忙碌」（walk 档里的**循环**素材，用 exact 播指定那一段，
        // 不能随机 —— 随机会跳去「走路」）。
        // `!a.busy` 是关键：`a.busy` 是**合演中**标记，合演期间必须由导演点播，
        // 否则这条会把合演的档位盖掉，看起来像「宠在合演中途突然开始忙」。
        if (!a.busy && typeof isWorking === 'function' && isWorking(a)) {
          a.play('walk', BUSY_CLIP)
          return
        }
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

      function step(dt, isWorking) {
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
          idleChain(a, dt, isWorking)
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

      /** 拖到一起放下后的 V1 占位：转身面对面 + 各放一次开心。V3 追加账本副作用（+2 好感 / +1 熟悉）。 */
      function bump(a, b) {
        a.setFacing(b.x < a.x ? -1 : 1)
        b.setFacing(a.x < b.x ? -1 : 1)
        a.play('happy')
        b.play('happy')
        a.next = rand(2, 4)
        b.next = rand(2, 4)
        // 账本的唯一产生点；写入仍只在 host —— 这里只排队，2s 防抖后 PUT /bond。
        queueBondEvent({ kind: 'bump', affinityDelta: 2, familiarityDelta: 1 })
      }

      // ⚠️ 这里原本有一个 `CLIP_OF = { 'turn-ok': 'happy', ... }`，**从未被读过**。
      // 它是 V3b Task 5 Step 3 删掉旧 react() 时留下的残骸 —— 名字看起来像活的，
      // 但全文件只有这一处定义。2026-10-11 V5 清掉：**看起来还活着的死代码**
      // 比明显的死代码更贵，因为下一个人会照着它改。

      // V3b Task 5 Step 3：旧的 react() 已删除 —— 诱因改由 §3.6 的 deliverStimulus 施加到心智，
      // 点播交给导演。世界不再暴露 react（deliverStimulus 不属于世界）。

      return { actors: actors, step: step, separate: separate, nearest: nearest, bump: bump, qualified: qualified, W: W, H: H }
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
          // 只认左键：右键/中键进入拖拽判定会与右键菜单打架（参考实现 pointerdown 第一行同款，两端一致）。
          if (e.button !== 0) return
          e.preventDefault()
          try { a.hit.setPointerCapture(e.pointerId) } catch (err) { /* 合成事件/已释放的 pointer 不该炸 */ }
          grab = { id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: e.clientX - a.x, dy: e.clientY - a.y, moved: false }
          a.hit.style.cursor = 'grabbing'
        })

        a.hit.addEventListener('pointermove', (e) => {
          if (!grab || e.pointerId !== grab.id) return
          // 参考：位移 < DRAG_THRESHOLD 一律不算拖（≥5 才算），点击/拖拽的判据只有这一个。
          if (!grab.moved && Math.hypot(e.clientX - grab.sx, e.clientY - grab.sy) >= TUNING.DRAG_THRESHOLD) {
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
            // 参考实现 handleClick：点击 = 先**收手停住**再回应。不清 target 会「边走边播点击反应」，
            // 而且 onEnded 被 a.target 短路成「不回待机」，走路状态就再也出不去了。
            a.target = null
            // 从 happy 档随机点一段且**不与正在播的相同**（参考实现 pick(pool, current) 同语义）：
            // 连点两下播同一段，看起来就像没反应。
            a.play('happy', pickDifferent(CLICKS, a.clipName, a.rng))
            const mate = world.nearest(a, Infinity)
            // spec §8：对方是否好奇凑过来由**关系**决定（V1 的 50% 占位已被 affinity 取代）
            if (mate && !mate.held && Math.random() < curiosityOf(bondState.affinity)) {
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

    /** @param host 宿主给的挂载点（槽位里的 div）。测试环境没有槽位时退回 body。 */
    async function start(host) {
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
      // §4.5：createWorld 之前先读账本（读不到就用 0/0 —— 降级不崩），bump 才接得上关系。
      const pairKey = pairId(config.cast[0].id, config.cast[1].id)
      bondState = Object.assign({ pairKey: pairKey }, normalizeBondPair(await loadBondPair(pairKey)))
      const root = createStageRoot()
      ;(host || document.body).appendChild(root)
      const world = createWorld({ config: config, root: root })
      /* §3.6：心智与导演 —— 必须在导演第一次 step 之前给每只宠赋 bond 与 x/y（顺序不能反）。
         缺 bond ⇒ unlocked/socialGate 读 bond.familiarity 直接抛；缺 x/y ⇒ dist 恒 NaN ⇒
         社交候选 score 全 NaN ⇒ 永不入选 ⇒ 永远开不了合演。 */
      const minds = {}
      for (const a of world.actors) {
        const m = createMind(a.pet.id)
        m.bond = bondFor(a.pet.id)        // V3 读回的账本快照；读不到就是 {affinity:0, familiarity:0}
        m.x = a.x; m.y = a.y              // chooseIntent 靠它算距离
        minds[a.pet.id] = m
      }
      // **必须在建导演之前**：createDirector 在创建时就拷贝 world.pairKey，晚了它拿到的是 undefined，
      // settle 事件会带 pair: undefined（全靠 queueBondEvent 的回退才没出事 —— 而那正是「靠兜底活着」）。
      world.pairKey = pairKey
      const director = createDirector({
        world: world,
        minds: minds,
        model: { bond: bondFor('*') },    // 双方共用一对账本：pairKey 已由 V3 定好
        rng: Math.random,
        onStimulus: queueBondEvent,       // ← V3 的防抖写入口；导演**不自己发请求**
      })
      /* Task 6 取证探针：只读快照，不暴露任何可变引用（memories 在 director 的 getter 里已拷一份）。 */
      const actorOf = (id, key) => {
        const a = world.actors.find((x) => x.pet.id === id)
        return a ? a[key] : undefined
      }
      probe = () => ({
        duet: director.duet ? { kind: director.duet.kind, phase: director.duet.phase, at: director.duet.at } : null,
        memories: director.memories.slice(-20),
        moods: Object.fromEntries(Object.keys(minds).map((id) => [id, {
          mood: minds[id].mood, energy: minds[id].energy, cooldown: Object.keys(minds[id].cooldown),
          // V5 执行期：这三项决定「会不会播状态忙碌」，而它们**从 DOM 上都看不到** ——
          // 取证时正是因为读不到它们，只能看到「档位没变」却不知为何。探针补上，
          // 让这一类「静默不生效」下次能一眼定位。
          working: minds[id].working === true,
          held: !!actorOf(id, 'held'),
          duetBusy: !!actorOf(id, 'busy'),
          clip: actorOf(id, 'clipName'),
        }])),
      })
      wireGestures(world)
      let last = performance.now()
      /* V5b：卸载闸。单靠 cancelAnimationFrame 不够 —— 若卸载正好发生在一帧**执行中**
         （effect 与 rAF 回调同在一个宏任务队列里），帧尾那句 requestAnimationFrame 会
         重新挂上一条谁也拿不到句柄的循环。停下这件事交给一个标志位，句柄只负责「还没跑的那次」。 */
      let stopped = false
      let rafId = 0
      const frame = (now) => {
        if (stopped) return
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        if (!document.hidden) {
          // spec R4 + V1 的位移权威：位置仍然只由世界改。
          // V5：把「这只在忙吗」作为**显式参数**传进去，而不是让世界自己去够 minds ——
          // createWorld 建在心智之前（minds 在 start() 里才建），世界拿不到它。
          // 判定走**纯函数** `busyClipOf`，与单测用同一份逻辑 —— 不在这里重写一遍条件。
          world.step(dt, (act) => busyClipOf(minds[act.pet.id], act) !== null)
          // 位置落定后同步进心智 —— 导演读的是心智上的位置（缺它就 NaN，永远开不了合演）。
          for (const a of world.actors) {
            const m = minds[a.pet.id]
            if (!m) continue
            m.x = a.x; m.y = a.y
            // 关系也会在会话里变（bump / settle）。不刷新的话，TUNING.UNLOCK 永远停在启动那一刻的值
            // —— 例如 shoulder 要 affinity ≥ 20，用户把关系养到 20 也要刷新页面才解锁。
            m.bond = { affinity: bondState.affinity, familiarity: bondState.familiarity }
          }
          director.step(dt)               // V3b 的演出权威：意图与合演。**顺序是语义**：先落定、再决策
        }
        if (!stopped) rafId = requestAnimationFrame(frame)
      }
      rafId = requestAnimationFrame(frame)
      // 诱因轮询：1s 一拍（手调值，V4 需要再加配置项）。后台标签页照轮 —— 诱因不该因切标签丢掉。
      let since = null   // null = 还没学水位
      const poll = async () => {
        try {
          const q = since === null ? '' : '?since=' + since
          const res = await fetch(ROUTE_PREFIX + '/state' + q, { cache: 'no-store' })
          if (!res.ok) return
          const body = await res.json()
          if (stopped) return        // V5b：卸载后已在飞的续体不许再动舞台
          const cur = Number(body && body.cursor)
          if (!Number.isFinite(cur)) return
          if (since !== null && cur < since) since = null      // host 重启：水位回退，重新起步
          for (const s of (body && body.stimuli) || []) deliverStimulus(minds, world.actors, s, config)
          since = cur
        } catch (err) { /* 宿主不在时静默：桌宠不该刷屏 */ }
      }
      const stateTimer = setInterval(poll, 1000)
      poll()
      // 余额：30s 一读。档位变化才播；tier=null / kind='unavailable' 一律不播（不猜、不假装）。
      const pollBalance = async () => {
        try {
          const res = await fetch(ROUTE_PREFIX + '/balance', { cache: 'no-store' })
          if (!res.ok) return
          const entry = await res.json()
          if (stopped) return        // V5b：同上 —— 卸载后不再播报
          const tier = balanceCue(entry, lastTier)
          if (tier === null) return
          const clip = tierClip(tier)
          if (clip === null) return
          lastTier = tier
          for (const a of world.actors) {
            if (a.pet.balance !== true) continue   // §8：只有声明了 balance 的宠才播报
            a.play(clip[0], clip[1])
            a.say(tier)
          }
        } catch (err) { /* 宿主不在时静默：桌宠不该刷屏 */ }
      }
      const balanceTimer = setInterval(pollBalance, BALANCE_POLL_MS)
      pollBalance()
      console.info('[dsh-kylin-pet] 舞台已就绪：' + config.cast.map((p) => p.id).join(' + '))

      /* V5b：**把舞台完整交还出去**。apply 的 effect disposer 调它。
         枚举口径对着 start() 里铺开的东西逐个来，不靠「删掉 root 应该就干净了」：
           rAF 循环 · /state 轮询 · /balance 轮询 · 账本防抖写 · 每只宠的气泡淡出计时 · root 本身。 */
      return function stop() {
        stopped = true
        if (rafId) { try { cancelAnimationFrame(rafId) } catch (err) { /* 已取消 */ } rafId = 0 }
        clearInterval(stateTimer)
        clearInterval(balanceTimer)
        if (bondTimer !== null) { clearTimeout(bondTimer); bondTimer = null }
        for (const a of world.actors) {
          if (a.sayTimer) { clearTimeout(a.sayTimer); a.sayTimer = null }
        }
        try { root.remove() } catch (err) { /* 已被移除 */ }
      }
    }

    // 契约在工厂体**末尾**冻结：函数声明在装载期就提升到位，所有 const 表（含 §3.9 的 SCRIPTS / ADVANCE / LINES）
    // 到这里也已初始化；状态（bondState）是 let，函数体读的是**调用时**的值 —— readBond() 因此是实时快照。
    /** 取证探针：由 start() 回填。契约在**装载期**就冻结了（start() 还没跑），
     * 所以它只能通过这个晚绑定引用间接读到运行期状态 —— 直接写在契约里会 ReferenceError。 */
    let probe = null

    exports.__kylinContract = Object.freeze({
      ROUTE_PREFIX, ASSET, CLIPS, CLICKS, LOOPING, KINDS, BUSY_CLIP, BOND, BALANCE_TIERS, ANIM_EXT, qualified,
      INTENTS, TUNING,
      // V5：两张文案表 + 应和句也挂出来 —— 它们要能被跨 realm 单测逐字钉住，
      // 否则「代码里写了什么词」只能靠人读源码确认。
      LINES_STIMULUS, LINES_WORKING, ECHO_DONE,
      pairId, normalizeBondPair, applyBondEvents, tierOf, tierClip, balanceCue, curiosityOf,
      readBond, queueBondEvent,
      createMind, stepMind, unlocked, socialGate, chooseIntent,
      busyClipOf,
      pickDifferent,
      // deliverStimulus 是**唯一新增**的契约键（计划列的键里没有它）：计划 Step 3 把它定义在 start()
      // 内，跨 realm 单测够不到，而 Step 5 第 1 条要求「play 未被同步调用」有观测口。详见 §3.6 注释。
      deliverStimulus,
      createDirector, SCRIPTS, ADVANCE, LINES,
      // 只读取证出口（Task 6）：start() 完成前回 null，不回抛。
      directorState: () => (probe ? probe() : null),
    })

    /* V5b：**必须收 ctx 并注册 effect** —— 设置页关掉插件开关时，客户端模块系统会卸载本模块，
       它「removes the entry and waits for its asynchronous effects before evicting unused modules and styles」
       （dsh-client-modules/README.md:42「Live plugin composition」）。
       这是**存在性证明**，不是推测：本机 `@deepseek-ai/dsh-client-ui-trajectory` 与
       `dsh-client-ui-model-selection` 两个官方插件的 client 半边都收 ctx，且各注册 1 与 2 处 ctx.effect。
       不注册的后果就是你看到的样子：**开关关掉、桌宠不消失** —— 模块与样式都被驱逐了，
       而我们 append 到 body 上的 root 没人摘。 */
    /**
     * 槽位里的挂载点：**这棵树由宿主拥有**。
     * 插件被禁用 ⇒ 客户端模块系统驱逐本模块 ⇒ React 卸载它 ⇒ 我们 effect 的 cleanup 跑 ⇒ 桌宠当场
     * 消失。**不需要重启引擎、不需要刷新页面** —— 这正是「挂进槽位」相比「直挂 body」的全部意义：
     * 生命周期的负责人是宿主，不是我们。
     */
    function PetOverlay() {
      const React = require('react')
      React.useEffect(() => {
        // 槽位只提供**生死**（插件被禁用 → 本组件卸载 → 下面的清理跑 → 桌宠当场消失）；
        // 舞台本体必须 portal 到 body：槽位容器在应用自己的堆叠上下文里，z-index 写到
        // 2147483000 也会被后画的应用内容盖住（2026-10-11 实测 elementFromPoint 命中
        // 应用的 <p>，点击全被吃、拖拽全失效）。holder 的 add/remove 都在本组件手里，
        // 与 V5b 的「不许留孤儿」同一契约 —— 这是 portal，不是 V5b 之前的无人直挂。
        const holder = document.createElement('div')
        holder.style.position = 'fixed'
        holder.style.inset = '0'
        holder.style.pointerEvents = 'none'
        holder.style.zIndex = '2147483000'
        document.body.appendChild(holder)
        let stop = null
        let gone = false
        start(holder).then((fn) => {
          stop = fn
          // 启动是异步的（要读配置与账本）：若在它跑完之前就被卸载，得补收一次，
          // 否则「开关快速关了又开」会留下一个没有主的舞台。
          if (gone && fn) fn()
        }, (err) => console.warn('[dsh-kylin-pet] 启动失败：', err))
        return () => {
          gone = true
          if (stop) stop()
          holder.remove()
        }
      }, [])
      return null
    }

    exports.apply = (ctx) => {
      const slots = ctx && ctx.slots
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
        console.warn('[dsh-kylin-pet] 没有 slots 服务，舞台未启动')
        return
      }
      // 与官方 ui-plugin 模板同形：inject 包在 effect 里，注册本身也是可回收的。
      ctx.effect(() => slots.inject(SLOT_NAME, () => slots.register(
        { name: SLOT_NAME, id: 'dsh-kylin-pet', order: 1000, label: '麒麟仔与鲸鱼娘' },
        PetOverlay,
      )), 'dsh-kylin-pet slot @ ' + SLOT_NAME)
    }
    return exports
  },
})
