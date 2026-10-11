import { existsSync, readFileSync } from 'node:fs'
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
