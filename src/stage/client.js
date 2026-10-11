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
