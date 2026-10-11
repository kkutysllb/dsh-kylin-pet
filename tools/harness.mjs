#!/usr/bin/env node
/**
 * dsh-kylin-pet 开发期验收台。
 * 用法: node tools/harness.mjs [端口]   默认 7391
 *
 * V2 起的职责：让「真宿主事件 → 诱因 → client 响应」这条链在真浏览器里可复现。
 * 关键取舍：**前缀路由一律交给真的 createHandler**（不是这里另写一份），
 * 于是 harness 与生产走的是同一段路由代码，只差一个 DSH webServer。
 */
import { createReadStream, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { loadPetConfig } from '../src/server/pet-config.js'
import { createAssetResolver } from '../src/server/static-assets.js'
import { createHandler } from '../src/server/entry.js'
import { createBoard } from '../src/server/state.js'
import { installStimuli } from '../src/server/stimuli.js'
import { ROUTE_PREFIX } from '../src/shared/contract.js'

const NL = String.fromCharCode(10)
const port = Number(process.argv[2] || process.env.PORT || 7391)
const config = loadPetConfig()
const resolveAsset = createAssetResolver({ config })
const clientPath = new URL('../src/stage/client.js', import.meta.url)

/* ---- 诱因面：板子 + 假 ctx ----------------------------------------------
 * 假 ctx 只实现 on()，把监听器按事件名登记下来；/__emit 再按名字派发。
 * 这样「注入一个真事件名」走的是**真 installStimuli 的映射代码**，
 * 而不是在 harness 里手搓一条诱因。
 */
const board = createBoard()
const listeners = new Map()
const fakeCtx = {
  on(name, fn) {
    const list = listeners.get(name) || []
    list.push(fn)
    listeners.set(name, list)
    return () => { listeners.set(name, (listeners.get(name) || []).filter((f) => f !== fn)) }
  },
}
installStimuli(fakeCtx, board)

function payloadFor(name) {
  if (name === 'agent/error') {
    const err = new Error('harness injected failure')
    err.name = 'InjectedFailure'
    return { error: err }
  }
  return {}
}

/**
 * ⚠️ 开发期后门，**只存在于 harness**：entry.js 里没有它，生产路径也没有。
 * 它按事件名把真监听器派发一次（waterfall 给一个计数 next），用于取证。
 */
function emitHost(name) {
  const fns = listeners.get(name) || []
  let relayed = 0
  for (const fn of fns) fn(payloadFor(name), () => { relayed += 1 })
  return { name: name, listeners: fns.length, relayed: relayed }
}

/* ---- 前缀路由：真 handler ------------------------------------------------ */
const handler = createHandler({ config, resolveAsset, board })

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

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text)),
    'cache-control': 'no-store',
  })
  res.end(text)
}

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
  if (url.pathname === '/__emit') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
    const name = url.searchParams.get('name') || ''
    return sendJson(res, 200, emitHost(name))
  }
  // 其余（/health /config /state /pet/** /memes/**）一律走真 handler
  if (url.pathname === ROUTE_PREFIX || url.pathname.startsWith(ROUTE_PREFIX + '/')) {
    return handler(req, res)
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
}).listen(port, '127.0.0.1', () => {
  console.log('harness: http://127.0.0.1:' + port)
  console.log('  cast: ' + config.cast.map((p) => p.id).join(', '))
  console.log('  events: ' + [...listeners.keys()].join(', '))
})
