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
    const KINDS = Object.freeze(['turn-ok', 'turn-fail', 'waiting'])
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
      NEAR_RADIUS: 150,            // px：算「已经在旁边」
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
    const LINES_STIMULUS = Object.freeze({ 'turn-ok': '稳了', 'turn-fail': '让我想想', waiting: '在呢' })
    const ANIM_EXT = '.webm'
    const STAGE_ID = 'dsh-kylin-pet-stage'
    const DROP_DISTANCE = 120   // spec §8：拖到一起放下即触发一次近距离互动

    exports.inject = []

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
      const want = STATUS_OF[kind]
      const map = (config && config.directing && config.directing.workStatus) || {}
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
        facing: 1,
        clip: null,
        clipName: null,             // 当前实际素材名（余额档位要播指定那一段，不能随机）
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

      /** 播表现档；给了 exact 就播**那一段**素材（余额档位必须精确到「余额充裕」这类名字）。 */
      a.play = (clip, exact) => {
        if (!exact && a.clip === clip) return
        const chosen = exact || pick(CLIPS[clip], a.rng)
        if (a.clip === clip && a.clipName === chosen) return
        a.clip = clip
        a.clipName = chosen
        const url = animUrl(pet, chosen)
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

      a.layout = () => {
        const left = a.x - w / 2
        const top = a.y - h * ASSET.FOOT_RATIO
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
      let s = bond.affinity * W.affinity + bond.familiarity * W.familiarity
      if (candidate === 'comfort') s += Math.max(0, -other.mood) * 1.2      // 对方越难过越想安慰
      if (candidate === 'tease') s += Math.max(0, self.energy - 0.5) * 1.0
      if (candidate === 'shoulder') s += Math.max(0, bond.affinity) * 0.02
      if (candidate === 'approach') s += 0.5                                  // 靠近是社交的兜底
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
        stick([ev])                     // ← V3 的 queueBondEvent：防抖 + PUT /bond，**不在这里**
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

      /** 进入新阶段的一次性动作：播片 / 设朝向 / 放台词 / 起步。只在 sincePhase === 0 那一拍做。 */
      function enterPhase(spec, actorA, actorB) {
        if (spec.clip) {
          if (actorA) actorA.play(spec.clip)
          if (actorB && spec.clip === 'happy') actorB.play(spec.clip)
        }
        if (spec.facing === 'toward' && actorA && actorB) actorA.setFacing(actorB.x < actorA.x ? -1 : 1)
        if (spec.say) {
          const line = LINES[spec.say]
          if (line && actorA) actorA.say(typeof line === 'string' ? line : (line[actorA.pet.id] || line[actorB.pet.id] || ''))
        }
        if (spec.move === 'toward' && actorA && actorB) {
          const gap = ASSET.W * 0.28
          actorA.target = { x: actorB.x + (actorA.x <= actorB.x ? gap : -gap), y: actorB.y }
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
        if (duet.sincePhase === 0) enterPhase(spec, actorA, actorB)
        duet.sincePhase += dt
        const done = spec.until && ADVANCE[spec.until] ? ADVANCE[spec.until](duet, world) : true
        if (!done) return null
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
          const other = freePartner(a)
          const pick = chooseIntent(m, other ? minds[other.pet.id] : null, rng)
          events.push({ type: 'intent', pet: a.pet.id, intent: pick.intent, family: pick.family })
          if (pick.family !== 'social' || !other) { a.play(pick.intent === 'walk' ? 'walk' : pick.intent === 'nap' ? 'idle' : 'idle'); continue }
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

      /** 诱因 -> 播哪档（waiting 双方探头，只播 idle）。 */
      const CLIP_OF = { 'turn-ok': 'happy', 'turn-fail': 'sad', waiting: 'idle' }

      /** V2 占位：有资格就演。V3 起由 Mind 打分决定「要不要响应」——别把这里当最终形态。 */
      function react(stimulus) {
        if (!stimulus || KINDS.indexOf(stimulus.kind) < 0) return []
        const acted = []
        for (const id of qualified(stimulus.kind, opts.config)) {
          const a = actors.find((x) => x.pet.id === id)
          if (!a || a.held) continue
          a.say(LINES_STIMULUS[stimulus.kind])
          a.play(CLIP_OF[stimulus.kind])
          a.next = rand(2, 4)
          acted.push(id)
        }
        return acted
      }

      return { actors: actors, step: step, separate: separate, nearest: nearest, bump: bump, react: react, qualified: qualified, W: W, H: H }
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
      // §4.5：createWorld 之前先读账本（读不到就用 0/0 —— 降级不崩），bump 才接得上关系。
      const pairKey = pairId(config.cast[0].id, config.cast[1].id)
      bondState = Object.assign({ pairKey: pairKey }, normalizeBondPair(await loadBondPair(pairKey)))
      const root = createStageRoot()
      document.body.appendChild(root)
      const world = createWorld({ config: config, root: root })
      world.pairKey = pairKey
      wireGestures(world)
      let last = performance.now()
      const frame = (now) => {
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        if (!document.hidden) world.step(dt)   // spec R4：后台标签页不跑
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
      // 诱因轮询：1s 一拍（手调值，V4 需要再加配置项）。后台标签页照轮 —— 诱因不该因切标签丢掉。
      let since = null   // null = 还没学水位
      const poll = async () => {
        try {
          const q = since === null ? '' : '?since=' + since
          const res = await fetch(ROUTE_PREFIX + '/state' + q, { cache: 'no-store' })
          if (!res.ok) return
          const body = await res.json()
          const cur = Number(body && body.cursor)
          if (!Number.isFinite(cur)) return
          if (since !== null && cur < since) since = null      // host 重启：水位回退，重新起步
          for (const s of (body && body.stimuli) || []) world.react(s)
          since = cur
        } catch (err) { /* 宿主不在时静默：桌宠不该刷屏 */ }
      }
      setInterval(poll, 1000)
      poll()
      // 余额：30s 一读。档位变化才播；tier=null / kind='unavailable' 一律不播（不猜、不假装）。
      const pollBalance = async () => {
        try {
          const res = await fetch(ROUTE_PREFIX + '/balance', { cache: 'no-store' })
          if (!res.ok) return
          const entry = await res.json()
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
      setInterval(pollBalance, BALANCE_POLL_MS)
      pollBalance()
      console.info('[dsh-kylin-pet] 舞台已就绪：' + config.cast.map((p) => p.id).join(' + '))
    }

    // 契约在工厂体**末尾**冻结：函数声明在装载期就提升到位，所有 const 表（含 §3.9 的 SCRIPTS / ADVANCE / LINES）
    // 到这里也已初始化；状态（bondState）是 let，函数体读的是**调用时**的值 —— readBond() 因此是实时快照。
    exports.__kylinContract = Object.freeze({
      ROUTE_PREFIX, ASSET, CLIPS, LOOPING, KINDS, BOND, BALANCE_TIERS, ANIM_EXT, qualified,
      INTENTS, TUNING,
      pairId, normalizeBondPair, applyBondEvents, tierOf, tierClip, balanceCue, curiosityOf,
      readBond, queueBondEvent,
      createMind, stepMind, unlocked, socialGate, chooseIntent,
      createDirector, SCRIPTS, ADVANCE, LINES,
    })

    exports.apply = () => {
      start().catch((err) => console.warn('[dsh-kylin-pet] 启动失败：', err))
    }
    return exports
  },
})
