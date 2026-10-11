import test from 'node:test'
import assert from 'node:assert/strict'
import { readBalance, tierOf } from '../src/server/ledger.js'

/** 只给「已配好凭据」的服务对象：describe 回 configured，resolve 回真 key。 */
function creds(over = {}) {
  return {
    describe: async () => ({ configured: true, source: 'file', writable: false }),
    resolve: async () => ({ value: 'sk-test', source: 'file' }),
    ...over,
  }
}

/** 200 + 给定 payload 的假 fetch（可顺带记下这次调用）。 */
function fetchOk(payload, seen) {
  return async (url, init) => {
    if (seen) { seen.url = url; seen.init = init }
    return { status: 200, json: async () => payload }
  }
}

test('没有 credentials 服务 → no-credentials-service（不花网络、不抛）', async () => {
  const a = await readBalance({ now: () => 11 })
  assert.equal(a.kind, 'unavailable')
  assert.equal(a.reason, 'no-credentials-service')
  assert.equal(a.at, 11)
  // 有对象但没有 describe 方法，是同一件事（服务没接上）
  const b = await readBalance({ getCredentials: () => ({}), now: () => 11 })
  assert.equal(b.kind, 'unavailable')
  assert.equal(b.reason, 'no-credentials-service')
})

test('describe 回未配置 → not-configured，且 fetch 一次都没被调用', async () => {
  let calls = 0
  const res = await readBalance({
    getCredentials: () => creds({
      describe: async () => ({ configured: false, source: 'none', writable: false }),
      resolve: async () => { throw new Error('不该走到 resolve') },
    }),
    fetchImpl: async () => { calls++; throw new Error('不该打网络') },
    now: () => 7,
  })
  assert.equal(res.kind, 'unavailable')
  assert.equal(res.reason, 'not-configured')
  assert.equal(res.detail, 'DEEPSEEK_API_KEY')
  assert.equal(res.at, 7)
  assert.equal(calls, 0, '未配置时必须零网络往返（describe 是零成本前置判定）')
})

test('resolve 回 undefined / 空串 → not-configured（同样零网络）', async () => {
  let calls = 0
  const fetchImpl = async () => { calls++; return { status: 200, json: async () => ({}) } }
  const undef = await readBalance({ getCredentials: () => creds({ resolve: async () => undefined }), fetchImpl })
  assert.equal(undef.kind, 'unavailable')
  assert.equal(undef.reason, 'not-configured')
  const empty = await readBalance({ getCredentials: () => creds({ resolve: async () => ({ value: '' }) }), fetchImpl })
  assert.equal(empty.reason, 'not-configured')
  assert.equal(calls, 0)
})

test('fetch 抛错 → network-error，detail 是原始消息', async () => {
  const res = await readBalance({
    getCredentials: () => creds(),
    fetchImpl: async () => { throw new Error('boom-net') },
    now: () => 3,
  })
  assert.equal(res.kind, 'unavailable')
  assert.equal(res.reason, 'network-error')
  assert.equal(res.detail, 'boom-net')
})

test('HTTP 401 → http-error，detail 含 401', async () => {
  const res = await readBalance({
    getCredentials: () => creds(),
    fetchImpl: async () => ({ status: 401, json: async () => ({}) }),
  })
  assert.equal(res.kind, 'unavailable')
  assert.equal(res.reason, 'http-error')
  assert.match(res.detail, /401/)
})

test('形状不认识 / 没有条目 / total 不是字符串 → 三种 reason 各自命中', async () => {
  const notJson = await readBalance({
    getCredentials: () => creds(),
    fetchImpl: async () => ({ status: 200, json: async () => { throw new Error('not json') } }),
  })
  assert.equal(notJson.reason, 'shape-unrecognized')
  assert.equal(notJson.detail, 'not json')

  const none = await readBalance({
    getCredentials: () => creds(),
    fetchImpl: fetchOk({ is_available: true, balance_infos: [] }),
  })
  assert.equal(none.reason, 'no-balance-info')

  const notStr = await readBalance({
    getCredentials: () => creds(),
    fetchImpl: fetchOk({ balance_infos: [{ currency: 'CNY', total_balance: 110 }] }),
  })
  assert.equal(notStr.reason, 'shape-unrecognized')
  assert.equal(notStr.detail, 'total_balance 不是字符串')

  // 连一条带 currency 字符串的条目都没有 -> 形状不认识（不是「换币种」）
  const noCur = await readBalance({
    getCredentials: () => creds(),
    fetchImpl: fetchOk({ balance_infos: [{ total_balance: '1.00' }] }),
  })
  assert.equal(noCur.reason, 'shape-unrecognized')
})

test('正常路径：total 原样保真（字符串，不是数字），tier 由它算出', async () => {
  const seen = {}
  const payload = {
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }],
  }
  const res = await readBalance({ getCredentials: () => creds(), fetchImpl: fetchOk(payload, seen), now: () => 42 })
  assert.equal(res.kind, 'ok')
  assert.equal(res.total, '110.00')
  assert.equal(typeof res.total, 'string', '余额必须原样保留接口给的字符串，不做数值化')
  assert.equal(res.granted, '10.00')
  assert.equal(res.toppedUp, '100.00')
  assert.equal(res.currency, 'CNY')
  assert.equal(res.tier, '充裕')
  assert.equal(res.at, 42)
  assert.equal(res.source, 'file')
  assert.equal(res.note, '')
  assert.equal(seen.url, 'https://api.deepseek.com/user/balance')
  assert.equal(seen.init.headers.authorization, 'Bearer sk-test')
})

test('多币种：首选缺席时取首条并把「换了币种」写进 note，tier 仍按 total 算', async () => {
  const res = await readBalance({
    getCredentials: () => creds(),
    fetchImpl: fetchOk({ balance_infos: [{ currency: 'USD', total_balance: '3.50' }] }),
    now: () => 1,
  })
  assert.equal(res.kind, 'ok')
  assert.equal(res.currency, 'USD')
  assert.equal(res.note, '首选币种缺席，已取首条')
  assert.equal(res.tier, '告急')
  assert.equal(res.granted, '')
  assert.equal(res.toppedUp, '')
  // preferred 命中时不换、note 为空
  const cny = await readBalance({
    getCredentials: () => creds(),
    preferred: 'CNY',
    fetchImpl: fetchOk({ balance_infos: [{ currency: 'CNY', total_balance: '7.00' }] }),
  })
  assert.equal(cny.currency, 'CNY')
  assert.equal(cny.note, '')
  assert.equal(cny.tier, '偏低')
})

test('tierOf 边界：解析不出有限数一律 null（不猜档位）', () => {
  assert.equal(tierOf('100'), '充裕')
  assert.equal(tierOf('99.99'), '健康')
  assert.equal(tierOf('0'), '见底')
  assert.equal(tierOf('abc'), null)
  assert.equal(tierOf(undefined), null)
  assert.equal(tierOf(NaN), null)
  // ⚠️ 与计划文本不符，见报告 D1：计划 Step 2 第 8 条写「''→null」，
  // 但计划 Step 1 的实现是 Number(''.trim()) === 0 —— 有限数，所以实测是「见底」。
  // 实现逐字照抄未动，这里按实测断言，矛盾交 Lead 裁决。
  assert.equal(tierOf(''), null)          // 空串是「取不到」，不是「余额 0」
  assert.equal(tierOf(null), null)
})
