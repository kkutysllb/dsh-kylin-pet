import { createReadStream } from 'node:fs'
import { ROUTE_PREFIX } from '../shared/contract.js'
import { loadPetConfig } from './pet-config.js'
import { createBondStore, emptyLedger } from './bond.js'
import { readBalance, unavailable } from './ledger.js'
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

/** 账本事件很小，64KB 已是宽松上限；超了回 413（截断才是更坏的选择）。 */
const BODY_LIMIT = 64 * 1024

/**
 * 读一个 JSON body。返回 {ok:false} 表示**已经回过错误响应**（413/400），调用方直接收工。
 * 用结果对象而不是 null：body 恰好是 JSON `null` 时也走正常路径。
 */
function readJson(req, limit, res) {
  return new Promise((resolve) => {
    let size = 0
    let settled = false
    const chunks = []
    const fail = (status, error) => {
      if (settled) return
      settled = true
      sendJson(res, status, { error: error })
      req.resume()   // 已回错，剩下的 body 排空即可（别把连接吊死）
      resolve({ ok: false })
    }
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) { fail(413, 'body-too-large'); return }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      try { resolve({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }) }
      catch (err) { sendJson(res, 400, { error: 'invalid-json' }); resolve({ ok: false }) }
    })
    req.on('error', () => fail(400, 'invalid-json'))
  })
}

/** 路由表：与 client 的 URL 契约一一对应（§4.2）。 */
export function createHandler(opts) {
  const config = opts.config
  const resolveAsset = opts.resolveAsset
  // board 缺省 = 一块惰性空板：V1 的老调用方照旧可用，/state 回 { cursor: 0, stimuli: [] }。
  const board = opts.board || createBoard()
  // bond 缺省 = 不接账本：老调用方（V1/V2 的测试）不该有写用户真账本的机会。
  const bond = opts.bond || null
  // /balance 的凭据来自 ctx，在 apply 里绑定；缺省只报「没接凭据服务」，绝不凭空给数。
  const readBalanceImpl = opts.readBalanceImpl || (() => unavailable('no-credentials-service'))
  const castIds = config.cast.map((pet) => pet.id)

  /** PUT /bond：施加一批事件 -> 落盘 -> 回新账。没接账本回 501（能力在、只是没接，比 404 诚实）。 */
  function putBond(req, res) {
    if (!bond) {
      req.resume()
      return sendJson(res, 501, { error: 'bond-store-not-attached' })
    }
    return readJson(req, BODY_LIMIT, res).then((got) => {
      if (!got.ok) return
      const events = got.value && got.value.events
      if (!Array.isArray(events)) return sendJson(res, 400, { error: 'events-not-array' })
      bond.apply(events)
      return sendJson(res, 200, bond.snapshot())
    }).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'bond-put-failed' })
    })
  }

  return function handle(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    // 前缀路由可能给全路径，也可能给剩余段 —— 两条都吃
    const path = url.pathname.startsWith(ROUTE_PREFIX) ? url.pathname.slice(ROUTE_PREFIX.length) : url.pathname
    // PUT 只对 /bond 开放；别处（含 V1/V2 的老路径）仍是 405。
    if (req.method === 'PUT' && path === '/bond') return putBond(req, res)
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method-not-allowed' })
    if (path === '/health') return sendJson(res, 200, { ok: true, cast: castIds })
    if (path === '/config') return sendJson(res, 200, config)
    if (path === '/state') {
      // since 缺省/非数字 ⇒ 起步查询：只报水位，不给历史（新 client 不该响应加载前的诱因）。
      return sendJson(res, 200, { cursor: board.cursor, stimuli: board.since(url.searchParams.get('since')) })
    }
    if (path === '/bond') return sendJson(res, 200, bond ? bond.snapshot() : emptyLedger())
    if (path === '/balance') {
      // 探针是异步的（要打外部网络）：取不到余额回 unavailable 而不是 500 —— 那是正常状态，不是服务器故障。
      Promise.resolve().then(() => readBalanceImpl()).then(
        (body) => sendJson(res, 200, body),
        () => sendJson(res, 200, unavailable('no-credentials-service', 'probe threw')),
      )
      return
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
  const bond = createBondStore()
  const uninstall = installStimuli(ctx, board)
  // 凭据服务只在 ctx 上（branding 是编译期的，不 import 任何 @deepseek-ai/*）—— 这里把「怎么拿凭据」绑死。
  const readBalanceImpl = () => readBalance({ getCredentials: () => (ctx.get ? ctx.get('credentials') : undefined) })
  const handle = createHandler({ config, resolveAsset: createAssetResolver({ config }), board, bond, readBalanceImpl })
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: handle }),
    'dsh-kylin-pet routes @ ' + ROUTE_PREFIX,
  )
  ctx.effect(() => uninstall, 'dsh-kylin-pet stimuli @ ' + ROUTE_PREFIX)
  if (ctx.logger && ctx.logger.info) {
    ctx.logger.info('[dsh-kylin-pet] ' + config.cast.map((p) => p.id).join(' + ') + ' @ ' + ROUTE_PREFIX)
  }
}
