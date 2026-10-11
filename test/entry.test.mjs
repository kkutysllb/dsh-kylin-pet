import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { name, inject, apply, createHandler } from '../src/server/entry.js'
import { ROUTE_PREFIX } from '../src/shared/contract.js'
import { loadPetConfig } from '../src/server/pet-config.js'
import { createAssetResolver } from '../src/server/static-assets.js'
import { createBoard } from '../src/server/state.js'
import { installStimuli } from '../src/server/stimuli.js'

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
    // apply 现在还会装宿主事件订阅，真 ctx 必有 on —— V1 的假 ctx 漏了它。
    on: () => () => {},
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

/** 记录监听器、能按名派发的假 ctx（apply 与 installStimuli 都只用到 on）。 */
function fakeCtx() {
  const map = new Map()
  return {
    on(name, fn) {
      const list = map.get(name) || []
      list.push(fn)
      map.set(name, list)
      return () => {}
    },
    emit(name, payload, next) {
      const fns = map.get(name) || []
      return fns.length ? fns[0](payload, next) : undefined
    },
    listeners: (name) => (map.get(name) || []).length,
    webServer: { register: () => () => {} },
    effect: () => {},
    logger: { info: () => {} },
  }
}

/** 与 boot() 同一套装配，但把真板注进真 createHandler —— /state 与事件走同一条链。 */
async function bootWithBoard(board) {
  const home = '/nonexistent-home-for-test'
  const config = loadPetConfig({ home })
  const handler = createHandler({ config, resolveAsset: createAssetResolver({ config, home }), board })
  const server = createServer(handler)
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({
    server,
    base: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((done) => server.close(done)),
  })))
}

test('/state 起步查询：无 since 只报水位、不给历史', async () => {
  const app = await boot()
  try {
    const res = await fetch(app.base + ROUTE_PREFIX + '/state')
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await res.json(), { cursor: 0, stimuli: [] })
  } finally { await app.close() }
})

test('apply 装订阅：四个宿主事件各一个监听器', () => {
  const ctx = fakeCtx()
  apply(ctx)
  for (const name of ['agent/turn-stopping', 'agent/error', 'approval/request', 'user-questions/request']) {
    assert.equal(ctx.listeners(name), 1, name)
  }
})

test('apply 两次仍只有一个监听器（重复监听会让诱因翻倍）', () => {
  const ctx = fakeCtx()
  apply(ctx)
  apply(ctx)
  assert.equal(ctx.listeners('agent/turn-stopping'), 1)
  assert.equal(ctx.listeners('agent/error'), 1)
})

test('宿主事件 -> /state：agent/error 回一条 turn-fail', async () => {
  const board = createBoard()
  const ctx = fakeCtx()
  installStimuli(ctx, board)
  const app = await bootWithBoard(board)
  try {
    ctx.emit('agent/error', { agent: {}, turn: 1, step: 1, error: new Error('boom') })
    const body = await (await fetch(app.base + ROUTE_PREFIX + '/state?since=0')).json()
    assert.equal(body.cursor, 1)
    assert.equal(body.stimuli.length, 1)
    assert.equal(body.stimuli[0].seq, 1)
    assert.equal(body.stimuli[0].kind, 'turn-fail')
    assert.ok(body.stimuli[0].detail.includes('boom'), body.stimuli[0].detail)
  } finally { await app.close() }
})

test('since 水位：since=<cursor> 不再重复，非数字仍是起步查询', async () => {
  const board = createBoard()
  const ctx = fakeCtx()
  installStimuli(ctx, board)
  const app = await bootWithBoard(board)
  try {
    ctx.emit('agent/turn-stopping', { agent: {}, turn: 1, signal: null })
    const first = await (await fetch(app.base + ROUTE_PREFIX + '/state?since=0')).json()
    assert.equal(first.stimuli.length, 1)
    assert.equal(first.stimuli[0].kind, 'turn-ok')
    const seen = await (await fetch(app.base + ROUTE_PREFIX + '/state?since=' + first.cursor)).json()
    assert.equal(seen.cursor, first.cursor)
    assert.deepEqual(seen.stimuli, [])
    const restart = await (await fetch(app.base + ROUTE_PREFIX + '/state?since=abc')).json()
    assert.equal(restart.cursor, first.cursor, '起步查询只吞历史，水位照报')
    assert.deepEqual(restart.stimuli, [])
  } finally { await app.close() }
})

test('/state 的方法与未知路径：POST 405、未知兄弟路径 404', async () => {
  const app = await boot()
  try {
    assert.equal((await fetch(app.base + ROUTE_PREFIX + '/state', { method: 'POST' })).status, 405)
    assert.equal((await fetch(app.base + ROUTE_PREFIX + '/state/extra')).status, 404)
  } finally { await app.close() }
})
