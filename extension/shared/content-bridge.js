// ============================================================================
//  content-bridge.js — page world ↔ extension の橋渡し（共有）
//
//  ・受け取るのは https://claude.ai の window から来た自分のチャンネルだけ
//  ・page world 側で匿名化・正規化を済ませたものをそのまま background へ渡す
//  ・URL・タイトル・閲覧履歴に類するものは一切足さない
// ============================================================================

const CHANNEL = 'memoria-claude-web';
/// 再送の間隔（ミリ秒）。service worker が起き上がるまでを埋める
const RETRY_DELAYS = [0, 120, 400, 1200, 3000, 8000];
const ORIGIN = 'https://claude.ai';

export function installBridge(runtime) {
  /// service worker が起きるまで待ちながら送る。
  ///
  /// MV3 の service worker は寝ている。ページを開いた直後に送ると
  /// 「受け手がいない」で静かに失われ、会話が1件まるごと落ちる
  /// （2026-08-06 に実測した不具合）。ここは必ず再送する
  function forward(payload, attempt = 0) {
    let result;
    try {
      result = runtime.sendMessage({ channel: CHANNEL, payload });
    } catch (error) {
      retry(payload, attempt, String(error && error.message));
      return;
    }
    if (result && typeof result.then === 'function') {
      result.then(
        (response) => { if (response === undefined) retry(payload, attempt, 'no_response'); },
        (error) => retry(payload, attempt, String(error && error.message)));
    }
  }

  function retry(payload, attempt, reason) {
    const next = attempt + 1;
    if (next >= RETRY_DELAYS.length) {
      console.warn('[memoria] bridge give up after retries:', reason);
      return;
    }
    setTimeout(() => forward(payload, next), RETRY_DELAYS[next]);
  }

  // 診断: bridge が生きていること（本文は持たない）
  forward({ kind: 'stage', stage: 'content_bridge_ready', origin: location.origin,
            observed_at: new Date().toISOString() });

  // content script 側から直接送れるようにして返す。
  // 表示から読む経路は page world を経由しないので、この口を使う

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;                 // 別 frame からは受けない
    if (event.origin !== location.origin) return;        // 自分のページ以外は受けない
    const message = event.data;
    if (!message || message.channel !== CHANNEL || !message.payload) return;
    forward(message.payload);
  });

  return { forward: (payload) => forward(payload) };
}

/// page world へ hook を注入する（MAIN world への script 注入は
/// ブラウザによって方式が違うので、呼び出し側 = 各ブラウザの content script が担当）
export function injectPageHook(scriptURL, documentRef = document) {
  const script = documentRef.createElement('script');
  script.type = 'module';
  script.src = scriptURL;
  script.dataset.memoria = 'claude-web-hook';
  (documentRef.head || documentRef.documentElement).appendChild(script);
  script.remove();
}

export { CHANNEL, ORIGIN };
