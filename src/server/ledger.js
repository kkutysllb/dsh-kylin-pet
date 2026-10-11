import { BALANCE_TIERS } from '../shared/contract.js'

/** 档位判定：字符串原样保留，数值只用于比较；解析不出有限数就 null（不猜）。 */
export function tierOf(total) {
  // 空串 / null 不是「余额 0」，是「取不到」。
  // 读成 0 会报「见底」—— 那是对用户说了我们并不知道的话（§11.7 不伪造）。
  if (total === null || total === undefined) return null
  if (typeof total === 'string' && total.trim() === '') return null
  const n = typeof total === 'string' ? Number(total.trim()) : Number(total)
  if (!Number.isFinite(n)) return null
  for (const entry of BALANCE_TIERS) if (n >= entry[1]) return entry[0]
  return BALANCE_TIERS[BALANCE_TIERS.length - 1][0]
}

export function unavailable(reason, detail, at) {
  return { kind: 'unavailable', reason: reason, detail: detail === undefined ? '' : String(detail), at: at }
}

/**
 * 从响应里挑出要用的那一条。多币种是真实存在的：
 * 优先 preferred，缺席就取首条，并把「我换了币种」写进 reason（不静默取 [0]）。
 */
export function pickBalanceInfo(payload, preferred) {
  const list = payload && Array.isArray(payload.balance_infos) ? payload.balance_infos : []
  if (list.length === 0) return { info: null, reason: 'no-balance-info' }
  const want = preferred || 'CNY'
  const hit = list.find((x) => x && x.currency === want)
  if (hit) return { info: hit, reason: null }
  const first = list.find((x) => x && typeof x.currency === 'string')
  if (!first) return { info: null, reason: 'shape-unrecognized' }
  return { info: first, reason: 'unsupported-currency' }
}

/**
 * 读一次余额。探针可注入 —— 否则测试里只能打真网络。
 * @param {{getCredentials?: () => any, fetchImpl?: Function, ref?: string, preferred?: string, now?: () => number}} opts
 */
export async function readBalance(opts = {}) {
  const now = opts.now || (() => Date.now())
  const at = now()
  const creds = typeof opts.getCredentials === 'function' ? opts.getCredentials() : undefined

  // ① 没有服务：这一层不需要网络，也不该花时间
  if (!creds || typeof creds.describe !== 'function') return unavailable('no-credentials-service', '', at)

  const ref = opts.ref || 'DEEPSEEK_API_KEY'
  let described
  try { described = await creds.describe(ref) } catch (err) {
    return unavailable('no-credentials-service', String(err && err.message), at)
  }
  // ② describe 是零成本前置判定：没配就别浪费一次网络往返
  if (!described || described.configured !== true) return unavailable('not-configured', ref, at)

  let got
  try { got = await creds.resolve(ref) } catch (err) {
    return unavailable('not-configured', String(err && err.message), at)
  }
  if (!got || typeof got.value !== 'string' || got.value.length === 0) return unavailable('not-configured', ref, at)

  // ③ 才轮到网络
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') return unavailable('network-error', 'no fetch available', at)
  let res
  try {
    res = await fetchImpl('https://api.deepseek.com/user/balance', {
      headers: { authorization: 'Bearer ' + got.value, accept: 'application/json' },
    })
  } catch (err) {
    return unavailable('network-error', String(err && err.message), at)
  }
  if (!res || res.status !== 200) return unavailable('http-error', 'HTTP ' + String(res && res.status), at)

  let payload
  try { payload = await res.json() } catch (err) { return unavailable('shape-unrecognized', 'not json', at) }
  const picked = pickBalanceInfo(payload, opts.preferred)
  if (!picked.info) return unavailable(picked.reason, '', at)

  const info = picked.info
  if (typeof info.total_balance !== 'string') {
    return unavailable('shape-unrecognized', 'total_balance 不是字符串', at)
  }
  return {
    kind: 'ok',
    currency: String(info.currency || ''),
    total: info.total_balance,                                       // 原样字符串，绝不数值化
    granted: typeof info.granted_balance === 'string' ? info.granted_balance : '',
    toppedUp: typeof info.topped_up_balance === 'string' ? info.topped_up_balance : '',
    tier: tierOf(info.total_balance),
    at: at,
    source: String(got.source || ''),
    note: picked.reason === 'unsupported-currency' ? '首选币种缺席，已取首条' : '',
  }
}
