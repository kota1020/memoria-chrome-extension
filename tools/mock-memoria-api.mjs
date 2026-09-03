#!/usr/bin/env node
// ============================================================================
//  mock-memoria-api.mjs — Memoria 読み取りAPIの代わりに立てる確認用サーバー
//
//  この拡張機能は、利用者自身のMacで動く Memoria が無いと何も表示しない。
//  審査する人・初めて触る人が中身を見られるように、同じ形の応答を返すだけの
//  ダミーを用意しておく。ここに入っているのは実在しない見本データで、
//  ファイルもネットワークも読まない。
//
//  使い方:  node tools/mock-memoria-api.mjs      （127.0.0.1:4319 で待ち受け）
//           PORT=4399 node tools/mock-memoria-api.mjs
//  止める:  Ctrl-C
// ============================================================================

import http from 'node:http';

const PORT = Number(process.env.PORT || 4319);

const CARDS = [
  { id: 'demo-1', kind: 'fact', type: 'decision',
    title: '権限は最小構成にすると決めた',
    text: '常時のホスト権限は増やさず、必要になった時だけ利用者に聞く方針にした',
    when: '2026-08-21', score: 0.83 },
  { id: 'demo-2', kind: 'task',
    title: 'サイドパネルの表示を実機で確認する',
    text: '記憶が0件のときの文言と、接続できないときの案内を見る',
    status: 'paused', score: 0.75 },
  { id: 'demo-3', kind: 'fact', type: 'reference',
    title: 'このページは先月も2回開いている',
    text: '同じ節を、パネルの開き方を調べるために読んでいた',
    when: '2026-08-14', score: 0.64 },
  { id: 'demo-4', kind: 'fact', type: 'deadline',
    title: '締切 2026-09-30：公開版の申請',
    text: '掲載文とプライバシーポリシーを揃えてから出す',
    when: '2026-09-30', score: 0.55 },
];

const CONTEXT = {
  disclosure: 'context',
  tasks: [
    { name: '拡張機能の公開準備', status: 'ongoing',
      goal: '権限を最小構成に整えてから申請する',
      last_active: '2026-09-03T10:24:00+09:00' },
    { name: 'プライバシーポリシーの書き直し', status: 'paused',
      goal: '実際に読んでいるものだけを漏れなく書く',
      last_active: '2026-09-02T17:40:00+09:00' },
  ],
  facts: [
    '常時のホスト権限は増やさない方針',
    '記憶の問い合わせ先はこのMacの中だけ',
    '公開版の申請期限は 2026-09-30',
  ],
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  if (url.pathname === '/handoff') {
    const query = url.searchParams.get('q') || '';
    const limit = Number(url.searchParams.get('limit') || 5);
    response.end(JSON.stringify({ q: query, ai: url.searchParams.get('ai'),
                                  cards: CARDS.slice(0, limit) }));
    return;
  }
  if (url.pathname === '/context') {
    response.end(JSON.stringify({ ...CONTEXT, ts: new Date().toISOString() }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: 'not_found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock Memoria read API: http://127.0.0.1:${PORT}`);
  console.log('  GET /handoff?q=...&limit=5   GET /context');
});
