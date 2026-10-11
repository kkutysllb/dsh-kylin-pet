import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { name, inject, apply, createHandler } from '../src/server/entry.js'
import { ROUTE_PREFIX } from '../src/shared/contract.js'
import { loadPetConfig } from '../src/server/pet-config.js'
import { createAssetResolver } from '../src/server/static-assets.js'

function boot() {
  // 两处都钉同一个不存在的 home：**只有包内素材**，测试才是密闭的。
  // （原先只钉了配置层，素材解析层落到真实 $DSH_HOME —— 于是这条「真素材」测试
  //   在本机取到的是用户目录素材，而不是它声称要验的包内素材。）
  const home = '/nonexistent-home-for-test'
  const config = loadPetConfig({ home })
  const handler = createHandler({ config, resolveAsset: createAssetResolver({ config, home }) })
  const server = createServer(handler)
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({
    server,
    base: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((done) => server.close(done)),
  })))
}

test('插件契约三件套', () => {
  assert.equal(name, 'dsh-kylin-pet')
  assert.deepEqual(inject, ['webServer'])
  assert.equal(typeof apply, 'function')
})

test('apply 注册一条前缀路由，disposer 交给 effect 管', () => {
  const registered = []
  const effects = []
  const ctx = {
    webServer: { register: (r) => { registered.push(r); return () => {} } },
    effect: (fn, label) => { effects.push(label); return fn() },
    logger: { info: () => {} },
  }
  apply(ctx)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].kind, 'prefix')
  assert.equal(registered[0].path, ROUTE_PREFIX)
  assert.equal(typeof registered[0].handler, 'function')
  assert.match(effects[0], /dsh-kylin-pet/)
})

test('/health 与 /config', async () => {
  const app = await boot()
  try {
    const health = await fetch(app.base + ROUTE_PREFIX + '/health')
    assert.equal(health.status, 200)
    assert.deepEqual((await health.json()).cast, ['kylinzi', 'xisha'])
    const cfg = await fetch(app.base + ROUTE_PREFIX + '/config')
    assert.equal(cfg.headers.get('cache-control'), 'no-store')
    assert.deepEqual((await cfg.json()).cast.map((p) => p.id), ['kylinzi', 'xisha'])
  } finally { await app.close() }
})

test('真素材：中文名 URL 往返 + content-type + 非空 body', async () => {
  const app = await boot()
  try {
    for (const pet of ['kylinzi', 'xisha']) {
      const url = app.base + ROUTE_PREFIX + '/pet/' + pet + '/' + encodeURIComponent('待机.webm')
      const res = await fetch(url)
      assert.equal(res.status, 200, url)
      assert.equal(res.headers.get('content-type'), 'video/webm')
      const buf = Buffer.from(await res.arrayBuffer())
      assert.ok(buf.length > 10000, '素材不该是空壳：' + buf.length)
      assert.equal(buf.subarray(0, 4).toString('hex'), '1a45dfa3', 'EBML 魔数')
    }
  } finally { await app.close() }
})

test('404 / 405 / 越权', async () => {
  const app = await boot()
  try {
    assert.equal((await fetch(app.base + ROUTE_PREFIX + '/pet/nobody/' + encodeURIComponent('待机.webm'))).status, 404)
    assert.equal((await fetch(app.base + ROUTE_PREFIX + '/pet/kylinzi/' + encodeURIComponent('../../etc/passwd'))).status, 404)
    assert.equal((await fetch(app.base + ROUTE_PREFIX + '/nope')).status, 404)
    assert.equal((await fetch(app.base + ROUTE_PREFIX + '/health', { method: 'POST' })).status, 405)
  } finally { await app.close() }
})
