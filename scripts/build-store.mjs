#!/usr/bin/env node
// ============================================================================
//  build-store.mjs — Chrome Web Store へ出す配布ビルドを作る
//
//  リポジトリ直下は「自分のMacで使う開発版」（ネイティブ連携つき）。
//  配布版はそこから機能を足すのではなく、審査に出せる最小構成だけを
//  store/ の manifest と background / content で組み直す。
//
//    含める : サイドパネル一式 / アイコン
//    含めない: nativeMessaging・会話の取り込み・content script・
//              MAIN world への注入・広い optional_host_permissions・
//              manifest の key
//
//  使い方: node scripts/build-store.mjs
//  出力  : dist/store/ と dist/memoria-context-faucet-<version>.zip
// ============================================================================

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist', 'store');

/// 配布物に入れるもの（左＝出力先, 右＝取り出し元）。ここに無いものは入らない
const FILES = [
  ['manifest.json', 'store/manifest.json'],
  ['background.js', 'store/background.js'],
  ['sidepanel.html', 'sidepanel.html'],
  ['sidepanel.js', 'sidepanel.js'],
  ['sidepanel.css', 'sidepanel.css'],
  ['context-query.js', 'context-query.js'],
  ['icons/icon-16.png', 'icons/icon-16.png'],
  ['icons/icon-48.png', 'icons/icon-48.png'],
  ['icons/icon-128.png', 'icons/icon-128.png'],
];

/// 審査で問題になる形を、出す前にこちらで落とす
const FORBIDDEN_MANIFEST_KEYS = ['key', 'optional_host_permissions'];
const FORBIDDEN_PERMISSIONS = ['nativeMessaging', 'webRequest', 'debugger', 'management',
                               'proxy', 'history', 'downloads', 'cookies', 'declarativeNetRequest'];
/// 通信先はこのMacの中だけ。外部CDNやリモートAPIが混ざっていないか見る
const ALLOWED_NETWORK = ['http://127.0.0.1:4319',
                         'https://github.com/kota1020/memoria-chrome-extension'];

const problems = [];
const fail = (message) => problems.push(message);

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'store/manifest.json'), 'utf8'));

// ---- 1. manifest そのものを見る ----------------------------------------------
for (const key of FORBIDDEN_MANIFEST_KEYS) {
  if (key in manifest) fail(`manifest に ${key} が残っている（配布版では消す）`);
}
for (const permission of manifest.permissions || []) {
  if (FORBIDDEN_PERMISSIONS.includes(permission)) fail(`権限 ${permission} は配布版に入れない`);
}
for (const host of manifest.host_permissions || []) {
  if (/^(https?:\/\/)?(\*|<all_urls>)/.test(host) || host.includes('://*/*')) {
    fail(`host_permissions が広すぎる: ${host}`);
  }
}
if (manifest.content_scripts) fail('配布版に content_scripts は入れない');
if (manifest.web_accessible_resources) fail('配布版に web_accessible_resources は入れない');
for (const host of manifest.host_permissions || []) {
  if (!host.startsWith('http://127.0.0.1:')) fail(`ホスト権限はループバックだけにする: ${host}`);
}
if (manifest.manifest_version !== 3) fail('manifest_version は 3 であること');
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version || '')) fail(`version の形が不正: ${manifest.version}`);

// ---- 2. manifest が名指ししたファイルが実在するか ------------------------------
const shipped = new Set(FILES.map(([to]) => to));
const referenced = [
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  ...(manifest.content_scripts || []).flatMap((entry) => entry.js || []),
  ...(manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || []),
].filter(Boolean);
for (const file of new Set(referenced)) {
  if (!shipped.has(file)) fail(`manifest が参照する ${file} が配布物に入っていない`);
}

// ---- 3. 中身を組み立てる ------------------------------------------------------
fs.rmSync(OUT, { recursive: true, force: true });
for (const [to, from] of FILES) {
  const source = path.join(ROOT, from);
  if (!fs.existsSync(source)) { fail(`元ファイルが無い: ${from}`); continue; }
  const target = path.join(OUT, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

// ---- 4. 配布物のコードを読み直して、外向きの通信と残骸を探す ----------------------
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});
for (const file of walk(OUT)) {
  if (!/\.(js|html|css)$/.test(file)) continue;
  const body = fs.readFileSync(file, 'utf8');
  const rel = path.relative(OUT, file);
  for (const url of body.match(/https?:\/\/[^\s'"`)]+/g) || []) {
    if (!ALLOWED_NETWORK.some((allowed) => url.startsWith(allowed))) {
      fail(`${rel} が想定外の宛先を持っている: ${url}`);
    }
  }
  if (/connectNative|sendNativeMessage/.test(body)) fail(`${rel} にネイティブ連携が残っている`);
  if (/world:\s*'MAIN'|world="MAIN"/.test(body)) fail(`${rel} が MAIN world へ注入している`);
  if (/\bnew Function\b|\beval\(/.test(body)) fail(`${rel} に動的コード実行が残っている`);
}

// ---- 5. アイコンの実寸（PNG ヘッダから読む） ------------------------------------
for (const [size, file] of [[16, 'icons/icon-16.png'], [48, 'icons/icon-48.png'], [128, 'icons/icon-128.png']]) {
  const buffer = fs.readFileSync(path.join(OUT, file));
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width !== size || height !== size) fail(`${file} が ${width}x${height}（${size}x${size} であること）`);
}

if (problems.length) {
  console.error('配布ビルドを止めました:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

// ---- 6. ZIP にする ------------------------------------------------------------
const zipName = `memoria-context-faucet-${manifest.version}.zip`;
const zipPath = path.join(ROOT, 'dist', zipName);
fs.rmSync(zipPath, { force: true });
execFileSync('zip', ['-r', '-X', '-q', zipPath, '.'], { cwd: OUT });

const sha256 = createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
const bytes = fs.statSync(zipPath).size;
console.log(`名前      : ${manifest.name}`);
console.log(`バージョン: ${manifest.version}`);
console.log(`権限      : ${(manifest.permissions || []).join(', ')}`);
console.log(`ホスト    : ${(manifest.host_permissions || []).join(', ')}`);
console.log(`ファイル  : ${FILES.length}件`);
console.log(`ZIP       : dist/${zipName}（${bytes} bytes）`);
console.log(`SHA256    : ${sha256}`);
