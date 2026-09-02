// ============================================================================
//  page-boot.js — page world の入口（共有）
//
//  content script から <script type="module"> として注入され、
//  共有 hook を1回だけ有効にする。二重注入しても hook は1つだけになる。
//
//  mode=capture … 本番（prompt と確定 response を取り出す）
//  mode=probe   … 通信構造の調査だけ（本文を出さない）
//  salt は Probe の ID タグ用。chrome-extension:// の URL なので端末外へ出ない
// ============================================================================

import { installProbeHook, installCaptureHook } from './page-hook.js';
import { setProbeSalt } from './anonymize.js';

if (!window.__memoriaClaudeWebHook) {
  window.__memoriaClaudeWebHook = true;
  let mode = 'capture';
  try {
    const params = new URL(import.meta.url).searchParams;
    const salt = params.get('salt');
    if (salt) setProbeSalt(salt);
    if (params.get('mode') === 'probe') mode = 'probe';
  } catch { /* 既定は capture */ }
  if (mode === 'probe') installProbeHook();
  else installCaptureHook();
}
