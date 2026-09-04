// ============================================================================
//  content.js — 見ているページの「実測」を1件つくる
//
//  なぜこれが要るか
//    memoria 本体は画面を撮って OCR で読んでいる。ブラウザの中身はそれだと
//    ほとんど当たらない。実測（2026-09-04・直近2,261行）では
//      ・1,409行が OCR 由来。ブラウザから直接もらった行は 0
//      ・タイトルの311件が「…」で切れている（ウィンドウのタイトルバー読み）
//      ・本文は "Nunrau Cumael Pwvsy. · -.м..•" のような読めない文字列
//    ブラウザ自身が正確なURL・正確なタイトル・本文・滞在時間を渡せば、
//    同じ時刻の画面フレームと突き合わせて「何を見ていたか」が確定する。
//
//  ここで守ること
//    ・送り先は background 経由で 127.0.0.1 の memoria だけ。外部へは出さない
//    ・入力欄の中身は読まない（innerText には入らない）
//    ・パスワード欄があるページは本文を取らない（ログイン・銀行の画面）
//    ・除外リストに入っているサイトは本文を取らない。URLとタイトルだけ
//    ・見えていない時間は数えない。タブを裏に回したらそこで区切る
// ============================================================================

(() => {
  if (window.__memoriaPageInstalled) return;
  window.__memoriaPageInstalled = true;

  const TEXT_LIMIT = 20000;      // 本文の上限。長い記事でもここで切る
  const HEARTBEAT_MS = 60000;    // 長く見ているページを取りこぼさないための区切り
  const MIN_DWELL_MS = 1000;     // 一瞬だけ映ったタブは記録しない

  let view = null;               // いま数えている滞在
  let heartbeat = null;

  const send = (event) => {
    try { chrome.runtime.sendMessage({ channel: 'memoria-page', event }, () => void chrome.runtime.lastError); }
    catch { /* 拡張が入れ替わった直後。次の遷移で拾う */ }
  };

  /// パスワード欄があれば、そのページの本文は取らない。
  /// ログイン画面・銀行・決済など「見られたくない画面」をここで落とす
  function hasPasswordField() {
    return !!document.querySelector('input[type="password"]');
  }

  /// 本文。script / style / nav などの飾りを除いて、読める形で取る
  function bodyText() {
    const main = document.querySelector('main, article, [role="main"]') || document.body;
    if (!main) return '';
    const clone = main.cloneNode(true);
    for (const el of clone.querySelectorAll('script,style,noscript,svg,canvas,iframe,nav,footer')) el.remove();
    return (clone.innerText || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, TEXT_LIMIT);
  }

  function snapshot() {
    return {
      url: location.href,
      title: document.title || '',
      lang: document.documentElement.lang || '',
      referrer: document.referrer || '',
      has_password_field: hasPasswordField(),
    };
  }

  /// 滞在を1件として閉じ、background へ渡す
  function close(reason) {
    if (!view) return;
    const now = Date.now();
    const dwell = now - view.startedAt;
    const item = view;
    view = null;
    stopHeartbeat();
    if (dwell < MIN_DWELL_MS && reason !== 'navigate') return;
    send({
      kind: 'view',
      url: item.url,
      title: item.title,
      lang: item.lang,
      referrer: item.referrer,
      text: item.text,
      text_chars: item.text ? item.text.length : 0,
      text_skipped: item.textSkipped || null,
      entered_at: new Date(item.startedAt).toISOString(),
      left_at: new Date(now).toISOString(),
      dwell_ms: dwell,
      reason,
    });
  }

  function open(reason) {
    if (view) return;
    const info = snapshot();
    let text = '';
    let textSkipped = null;
    if (info.has_password_field) textSkipped = 'password_field';
    else text = bodyText();
    view = { ...info, text, textSkipped, startedAt: Date.now(), openedBy: reason };
    startHeartbeat();
  }

  // 長く見ているページは、途中でも一度区切って渡す。
  // タブを開きっぱなしにしたまま Mac を閉じても、そこまでは残る
  function startHeartbeat() {
    stopHeartbeat();
    heartbeat = setInterval(() => { close('heartbeat'); open('heartbeat'); }, HEARTBEAT_MS);
  }
  function stopHeartbeat() {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  }

  // ---- 見えている時だけ数える -------------------------------------------------
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') open('visible');
    else close('hidden');
  });
  window.addEventListener('pagehide', () => close('unload'));
  window.addEventListener('blur', () => { if (document.visibilityState !== 'visible') close('blur'); });
  window.addEventListener('focus', () => { if (document.visibilityState === 'visible') open('focus'); });

  // ---- 画面が切り替わらない作りのサイト（SPA）の遷移 -------------------------
  // history API を書き換えず、URL が変わったかを見るだけにする
  let lastURL = location.href;
  setInterval(() => {
    if (location.href === lastURL) return;
    lastURL = location.href;
    close('navigate');
    if (document.visibilityState === 'visible') open('navigate');
  }, 700);

  if (document.visibilityState === 'visible') open('load');
})();
