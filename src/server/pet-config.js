import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 包根（src/server/ 上两级）。 */
export const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url))

/** spec 事实 10：DSH_HOME 优先，否则 ~/.dsh（三行自实现，不引依赖包）。 */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

const BS = String.fromCharCode(92)
const NL = String.fromCharCode(10)
const WS = new Set([' ', String.fromCharCode(9), NL, String.fromCharCode(13)])

/**
 * 容忍 JSONC（注释 + 尾逗号）。状态机而非正则：字符串里的 // 必须原样保留。
 */
export function parseJsonc(text) {
  let stripped = ''
  let i = 0
  let inStr = false
  while (i < text.length) {
    const c = text[i]
    if (inStr) {
      stripped += c
      if (c === BS) { stripped += text[i + 1] === undefined ? '' : text[i + 1]; i += 2; continue }
      if (c === '"') inStr = false
      i++
      continue
    }
    if (c === '"') { inStr = true; stripped += c; i++; continue }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== NL) i++; continue }
    if (c === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    stripped += c
    i++
  }
  let out = ''
  for (let k = 0; k < stripped.length; k++) {
    if (stripped[k] === ',') {
      let j = k + 1
      while (j < stripped.length && WS.has(stripped[j])) j++
      if (stripped[j] === '}' || stripped[j] === ']') continue   // 丢掉这个尾逗号
    }
    out += stripped[k]
  }
  return JSON.parse(out)
}

/** 深合并：对象递归、**数组整组替换**、标量覆盖（spec §4.1 三层语义）。 */
export function deepMerge(base, over) {
  if (Array.isArray(over)) return over.slice()
  if (over === null || typeof over !== 'object') return over
  const out = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {}
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(out[k], v)
  return out
}

/** 校验：cast 非空、字段齐全、id 唯一。抛错必须能看出是哪个文件坏了。 */
export function validateConfig(config, source) {
  if (!config || typeof config !== 'object') throw new Error(source + ': 配置不是对象')
  if (!Array.isArray(config.cast) || config.cast.length === 0) throw new Error(source + ': cast 必须是非空数组')
  const seen = new Set()
  for (const pet of config.cast) {
    for (const k of ['id', 'name', 'anchor', 'size', 'animationDir', 'memeDir']) {
      if (pet === null || typeof pet !== 'object' || pet[k] === undefined) {
        throw new Error(source + ': cast[] 缺字段 ' + k + '（' + JSON.stringify(pet) + '）')
      }
    }
    if (seen.has(pet.id)) throw new Error(source + ': cast 里 id 重复: ' + pet.id)
    seen.add(pet.id)
    if (!Number.isFinite(pet.size) || pet.size <= 0) throw new Error(source + ': ' + pet.id + '.size 非法')
  }
  return config
}

/**
 * 三层读取：包内出厂 -> 用户覆盖（深合并）-> 校验。
 * @param {{packageDir?: string, home?: string}} [opts] 测试注入口
 */
export function loadPetConfig(opts = {}) {
  const packageDir = opts.packageDir || PACKAGE_DIR
  const home = opts.home || dshHome()
  const basePath = join(packageDir, 'assets', 'default-config.jsonc')
  const base = validateConfig(parseJsonc(readFileSync(basePath, 'utf8')), basePath)
  const userPath = join(home, 'dsh-kylin-pet', 'main-config.jsonc')
  if (!existsSync(userPath)) return base
  const merged = deepMerge(base, parseJsonc(readFileSync(userPath, 'utf8')))
  return validateConfig(merged, userPath)
}


// ── v0.1.1 S5：设置页的配置写入口 ─────────────────────────────────────────

/** 合法锚点（与 client 的 ANCHORS 同集）。 */
export const ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

/**
 * 白名单整形：patch 里只认 cast[].{id,size,anchor,balance} 与 directing.workStatus，
 * 多余字段一律抛错 —— 设置页是普通用户用的面，静默忽略他们拼错的键等于让「保存成功」说谎。
 * @returns {{cast?: Array, directing?: {workStatus?: object}}} 最小覆盖层
 */
export function sanitizeConfigPatch(patch, base) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('patch 必须是对象')
  const baseCast = Array.isArray(base && base.cast) ? base.cast : []
  const byId = new Map(baseCast.map((p) => [p.id, p]))
  const out = {}
  if (patch.cast !== undefined) {
    if (!Array.isArray(patch.cast)) throw new Error('patch.cast 必须是数组')
    out.cast = patch.cast.map((p) => {
      if (!p || typeof p !== 'object') throw new Error('patch.cast[] 必须是对象')
      const id = String(p.id || '')
      if (!byId.has(id)) throw new Error('patch.cast 里出现了 cast 之外的 id: ' + id)
      const item = { id: id }
      if (p.size !== undefined) {
        const n = Number(p.size)
        if (!Number.isFinite(n) || n < 120 || n > 560) throw new Error(id + '.size 必须在 120-560 之间')
        item.size = n
      }
      if (p.anchor !== undefined) {
        if (ANCHORS.indexOf(p.anchor) < 0) throw new Error(id + '.anchor 必须是 ' + ANCHORS.join('/'))
        item.anchor = p.anchor
      }
      if (p.balance !== undefined) {
        if (typeof p.balance !== 'boolean') throw new Error(id + '.balance 必须是布尔')
        item.balance = p.balance
      }
      return item
    })
  }
  if (patch.directing !== undefined) {
    if (!patch.directing || typeof patch.directing !== 'object' || Array.isArray(patch.directing)) {
      throw new Error('patch.directing 必须是对象')
    }
    const extra = Object.keys(patch.directing).filter((k) => k !== 'workStatus')
    if (extra.length) throw new Error('directing 不认识字段: ' + extra.join(','))
    const ws = patch.directing.workStatus
    if (ws !== undefined) {
      if (!ws || typeof ws !== 'object' || Array.isArray(ws)) throw new Error('workStatus 必须是对象')
      const clean = {}
      for (const id of Object.keys(ws)) {
        if (!byId.has(id)) throw new Error('workStatus 里出现了 cast 之外的 id: ' + id)
        const arr = ws[id]
        if (!Array.isArray(arr)) throw new Error('workStatus.' + id + ' 必须是数组')
        for (const v of arr) if (v !== 'ok' && v !== 'fail') throw new Error('workStatus.' + id + ' 只允许 ok/fail')
        clean[id] = arr.slice()
      }
      out.directing = { workStatus: clean }
    }
  }
  const extra = Object.keys(patch).filter((k) => k !== 'cast' && k !== 'directing')
  if (extra.length) throw new Error('patch 不认识字段: ' + extra.join(','))
  return out
}

/**
 * 把白名单 patch 合并进用户覆盖层（main-config.jsonc）并原子落盘（tmp + rename，与 bond 同款）。
 * 校验基准是「当前生效配置」，覆盖层里已有的内容原样保留（深合并语义，数组整组替换）。
 * @returns {{path: string, overlay: object, config: object}} config = 保存后应当生效的完整配置
 */
export function saveConfigPatch(patch, opts = {}) {
  const packageDir = opts.packageDir || PACKAGE_DIR
  const home = opts.home || dshHome()
  const base = loadPetConfig({ packageDir, home })
  const clean = sanitizeConfigPatch(patch, base)
  // 覆盖层的 cast 是**整组替换**语义：设置页只会带部分字段（size/anchor/balance），
  // 直接写进去会在下次 loadPetConfig 的校验上炸（cast[] 缺 name/animationDir…），
  // 只写 patch 里那几只还会把其余的宠从覆盖层里挤掉（整组替换 = 没列的等于删除）。
  // 因此落盘的覆盖层 cast **永远是完整一表**：按当前生效 cast 的顺序逐只叠加 patch 字段。
  if (Array.isArray(clean.cast)) {
    const patchById = new Map(clean.cast.map((p) => [p.id, p]))
    clean.cast = base.cast.map((p) => Object.assign({}, p, patchById.get(p.id) || {}))
  }
  const dir = join(home, 'dsh-kylin-pet')
  const path = join(dir, 'main-config.jsonc')
  let existing = {}
  if (existsSync(path)) {
    try { existing = parseJsonc(readFileSync(path, 'utf8')) } catch (err) { existing = {} }   // 坏覆盖层：按空起写，别让用户的布局永远存不进去
  }
  const merged = deepMerge(existing, clean)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(merged, null, 2))
  renameSync(tmp, path)
  return { path: path, overlay: merged, config: deepMerge(base, clean) }
}
