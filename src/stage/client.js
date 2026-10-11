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
    const BOND_FLUSH_MS = 2000      // §4.5：客户端防抖 2s；host 是唯一写者，这里只排队
    const BALANCE_POLL_MS = 30000   // 余额变化慢、还要打外部网络：与 1s 的 /state 分开，频率低一点更礼貌
    /** 气泡文案（原创；client 私有 —— host 不消费，故不进 __kylinContract）。 */
    const LINES = Object.freeze({ 'turn-ok': '稳了', 'turn-fail': '让我想想', waiting: '在呢' })
    const ANIM_EXT = '.webm'
    const STAGE_ID = 'dsh-kylin-pet-stage'
    const DROP_DISTANCE = 120   // spec §8：拖到一起放下即触发一次近距离互动

    exports.inject = []
    // 函数声明在装载期就提升到位，所以契约能在这一行冻结它们；状态（bondState）是 let，
    // 函数体读的是**调用时**的值 —— readBond() 因此是实时快照，而不是加载时的副本。
    exports.__kylinContract = Object.freeze({
      ROUTE_PREFIX, ASSET, CLIPS, LOOPING, KINDS, BOND, BALANCE_TIERS, ANIM_EXT, qualified,
      pairId, normalizeBondPair, applyBondEvents, tierOf, tierClip, balanceCue, curiosityOf,
      readBond, queueBondEvent,
    })

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
          a.say(LINES[stimulus.kind])
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

    exports.apply = () => {
      start().catch((err) => console.warn('[dsh-kylin-pet] 启动失败：', err))
    }
    return exports
  },
})
