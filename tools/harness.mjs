#!/usr/bin/env node
/**
 * dsh-kylin-pet 开发期验收台。
 * 用法: node tools/harness.mjs [端口]   默认 7391
 */
import { createReadStream, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { loadPetConfig } from '../src/server/pet-config.js'
import { createAssetResolver } from '../src/server/static-assets.js'
import { ROUTE_PREFIX } from '../src/shared/contract.js'

const NL = String.fromCharCode(10)
const port = Number(process.argv[2] || process.env.PORT || 7391)
const config = loadPetConfig()
const resolveAsset = createAssetResolver({ config })
const clientPath = new URL('../src/stage/client.js', import.meta.url)

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

const ASSET_RE = new RegExp('^' + ROUTE_PREFIX + '/(pet|memes)/([^/]+)/(.+)$')

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
  if (url.pathname === ROUTE_PREFIX + '/health' || url.pathname === ROUTE_PREFIX + '/config') {
    const body = url.pathname.endsWith('/health')
      ? { ok: true, cast: config.cast.map((p) => p.id) }
      : config
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    return res.end(JSON.stringify(body))
  }
  const m = ASSET_RE.exec(url.pathname)
  if (m) {
    const hit = resolveAsset(m[1], m[2], m[3])
    if (hit) {
      res.writeHead(200, { 'content-type': hit.mime, 'content-length': String(hit.size), 'cache-control': 'no-store' })
      return createReadStream(hit.path).pipe(res)
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('not found')
}).listen(port, '127.0.0.1', () => {
  console.log('harness: http://127.0.0.1:' + port)
  console.log('  cast: ' + config.cast.map((p) => p.id).join(', '))
})
