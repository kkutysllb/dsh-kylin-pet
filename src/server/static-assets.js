import { existsSync, realpathSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { MEME_EXT, ANIM_EXT } from '../shared/contract.js'
import { PACKAGE_DIR, dshHome } from './pet-config.js'

const BS = String.fromCharCode(92)
const NUL = String.fromCharCode(0)
const FORBIDDEN = new Set(['/', BS, NUL])

/**
 * 文件名守卫：它必须是个**名字**，不是路径。
 * 38 段素材全是中文名（必须放行），但分隔符 / 上跳 / NUL / 隐藏文件一律拒。
 */
export function isSafeName(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 128) return false
  if (name === '.' || name === '..' || name.startsWith('.')) return false
  for (const ch of name) if (FORBIDDEN.has(ch)) return false
  return true
}

/** 真前缀复检（纵深防御：即便拼接被绕过，落点也必须仍在允许根内）。 */
function under(child, parent) {
  const c = resolve(child)
  const p = resolve(parent)
  return c === p || c.startsWith(p + sep)
}

/**
 * @param {{config: object, packageDir?: string, home?: string}} opts
 * @returns {(kind: 'pet'|'memes', role: string, encodedName: string) => null | {path: string, mime: string, size: number}}
 */
export function createAssetResolver(opts) {
  const config = opts.config
  const packageDir = opts.packageDir || PACKAGE_DIR
  const home = opts.home || dshHome()
  const byId = new Map(config.cast.map((pet) => [pet.id, pet]))
  const userRoot = join(home, 'dsh-kylin-pet', 'pet')
  const packageRoot = join(packageDir, 'assets', 'pet')

  return function resolveAsset(kind, role, encodedName) {
    if (kind !== 'pet' && kind !== 'memes') return null
    const pet = byId.get(role)          // role 白名单：只认 cast 里的 id（ASCII，故不解码）
    if (!pet) return null
    let name
    try { name = decodeURIComponent(encodedName) } catch { return null }
    if (!isSafeName(name)) return null
    const ext = kind === 'pet' ? ANIM_EXT : MEME_EXT
    if (!name.endsWith(ext)) return null

    const rel = join(kind === 'pet' ? pet.animationDir : pet.memeDir, name)
    for (const root of [userRoot, packageRoot]) {   // 用户目录优先（可覆盖单段素材）-> 包内出厂
      const candidate = join(root, rel)
      if (!under(candidate, root)) continue
      if (!existsSync(candidate)) continue
      const st = statSync(candidate)
      if (!st.isFile()) continue
      // 符号链接逃逸复检：**两侧都要规范化**。
      // 只规范化 candidate、拿未规范化的 root 去比，等于比较两个不同空间的路径：
      // macOS 上 /var 是指向 /private/var 的符号链接，任何位于 /var 下的根
      // （os.tmpdir()、软链安装的 store、软链 home）都会让**每一个**候选被判为逃逸
      // → 包内与用户覆盖素材全部静默 404。2026-10-11 执行期实测：fixture 建在
      // tmpdir 下时连包内素材都取不到（此处原先正是这个 bug）。
      let realRoot
      try { realRoot = realpathSync(root) } catch { continue }
      if (!under(realpathSync(candidate), realRoot)) continue
      return { path: candidate, mime: kind === 'pet' ? 'video/webm' : 'image/png', size: st.size }
    }
    return null
  }
}
