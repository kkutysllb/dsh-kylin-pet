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
