import { createReadStream } from 'node:fs'
import { ROUTE_PREFIX } from '../shared/contract.js'
import { loadPetConfig } from './pet-config.js'
import { createAssetResolver } from './static-assets.js'
import { createBoard } from './state.js'
import { installStimuli } from './stimuli.js'

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
  // board 缺省 = 一块惰性空板：V1 的老调用方照旧可用，/state 回 { cursor: 0, stimuli: [] }。
  const board = opts.board || createBoard()
  const castIds = config.cast.map((pet) => pet.id)
  return function handle(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    // 前缀路由可能给全路径，也可能给剩余段 —— 两条都吃
    const path = url.pathname.startsWith(ROUTE_PREFIX) ? url.pathname.slice(ROUTE_PREFIX.length) : url.pathname
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method-not-allowed' })
    if (path === '/health') return sendJson(res, 200, { ok: true, cast: castIds })
    if (path === '/config') return sendJson(res, 200, config)
    if (path === '/state') {
      // since 缺省/非数字 ⇒ 起步查询：只报水位，不给历史（新 client 不该响应加载前的诱因）。
      return sendJson(res, 200, { cursor: board.cursor, stimuli: board.since(url.searchParams.get('since')) })
    }
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

/**
 * 同一 ctx 上重复 apply（cordis 重载会再来一次）不得把监听器翻倍：
 * ctx.on 没有「重复即替换」语义，多出来的监听器会让每条诱因产两次 —— 比路由重复注册隐蔽得多。
 */
const applied = new WeakSet()

/** cordis 入口：注册一次前缀路由，disposer 交给 ctx.effect 管。 */
export function apply(ctx) {
  if (applied.has(ctx)) return
  applied.add(ctx)
  const config = loadPetConfig()
  const board = createBoard()
  const uninstall = installStimuli(ctx, board)
  const handle = createHandler({ config, resolveAsset: createAssetResolver({ config }), board })
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: handle }),
    'dsh-kylin-pet routes @ ' + ROUTE_PREFIX,
  )
  ctx.effect(() => uninstall, 'dsh-kylin-pet stimuli @ ' + ROUTE_PREFIX)
  if (ctx.logger && ctx.logger.info) {
    ctx.logger.info('[dsh-kylin-pet] ' + config.cast.map((p) => p.id).join(' + ') + ' @ ' + ROUTE_PREFIX)
  }
}
