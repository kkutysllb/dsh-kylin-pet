import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { name, inject, apply, createHandler } from '../src/server/entry.js'
import { ROUTE_PREFIX } from '../src/shared/contract.js'
import { loadPetConfig } from '../src/server/pet-config.js'
import { createAssetResolver } from '../src/server/static-assets.js'
import { createBoard } from '../src/server/state.js'
import { installStimuli } from '../src/server/stimuli.js'
import { createBondStore } from '../src/server/bond.js'
import { unavailable } from '../src/server/ledger.js'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

// ---------------------------------------------------------------------------
// V3：/bond（GET+PUT）与 /balance。上面 V1/V2 的断言一字未改，这里只追加。
// ---------------------------------------------------------------------------

/** 与 boot() 同一套装配，外加 V3 的可注入面（bond / readBalanceImpl）。 */
async function bootWith(extra) {
  const home = '/nonexistent-home-for-test'
  const config = loadPetConfig({ home })
  const handler = createHandler({ config, resolveAsset: createAssetResolver({ config, home }), ...extra })
  const server = createServer(handler)
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({
    server,
    base: 'http://127.0.0.1:' + server.address().port,
    close: () => new Promise((done) => server.close(done)),
  })))
}

/** 一次性临时目录：用来证明「真账本有没有被碰」。 */
function tmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'kylin-bond-'))
  return { dir: dir, path: join(dir, 'bond.json'), ledgerPath: join(dir, 'dsh-kylin-pet', 'bond.json') }
}

/** 换一个 DSH_HOME 跑（apply 按 dshHome() 建账本句柄，测试必须隔离它）。 */
async function withHome(home, fn) {
  const saved = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try { return await fn() } finally {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  }
}

test('/bond 缺省 handler：GET 回空账、PUT 回 501，且不在 DSH_HOME 建真账本', async () => {
  const t = tmpDir()
  try {
    await withHome(t.dir, async () => {
      const app = await boot()
      try {
        const url = app.base + ROUTE_PREFIX + '/bond'
        const got = await fetch(url)
        assert.equal(got.status, 200)
        assert.deepEqual(await got.json(), { version: 1, pairs: {} })
        const put = await fetch(url, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ events: [{ pair: 'kylinzi|xisha', kind: 'bump', affinityDelta: 2, familiarityDelta: 1 }] }),
        })
        assert.equal(put.status, 501, '缺省 handler 不该偷偷接上账本')
        assert.deepEqual(await put.json(), { error: 'bond-store-not-attached' })
        // 只看状态码不够：真账本文件（含目录）必须一个都没被创建
        assert.equal(existsSync(t.ledgerPath), false, '缺省 handler 不该写 DSH_HOME 下的真账本')
        assert.deepEqual(readdirSync(t.dir), [], 'DSH_HOME 下不该出现任何东西')
      } finally { await app.close() }
    })
  } finally { rmSync(t.dir, { recursive: true, force: true }) }
})

test('注入账本：PUT /bond 施加一笔、原子落盘，GET 读回同一笔', async () => {
  const t = tmpDir()
  const bond = createBondStore({ path: t.path, now: () => 1000 })
  const app = await bootWith({ bond })
  try {
    const url = app.base + ROUTE_PREFIX + '/bond'
    assert.deepEqual(await (await fetch(url)).json(), { version: 1, pairs: {} })
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ pair: 'kylinzi|xisha', kind: 'bump', affinityDelta: 2, familiarityDelta: 1 }] }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.pairs['kylinzi|xisha'].affinity, 2)
    assert.equal(body.pairs['kylinzi|xisha'].familiarity, 1)
    assert.equal(body.pairs['kylinzi|xisha'].lastAt, 1000)
    assert.equal(body.pairs['kylinzi|xisha'].history.length, 1)
    // 落盘证明：另起一个 store 从同一路径读回（不是同一个内存对象）
    assert.equal(createBondStore({ path: t.path }).snapshot().pairs['kylinzi|xisha'].affinity, 2)
    // 再 GET 一次仍是 2
    const again = await (await fetch(url)).json()
    assert.equal(again.pairs['kylinzi|xisha'].affinity, 2)
    assert.equal(again.pairs['kylinzi|xisha'].familiarity, 1)
    // events 空数组合法（防抖后可能无事可报）：照回当前账
    const empty = await fetch(url, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [] }),
    })
    assert.equal(empty.status, 200)
    assert.equal((await empty.json()).pairs['kylinzi|xisha'].affinity, 2)
  } finally { await app.close(); rmSync(t.dir, { recursive: true, force: true }) }
})

test('PUT /bond：body 非 JSON -> 400，账本一字未动', async () => {
  const t = tmpDir()
  const bond = createBondStore({ path: t.path })
  const app = await bootWith({ bond })
  try {
    const res = await fetch(app.base + ROUTE_PREFIX + '/bond', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{ 这不是 json',
    })
    assert.equal(res.status, 400)
    assert.deepEqual(await res.json(), { error: 'invalid-json' })
    assert.deepEqual(bond.snapshot(), { version: 1, pairs: {} })
    assert.equal(existsSync(t.path), false, '解析失败不该落盘')
  } finally { await app.close(); rmSync(t.dir, { recursive: true, force: true }) }
})

test('PUT /bond：events 不是数组 -> 400（缺字段 / 字符串 / 对象 / null 都算）', async () => {
  const t = tmpDir()
  const bond = createBondStore({ path: t.path })
  const app = await bootWith({ bond })
  try {
    const url = app.base + ROUTE_PREFIX + '/bond'
    for (const body of [{}, { events: 'nope' }, { events: {} }, null]) {
      const res = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      assert.equal(res.status, 400, JSON.stringify(body))
      assert.deepEqual(await res.json(), { error: 'events-not-array' })
    }
    assert.deepEqual(bond.snapshot(), { version: 1, pairs: {} })
    assert.equal(existsSync(t.path), false)
  } finally { await app.close(); rmSync(t.dir, { recursive: true, force: true }) }
})

test('PUT /bond：body 超 64KB -> 413（不截断、不落盘）', async () => {
  const t = tmpDir()
  const bond = createBondStore({ path: t.path })
  const app = await bootWith({ bond })
  try {
    const big = JSON.stringify({ events: [{ pair: 'kylinzi|xisha', affinityDelta: 1, pad: 'x'.repeat(70 * 1024) }] })
    assert.ok(Buffer.byteLength(big) > 64 * 1024)
    const res = await fetch(app.base + ROUTE_PREFIX + '/bond', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: big,
    })
    assert.equal(res.status, 413)
    assert.deepEqual(await res.json(), { error: 'body-too-large' })
    assert.deepEqual(bond.snapshot(), { version: 1, pairs: {} })
    assert.equal(existsSync(t.path), false)
  } finally { await app.close(); rmSync(t.dir, { recursive: true, force: true }) }
})

test('GET /balance：探针说 not-configured -> 200 + unavailable，响应体里一个数字都没有', async () => {
  const app = await bootWith({ readBalanceImpl: async () => unavailable('not-configured', 'DEEPSEEK_API_KEY', 5) })
  try {
    const res = await fetch(app.base + ROUTE_PREFIX + '/balance')
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.kind, 'unavailable')
    assert.equal(body.reason, 'not-configured')
    assert.equal(body.detail, 'DEEPSEEK_API_KEY')
    assert.equal(body.at, 5)
    assert.deepEqual(Object.keys(body).sort(), ['at', 'detail', 'kind', 'reason'])
    assert.ok(!('total' in body) && !('tier' in body), '降级响应里不许凭空出现数字')
  } finally { await app.close() }
})

test('老路径零回归：/health、POST /state 405、未知路径 404，PUT 只在 /bond 上开', async () => {
  const app = await boot()
  try {
    const health = await fetch(app.base + ROUTE_PREFIX + '/health')
    assert.equal(health.status, 200)
    assert.deepEqual((await health.json()).cast, ['kylinzi', 'xisha'])
    assert.equal((await fetch(app.base + ROUTE_PREFIX + '/state', { method: 'POST' })).status, 405)
    assert.equal((await fetch(app.base + ROUTE_PREFIX + '/nope')).status, 404)
    assert.equal((await fetch(app.base + ROUTE_PREFIX + '/state', { method: 'PUT' })).status, 405)
    assert.equal((await fetch(app.base + ROUTE_PREFIX + '/nope', { method: 'PUT' })).status, 405)
  } finally { await app.close() }
})

test('apply 之后 /balance 绑上 ctx 凭据：回 unavailable 而不是 500', async () => {
  const t = tmpDir()
  try {
    await withHome(t.dir, async () => {
      const registered = []
      const ctx = {
        on: () => () => {},
        get: () => undefined,            // 这台 ctx 上没有 credentials 服务
        webServer: { register: (r) => { registered.push(r); return () => {} } },
        effect: (fn) => fn(),
        logger: { info: () => {} },
      }
      apply(ctx)
      assert.equal(registered.length, 1)
      const app = await new Promise((ok) => {
        const server = createServer(registered[0].handler)
        server.listen(0, '127.0.0.1', () => ok({
          base: 'http://127.0.0.1:' + server.address().port,
          close: () => new Promise((done) => server.close(done)),
        }))
      })
      try {
        const res = await fetch(app.base + ROUTE_PREFIX + '/balance')
        assert.equal(res.status, 200, '取不到余额是正常状态，不是 500')
        const body = await res.json()
        assert.equal(body.kind, 'unavailable')
        assert.equal(body.reason, 'no-credentials-service')
        // apply 同时把真账本句柄接上了（GET 可用）
        const bond = await fetch(app.base + ROUTE_PREFIX + '/bond')
        assert.equal(bond.status, 200)
        assert.deepEqual(await bond.json(), { version: 1, pairs: {} })
      } finally { await app.close() }
    })
  } finally { rmSync(t.dir, { recursive: true, force: true }) }
})

test('/pet：commands 服务在时注册一次；缺席时不抛（优雅降级，不是硬依赖）', () => {
  const registered = []
  const makeCtx = (withCommands) => ({
    on: () => () => {},
    webServer: { register: () => () => {} },
    effect: (fn) => fn(),
    logger: { info: () => {} },
    get: (n) => (withCommands && n === 'commands' ? { register: (d) => { registered.push(d); return () => {} } } : undefined),
  })
  apply(makeCtx(true))
  assert.equal(registered.length, 1, '有 commands 时必须注册一次')
  assert.equal(registered[0].name, 'pet')
  assert.equal(typeof registered[0].handler, 'function')
  // status 是**只读**的：只断言形状，不断言内容 ——
  // apply 里的 bond 用的是真实家目录路径（V3 起就是这样），断言内容会依赖用户真账本。
  const out = registered[0].handler({ rawInput: 'status' })
  assert.equal(typeof out.text, 'string')
  // ⚠️ 刻意**不测** handler({rawInput:'reset'})：那会清掉用户真实的 bond.json。
  // reset 的逻辑在 test/bond.test.mjs 里用临时路径单独测（那才是真正的承重点）。
  // 缺席时必须优雅降级：不抛、不注册，插件其余功能照常。
  assert.doesNotThrow(() => apply(makeCtx(false)))
  assert.equal(registered.length, 1, '缺席时不该再注册')
})


test('/pet 探针：logger 在时会报「apply 时 commands 在不在」（这是真机上唯一的观测窗口）', () => {
  const lines = []
  const makeCtx = (cmd) => ({
    on: () => () => {},
    webServer: { register: () => () => {} },
    effect: (fn) => fn(),
    logger: { info: (m) => lines.push(m) },
    get: (n) => (n === 'commands' ? cmd : undefined),
  })
  apply(makeCtx(undefined))
  assert.ok(lines.some((l) => l.indexOf('commands service at apply: false') >= 0), '缺席时要报 false')
  lines.length = 0
  apply(makeCtx({ register: () => () => {} }))
  assert.ok(lines.some((l) => l.indexOf('commands service at apply: true') >= 0), '在时要报 true')
  // 这行**刻意保留**：`ctx.logger.info` 在真引擎里不走 stdout（2026-10-11 实测探针 home 也搜不到），
  // 但它仍是唯一能把「服务就绪时机」带出来的通道 —— 用户的引擎若把它落到日志文件，就能读到。
})

