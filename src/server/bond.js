import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BOND } from '../shared/contract.js'
import { dshHome } from './pet-config.js'

/** 同一对宠永远同一个键：排序后拼接，与谁先发起无关。 */
export function pairId(a, b) {
  return [String(a), String(b)].sort().join(BOND.PAIR_SEP)
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback)

/** 把任意输入整形为合法的一对记录。永不抛 —— 坏数据只该降级，不该让桌宠起不来。 */
export function normalizePair(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const history = Array.isArray(src.history) ? src.history.slice(-BOND.HISTORY_MAX) : []
  return {
    affinity: clamp(num(src.affinity, 0), BOND.AFFINITY_MIN, BOND.AFFINITY_MAX),
    familiarity: Math.max(0, num(src.familiarity, 0)),
    lastAt: Math.max(0, num(src.lastAt, 0)),
    history: history,
  }
}

/** 空账本。 */
export function emptyLedger() {
  return { version: 1, pairs: {} }
}

/**
 * 建一个账本句柄。
 * @param {{path?: string, home?: string, now?: () => number}} [opts]
 */
export function createBondStore(opts = {}) {
  const path = opts.path || join(opts.home || dshHome(), 'dsh-kylin-pet', 'bond.json')
  const now = opts.now || (() => Date.now())
  const warnings = []
  let ledger = emptyLedger()
  let suspect = false

  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      if (parsed && typeof parsed === 'object' && parsed.pairs && typeof parsed.pairs === 'object') {
        ledger = { version: num(parsed.version, 1), pairs: {} }
        for (const key of Object.keys(parsed.pairs)) ledger.pairs[key] = normalizePair(parsed.pairs[key])
      } else {
        suspect = true
        warnings.push('bond.json 形状不认识，已按空账本启动（原文件未改动）')
      }
    } catch (err) {
      suspect = true
      warnings.push('bond.json 解析失败，已按空账本启动（原文件未改动）：' + String(err && err.message))
    }
  }

  /** 落盘：先写 tmp 再 rename —— 崩在中间不会留下半截 JSON。 */
  function flush() {
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = path + '.tmp'
    writeFileSync(tmp, JSON.stringify(ledger, null, 2))
    renameSync(tmp, path)
  }

  /**
   * 施加一批事件。**这是账本唯一的写入口**（spec §6：剧本不得自己写账本）。
   * @param {Array<{pair: string, kind?: string, affinityDelta?: number, familiarityDelta?: number, at?: number}>} events
   */
  function apply(events) {
    const list = Array.isArray(events) ? events : []
    for (const ev of list) {
      const key = String((ev && ev.pair) || '')
      if (!key) continue
      const prev = normalizePair(ledger.pairs[key])
      const dA = num(ev && ev.affinityDelta, 0)
      const dF = num(ev && ev.familiarityDelta, 0)
      const at = num(ev && ev.at, now())
      ledger.pairs[key] = {
        affinity: clamp(prev.affinity + dA, BOND.AFFINITY_MIN, BOND.AFFINITY_MAX),
        familiarity: Math.max(0, prev.familiarity + Math.max(0, dF)),  // 只增：负增量被丢弃
        lastAt: Math.max(prev.lastAt, at),
        history: prev.history.concat([{
          kind: String((ev && ev.kind) || 'unknown'),
          at: at,
          affinityDelta: dA,
          familiarityDelta: dF,
        }]).slice(-BOND.HISTORY_MAX),
      }
    }
    // 坏文件未被覆盖时：第一批写入前先把坏文件留个底，别让 flush 直接盖掉它
    if (list.length && suspect) {
      try { renameSync(path, path + '.suspect') } catch (err) { /* 留底失败不阻断写入 */ }
      suspect = false
    }
    if (list.length) flush()
    return ledger
  }

  /**
   * 清空账本并落盘。**走同一个 flush 路径** —— 不另写一份写文件逻辑，
   * 否则「重置」会绕开原子写（tmp + rename）与目录创建，成为唯一的非原子写入口。
   * 这是「关系重置」的可执行入口；另一条路是直接删文件后重启（README 有写）。
   */
  function reset() {
    ledger = emptyLedger()
    suspect = false
    flush()
    return JSON.parse(JSON.stringify(ledger))
  }

  return {
    path: path,
    get ledger() { return ledger },
    get warnings() { return warnings.slice() },
    apply: apply,
    reset: reset,
    /** 只读快照（HTTP 响应直接用它）。 */
    snapshot() { return JSON.parse(JSON.stringify(ledger)) },
  }
}
