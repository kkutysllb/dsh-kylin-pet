import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAssetResolver, isSafeName } from '../src/server/static-assets.js'

const BS = String.fromCharCode(92)
const CONFIG = { cast: [
  { id: 'kylinzi', name: '麒麟仔', anchor: 'top-right', size: 280, animationDir: 'main-animation', memeDir: 'main-memes' },
  { id: 'xisha', name: '鲸鱼娘', anchor: 'bottom-left', size: 280, animationDir: 'whale-animation', memeDir: 'whale-memes' },
] }

function world() {
  const root = mkdtempSync(join(tmpdir(), 'kpet-assets-'))
  const packageDir = join(root, 'pkg')
  const home = join(root, 'home')
  mkdirSync(join(packageDir, 'assets', 'pet', 'main-animation'), { recursive: true })
  mkdirSync(join(packageDir, 'assets', 'pet', 'main-memes'), { recursive: true })
  writeFileSync(join(packageDir, 'assets', 'pet', 'main-animation', '待机.webm'), 'PKG')
  writeFileSync(join(packageDir, 'assets', 'pet', 'main-memes', '笑.png'), 'PNG')
  return { root, packageDir, home, r: createAssetResolver({ config: CONFIG, packageDir, home }) }
}

test('中文名 + 正确扩展名 -> 命中包内', () => {
  const w = world()
  const hit = w.r('pet', 'kylinzi', encodeURIComponent('待机.webm'))
  assert.equal(hit.path, join(w.packageDir, 'assets', 'pet', 'main-animation', '待机.webm'))
  assert.equal(hit.mime, 'video/webm')
  assert.equal(hit.size, 3)
})

test('用户目录优先于包内，未覆盖则回落包内', () => {
  const w = world()
  mkdirSync(join(w.home, 'dsh-kylin-pet', 'pet', 'main-animation'), { recursive: true })
  writeFileSync(join(w.home, 'dsh-kylin-pet', 'pet', 'main-animation', '待机.webm'), 'USER')
  assert.equal(w.r('pet', 'kylinzi', encodeURIComponent('待机.webm')).path,
    join(w.home, 'dsh-kylin-pet', 'pet', 'main-animation', '待机.webm'))
  assert.equal(w.r('pet', 'kylinzi', encodeURIComponent('走路.webm')), null)
})

test('穿越与越权一律 null', () => {
  const w = world()
  const cases = [
    ['pet', 'kylinzi', encodeURIComponent('../../../etc/passwd')],
    ['pet', 'kylinzi', '..%2f..%2fsecret.webm'],
    ['pet', 'kylinzi', '%2e%2e%2f待机.webm'],
    ['pet', 'kylinzi', encodeURIComponent('/etc/passwd')],
    ['pet', 'nobody', encodeURIComponent('待机.webm')],
    ['pet', 'kylinzi', encodeURIComponent('待机.png')],
    ['memes', 'xisha', encodeURIComponent('笑.png')],
    ['pet', 'kylinzi', encodeURIComponent('.hidden.webm')],
    ['pet', 'kylinzi', 'bad%zz'],
    ['pet', 'kylinzi', ''],
    ['other', 'kylinzi', encodeURIComponent('待机.webm')],
  ]
  for (const c of cases) assert.equal(w.r(c[0], c[1], c[2]), null, JSON.stringify(c))
})

test('isSafeName 边界', () => {
  assert.ok(isSafeName('待机.webm'))
  assert.ok(isSafeName('a-b_c.png'))
  assert.ok(!isSafeName(''))
  assert.ok(!isSafeName('..'))
  assert.ok(!isSafeName('a/b'))
  assert.ok(!isSafeName('a' + BS + 'b'))
  assert.ok(!isSafeName('.x'))
})

test('符号链接逃逸被 realpath 复检挡住', () => {
  const w = world()
  writeFileSync(join(w.root, 'secret.webm'), 'SECRET')
  symlinkSync(join(w.root, 'secret.webm'), join(w.packageDir, 'assets', 'pet', 'main-animation', '逃.webm'))
  assert.equal(w.r('pet', 'kylinzi', encodeURIComponent('逃.webm')), null)
})
