// ============================================================================
//  handoff-gate.js — 送信を1回だけ止める門番（MAIN world 専用・document_start）
//
//  なぜ MAIN world が要るか（2026-09-03 Gemini 実測）
//    拡張の content script は ISOLATED world で動く。ISOLATED から
//    stopImmediatePropagation() を呼んでも、**ページ側のリスナーには効かない**。
//    preventDefault() は共有されるが、Gemini は defaultPrevented を見ずに送信する。
//    そのため ISOLATED だけで作ると「先に送信されてから確認パネルが出る」
//    ＝ OK を押すと二重送信になる。実際にそうなった。
//
//  ここがやること（これだけ）
//    ・window のキャプチャ最前列で Enter と送信ボタンのクリックを1回止める
//    ・止めたことを ISOLATED 側へ postMessage で伝える
//    ・ISOLATED から「送っていい」と返ってきたら、門を開けて1回だけ送信し直す
//
//  ここがやらないこと
//    ・ページのコードを書き換えない。fetch や XHR には触らない
//    ・入力欄の中身を読まない（下書きは ISOLATED 側が同じDOMから読む）
//    ・設定が届くまでは何もしない。素通し
// ============================================================================

(() => {
  const CHANNEL = 'memoria-handoff-gate';
  if (window.__memoriaGateInstalled) return;
  window.__memoriaGateInstalled = true;

  let config = null;      // { composer: [selector], send: [selector] }
  let armed = false;      // 設定が届き、かつ ISOLATED 側が生きている
  let waiting = false;    // 1回止めて、返事を待っている
  let bypass = false;     // 返事を受けて送信し直す1回だけ開ける

  const post = (message) => {
    try { window.postMessage({ __memoria: CHANNEL, ...message }, location.origin); }
    catch { /* 送れなければ素通しに戻る */ }
  };

  const firstMatch = (selectors) => {
    for (const selector of selectors || []) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  };

  const draftOf = (el) => {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA') return el.value;
    return el.innerText || el.textContent || '';
  };

  /// 止めるべきか。設定前・返事待ち・素通し中・空の下書きは止めない
  function shouldHold(event) {
    if (!armed || !config || bypass || waiting) return false;
    const composer = firstMatch(config.composer);
    if (!composer) return false;
    if (event.type === 'keydown') {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return false;
      if (!composer.contains(event.target)) return false;
    } else {
      const button = event.target && event.target.closest && event.target.closest((config.send || []).join(','));
      if (!button) return false;
    }
    return draftOf(composer).trim().length > 0;
  }

  function onEvent(event) {
    if (!shouldHold(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    waiting = true;
    post({ type: 'held', how: event.type });
  }

  // window のキャプチャに、ページのどのスクリプトより先に付ける。
  // document_start で走るので、この登録が最前列になる
  window.addEventListener('keydown', onEvent, true);
  window.addEventListener('click', onEvent, true);

  /// 1回だけ送信し直す。ボタンがあれば押す。無ければ Enter を投げる
  function release() {
    const composer = firstMatch(config && config.composer);
    bypass = true;
    waiting = false;
    let how = 'none';
    const button = firstMatch(config && config.send);
    if (button && !button.disabled) { button.click(); how = 'button'; }
    else if (composer) {
      composer.focus();
      composer.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      how = 'enter';
    }
    // 送信が拾われなかった時に門が開きっぱなしにならないよう、少し待って閉じる
    setTimeout(() => { bypass = false; }, 1500);
    post({ type: 'released', how });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__memoria !== CHANNEL || !data.toGate) return;
    if (data.type === 'config') { config = { composer: data.composer, send: data.send }; armed = true; post({ type: 'ready' }); return; }
    if (data.type === 'release') { release(); return; }
    if (data.type === 'cancel') { waiting = false; return; }   // 送らずに解除（利用者が入力を続ける）
  });
})();
