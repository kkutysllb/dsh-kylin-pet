#!/usr/bin/env node
// 定妆姿势直连生成器（绕开插件旧解析）：POST {base}/v1/responses 双形态通吃——
// 标准形态 image_generation_call.result(base64) → 落盘；文本藏 URL（Firefly 预签名 S3）
// → 下载。另支持 recover 子命令：GET /v1/responses/{id} 抢救已计费但被旧解析丢弃的孤儿。
// 用法：
//   node scripts/gen-poses-direct.mjs recover 'respIdA=/out/a.png,respIdB=/out/b.png'
//   node gen-poses-direct.mjs gen --out DIR --json '[{"stem":"pose-x","text":"..."},...]' [--ref /path/ref.png] [--quality medium]
// 通道取 vault 第一个 enabled（~/.kcoder/.dsh-kylin-images/vault.json）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const IMAGE_URL_SIGNATURE = /amazonaws|firefly|\/images?(\/|$)|\.(png|jpe?g|webp)([?#]|$)/i;
const TEXT_URL_PATTERN = /https:\/\/[A-Za-z0-9\-._~:\/?#[\]@!$&*+,;=%]+/g;

const vault = JSON.parse(readFileSync(join(homedir(), '.kcoder/.dsh-kylin-images/vault.json'), 'utf8'));
const channel = vault.channels.find((c) => c.enabled) ?? vault.channels[0];
if (!channel?.baseUrl) throw new Error('vault 无可用通道');
const base = channel.baseUrl.replace(/\/+$/, '');
const auth = { 'content-type': 'application/json', authorization: 'Bearer ' + channel.apiKey };

const harvestTextUrls = (body) => {
  const urls = new Set();
  const walk = (o) => {
    if (typeof o === 'string') {
      for (const m of o.matchAll(TEXT_URL_PATTERN)) if (IMAGE_URL_SIGNATURE.test(m[0])) urls.add(m[0]);
    } else if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') Object.values(o).forEach(walk);
  };
  walk(body.output);
  return [...urls];
};

async function saveB64(b64, out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(b64, 'base64'));
}
async function saveUrl(url, out) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('下载 ' + r.status);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));
}
/** 双形态提取：有 base64 用 base64，否则文本藏 URL。返回落盘路径数组。 */
async function extractAndSave(body, outBase) {
  const calls = (body.output ?? []).filter((o) => o?.type === 'image_generation_call' && (o.result || o.url));
  if (calls.length > 0) {
    const paths = [];
    for (let i = 0; i < calls.length; i++) {
      const out = calls.length === 1 ? outBase : outBase.replace(/(\.png)$/i, `-${i + 1}$1`);
      if (calls[i].result) await saveB64(calls[i].result, out);
      else await saveUrl(calls[i].url, out);
      paths.push(out);
    }
    return paths;
  }
  const urls = harvestTextUrls(body);
  if (urls.length === 0) throw new Error('BAD_RESPONSE: 无 image_generation_call 也无可采 URL');
  const paths = [];
  for (let i = 0; i < urls.length; i++) {
    const out = urls.length === 1 ? outBase : outBase.replace(/(\.png)$/i, `-${i + 1}$1`);
    await saveUrl(urls[i], out);
    paths.push(out);
  }
  return paths;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [, , cmd, ...rest] = process.argv;
if (cmd === 'recover') {
  for (const pair of (rest[0] ?? '').split(',')) {
    const [id, out] = pair.split('=');
    const r = await fetch(base + '/v1/responses/' + id, { headers: auth });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body) {
      console.log(`recover ${id}: FAIL HTTP ${r.status}`);
      continue;
    }
    try {
      const paths = await extractAndSave(body, out);
      console.log(`recover ${id}: OK -> ${paths.join(', ')}`);
    } catch (e) {
      console.log(`recover ${id}: FAIL ${e.message}`);
    }
  }
} else if (cmd === 'gen') {
  const argOf = (k) => rest[rest.indexOf(k) + 1];
  const outDir = argOf('--out');
  const items = JSON.parse(argOf('--json'));
  const ref = argOf('--ref');
  const quality = argOf('--quality') ?? 'medium';
  for (const { stem, text } of items) {
    const out = outDir + '/' + stem + '.png';
    const content = ref
      ? [{ type: 'input_text', text: text + '\n\n（参考图仅用于锁定角色设定，输出不出现参考图的背景与构图）' }]
      : [{ type: 'input_text', text }];
    const payload = {
      model: 'gpt-image-2-4k',
      input: ref
        ? [{ role: 'user', content }]
        : text,
      tools: [{ type: 'image_generation', size: '1024x1536', quality }],
    };
    if (ref) payload.input[0].content.unshift({ type: 'input_image', image_url: 'data:image/png;base64,' + readFileSync(ref).toString('base64') });
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
      try {
        const r = await fetch(base + '/v1/responses', { method: 'POST', headers: auth, body: JSON.stringify(payload) });
        const body = await r.json().catch(() => null);
        if (!r.ok || !body) throw new Error('HTTP ' + r.status + ' ' + JSON.stringify(body).slice(0, 160));
        const paths = await extractAndSave(body, out);
        console.log(`gen ${stem}: OK -> ${paths.join(', ')}`);
        done = true;
      } catch (e) {
        console.log(`gen ${stem}: attempt ${attempt} FAIL ${e.message.slice(0, 140)}`);
        if (attempt < 3) await sleep(4000);
      }
    }
  }
} else {
  console.log('用法: gen-poses-direct.mjs recover <id=out,...> | gen --out DIR --json ...');
  process.exit(1);
}
