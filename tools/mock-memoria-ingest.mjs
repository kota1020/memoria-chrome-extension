#!/usr/bin/env node
// ============================================================================
//  mock-memoria-ingest.mjs — memoria の受け口の代わりに立てる確認用サーバー
//
//  この拡張機能は、利用者自身のMacで動く memoria が無いと渡す先が無い。
//  審査する人・初めて触る人が動きを見られるように、同じ形で受けるだけの
//  ダミーを用意しておく。受けた中身は標準出力に出すだけで、保存も転送もしない。
//
//  使い方: node tools/mock-memoria-ingest.mjs      （127.0.0.1:4319 で待ち受け）
//          PORT=4399 node tools/mock-memoria-ingest.mjs
// ============================================================================

import http from 'node:http';

const PORT = Number(process.env.PORT || 4319);
let total = 0;

http.createServer((request, response) => {
  if (request.method !== 'POST' || !request.url.startsWith('/ingest/page')) {
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  let body = '';
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(body); } catch { /* 形が違えば下で0件になる */ }
    const events = Array.isArray(payload.events) ? payload.events : [];
    total += events.length;
    for (const e of events) {
      const seconds = Math.round((e.dwell_ms || 0) / 1000);
      console.log(`${e.entered_at}  ${seconds}s  ${e.title || '(no title)'}`);
      console.log(`    ${e.url}`);
      console.log(`    本文 ${e.text_chars || 0}字${e.text_skipped ? `（取得せず: ${e.text_skipped}）` : ''}  区切り: ${e.reason}`);
    }
    console.log(`  -- 受信 ${events.length}件 / 累計 ${total}件`);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ ok: true, received: events.length }));
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`mock memoria ingest: http://127.0.0.1:${PORT}/ingest/page`);
});
