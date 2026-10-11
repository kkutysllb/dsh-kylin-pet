#!/usr/bin/env node
/**
 * dsh-kylin-pet 资产机检 — M0（最终交付门，独立于上游素材链）
 * 契约: 640x360 / VP9 / yuva420p(真实alpha层次) / 2-8s / 无音轨
 *
 * 两个已证实的坑（2026-10-12 实测，见 plans/2026-10-12-m0-execution.md）:
 * 1. VP9 alpha 必须用 libvpx-vp9 解码才可见 —— ffprobe/ffmpeg 默认原生 vp9
 *    解码器会把 yuva420p 丢成 yuv420p（上游 encode_thumbs.py 注释同款警告）。
 *    故 pix_fmt 一律强制 -c:v libvpx-vp9 复测。
 * 2. pix_fmt 对不保证 alpha 有内容 —— 吸收上游 check_alpha.py 思路，抽帧验
 *    A 通道真实层次（既有 >200 不透明、又有 <100 透明）。
 *
 * 用法: node scripts/check-assets.mjs <file|dir> [more...]
 * 任一不合格 → exit 1；无文件 → exit 2
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';

const C = { width: 640, height: 360, codec: 'vp9', pixfmt: 'yuva420p', minSec: 2, maxSec: 8 };
const EXTS = new Set(['.webm', '.mov', '.mp4']);
const FFPROBE_BIN = process.env.FFPROBE_BIN || '/opt/homebrew/bin/ffprobe';
const FFMPEG_BIN = process.env.FFMPEG_BIN || '/opt/homebrew/bin/ffmpeg';

const collect = (args) => args.flatMap((a) => {
  const p = resolve(a);
  if (statSync(p).isDirectory())
    return readdirSync(p).sort().filter((f) => EXTS.has(extname(f).toLowerCase())).map((f) => join(p, f));
  return [p];
});

function probe(file, forceVp9) {
  const args = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams'];
  if (forceVp9) args.push('-c:v', 'libvpx-vp9');
  args.push(file);
  return JSON.parse(execFileSync(FFPROBE_BIN, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}

function alphaStats(file, dur) {
  const at = Math.max(0, Math.min(1, (dur || 2) / 2));
  const r = spawnSync(FFMPEG_BIN,
    ['-v', 'error', '-ss', String(at), '-c:v', 'libvpx-vp9', '-i', file,
     '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'],
    { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout || r.stdout.length < 16) return null;
  let min = 255, max = 0, sum = 0, n = 0;
  for (let i = 3; i < r.stdout.length; i += 4) {
    const a = r.stdout[i];
    if (a < min) min = a;
    if (a > max) max = a;
    sum += a; n++;
  }
  return { min, max, mean: n ? sum / n : 0 };
}

function check(file) {
  let meta;
  try { meta = probe(file, false); } catch (e) { return { file, ok: false, rows: '', problems: ['ffprobe 失败: ' + String(e.message).split('\n')[0]] }; }
  const vids = meta.streams.filter((s) => s.codec_type === 'video');
  const auds = meta.streams.filter((s) => s.codec_type === 'audio');
  const v = vids[0];
  const problems = [];
  if (vids.length !== 1) problems.push('视频流 ' + vids.length + ' 条（应为 1）');
  let pixfmt = v && v.pix_fmt;
  if (v) {
    if (v.codec_name !== C.codec) problems.push('编码 ' + v.codec_name + ' ≠ ' + C.codec);
    if (+v.width !== C.width || +v.height !== C.height) problems.push('尺寸 ' + v.width + 'x' + v.height + ' ≠ ' + C.width + 'x' + C.height);
    if (v.codec_name === 'vp9') {
      try { pixfmt = probe(file, true).streams.find((s) => s.codec_type === 'video').pix_fmt; }
      catch { problems.push('libvpx-vp9 解码复测失败'); }
    }
    if (pixfmt !== C.pixfmt) problems.push('pix_fmt ' + pixfmt + ' ≠ ' + C.pixfmt + '（libvpx 解码下仍缺 alpha 面）');
  }
  if (auds.length > 0) problems.push('含 ' + auds.length + ' 条音轨（应无音轨）');
  const dur = +(meta.format?.duration ?? v?.duration ?? NaN);
  if (!Number.isFinite(dur)) problems.push('无法读取时长');
  else if (dur < C.minSec || dur > C.maxSec) problems.push('时长 ' + dur.toFixed(2) + 's ∉ [' + C.minSec + ',' + C.maxSec + ']s');
  let alphaTxt = '';
  if (pixfmt === C.pixfmt && !problems.some((p) => p.includes('尺寸'))) {
    const a = alphaStats(file, dur);
    if (!a) problems.push('抽帧失败，无法验证 alpha 层次');
    else {
      alphaTxt = ' alpha[' + a.min + '..' + a.max + ']';
      if (!(a.max > 200 && a.min < 100)) problems.push('alpha 层次不足（min=' + a.min + ' max=' + a.max + '）——整帧近全不透明或全透明，疑似假 alpha');
    }
  }
  const rows = v ? (v.width + 'x' + v.height + ' ' + pixfmt + ' ' + (Number.isFinite(dur) ? dur.toFixed(2) + 's' : '?') + alphaTxt) : '';
  return { file, ok: problems.length === 0, problems, rows };
}

const files = collect(process.argv.slice(2));
if (files.length === 0) { console.error('没有可检文件。用法: node scripts/check-assets.mjs <file|dir>...'); process.exit(2); }
let bad = 0;
for (const r of files.map(check)) {
  if (r.ok) console.log('PASS  ' + r.file + '  (' + r.rows + ')');
  else { bad++; console.log('FAIL  ' + r.file); for (const p of r.problems) console.log('      - ' + p); }
}
console.log(bad === 0 ? '\n' + files.length + ' 个文件全部合格 ✅' : '\n' + bad + '/' + files.length + ' 不合格 ❌');
process.exit(bad === 0 ? 0 : 1);
