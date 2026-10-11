import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire('/opt/homebrew/lib/node_modules/')
const { chromium } = require('playwright')

const PORT = Number(process.env.V5B_PORT || 7460)
const bondPath = join(mkdtempSync(join(tmpdir(), 'v5b-')), 'bond.json')
writeFileSync(bondPath, JSON.stringify({ version: 1, pairs: {} }))
const child = spawn(process.execPath, ['tools/harness.mjs', String(PORT), bondPath], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
let boot = ''
child.stdout.on('data', (d) => { boot += String(d) })
child.stderr.on('data', (d) => { boot += String(d) })
await new Promise((ok) => { const t0 = Date.now(); const t = setInterval(() => { if (/harness: http/i.test(boot) || Date.now() - t0 > 15000) { clearInterval(t); ok() } }, 200) })

const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1200, height: 700 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message)))
const stateHits = { n: 0 }
page.on('request', (r) => { if (r.url().includes('/state')) stateHits.n++ })

await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.querySelector('#dsh-kylin-pet-stage') !== null, null, { timeout: 20000 })
await page.waitForTimeout(1500)

const before = await page.evaluate(() => ({
  stage: !!document.querySelector('#dsh-kylin-pet-stage'),
  actors: document.querySelector('#dsh-kylin-pet-stage') ? document.querySelector('#dsh-kylin-pet-stage').children.length : 0,
  disposers: window.__petDisposers(),
  raf: window.__rafCount,
}))
const stateBefore = stateHits.n
await page.waitForTimeout(2200)
const stateMid = stateHits.n
const rafMid = await page.evaluate(() => window.__rafCount)

await page.screenshot({ path: 'evidence/v5b/01-before-disable.png' })
const killed = await page.evaluate(() => window.__petDispose())
await page.waitForTimeout(300)
const afterDispose = await page.evaluate(() => ({
  stage: !!document.querySelector('#dsh-kylin-pet-stage'),
  disposers: window.__petDisposers(),
  raf: window.__rafCount,
}))
await page.waitForTimeout(700)
await page.screenshot({ path: 'evidence/v5b/02-after-disable.png' })
const rafAfter = await page.evaluate(() => window.__rafCount)
const stateAtDispose = stateHits.n
await page.waitForTimeout(2400)
const stateAfter = stateHits.n

const GATES = {
  started: before.stage === true,
  twoActors: before.actors === 2,
  effectRegistered: before.disposers === 1,
  loopAliveBefore: rafMid > before.raf,
  pollAliveBefore: stateMid - stateBefore >= 2,
  disposeRan: killed === 1,
  domRemoved: afterDispose.stage === false,
  disposersCleared: afterDispose.disposers === 0,
  rafLoopStopped: rafAfter === afterDispose.raf,
  pollStopped: stateAfter === stateAtDispose,
  noConsoleOrPageErrors: errors.length === 0,
}
console.log('BEFORE  ' + JSON.stringify(before))
console.log('MID     raf=' + rafMid + ' statePoll=' + (stateMid - stateBefore) + ' in 2.2s')
console.log('DISPOSE killed=' + killed + ' -> ' + JSON.stringify(afterDispose))
console.log('AFTER   raf=' + rafAfter + ' statePoll=' + (stateAfter - stateAtDispose) + ' in 2.4s')
console.log('ERRORS  ' + JSON.stringify(errors.slice(0, 3)))
console.log('GATES   ' + JSON.stringify(GATES, null, 1))
console.log('RESULT  ' + (Object.values(GATES).every(Boolean) ? 'ALL PASS' : 'FAIL: ' + Object.keys(GATES).filter((k) => !GATES[k]).join(',')))
await b.close()
child.kill('SIGTERM')
await new Promise((r) => setTimeout(r, 1200))
try { child.kill('SIGKILL') } catch (e) {}

