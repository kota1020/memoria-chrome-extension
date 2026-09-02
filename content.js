// ============================================================================
//  content.js（Chromium 系共通）— ISOLATED world 側
//
//  ・page world へ共有 hook を注入する
//  ・page world から来た匿名化済みレコードだけを background へ渡す
//  ・claude.ai 以外では manifest の matches により、そもそも読み込まれない
//  ・Probe 用の salt は拡張インストール単位で保持する（端末外へは出ない）
// ============================================================================

(async () => {
  // 拡張の再読み込み後に background から入れ直されることがある。
  // 既に動いていれば何もしない（橋を二重に張らない）
  if (window.__memoriaContentInstalled) return;
  window.__memoriaContentInstalled = true;

  const bridge = await import(chrome.runtime.getURL('shared/content-bridge.js'));
  const channel = bridge.installBridge(chrome.runtime);

  let salt = '';
  try {
    const stored = await chrome.storage.local.get('probe_salt');
    salt = stored.probe_salt || '';
    if (!salt) {
      salt = [...crypto.getRandomValues(new Uint8Array(16))]
        .map((b) => b.toString(16).padStart(2, '0')).join('');
      await chrome.storage.local.set({ probe_salt: salt });
    }
  } catch { /* storage が使えなければ salt 無しで続行（同一性検証だけ落ちる） */ }

  // 既定は本番（capture）。storage に probe_mode を立てたときだけ構造調査モード
  let mode = 'capture';
  try {
    const stored = await chrome.storage.local.get('probe_mode');
    if (stored.probe_mode === true) mode = 'probe';
  } catch { /* 既定のまま */ }

  const params = new URLSearchParams({ mode });
  if (salt) params.set('salt', salt);
  
  // 表示から読む経路（ChatGPT / Kimi）。page world の注入とは独立に動かす。
  // 注入がページ側の事情で届かなくても、ここは動く
  try {
    const capture = await import(chrome.runtime.getURL('shared/content-capture.js'));
    capture.installContentCapture({ emit: (record) => channel.forward(record) });
  } catch (error) {
    channel.forward({ kind: 'stage', stage: 'dom_capture_unavailable',
                     detail: String(error && error.message),
                     observed_at: new Date().toISOString() });
  }


  // 外部で確定した結果（メール送信・フォーム送信）。
  // 許可されたサイトでしか動かず、押しただけでは確定にしない
  try {
    const outcome = await import(chrome.runtime.getURL('shared/content-capture.js'));
    outcome.installOutcomeCapture({ emit: (record) => channel.forward(record) });
  } catch (error) {
    channel.forward({ kind: 'stage', stage: 'outcome_capture_unavailable',
                      detail: String(error && error.message),
                      observed_at: new Date().toISOString() });
  }


  // 記憶の引き渡し（ChatGPT / Claude / Gemini の入力欄へ、確認つきで足す）。
  // capture（読む）とは独立。read API が落ちていても送信は止めない
  try {
    const handoff = await import(chrome.runtime.getURL('shared/handoff.js'));
    const profile = handoff.composerProfileForOrigin(location.origin);
    if (profile) {
      const ask = (msg) => new Promise((resolve) => {
        try { chrome.runtime.sendMessage({ channel: 'memoria-handoff', ...msg }, (r) => resolve(r || {})); }
        catch { resolve({}); }
      });
      handoff.installHandoff({
        profile,
        fetchCards: async (query) => { const r = await ask({ type: 'cards', query }); if (r.ok === false) throw new Error(r.reason || 'api'); return r.cards || []; },
        getMode: async () => (await ask({ type: 'get_mode' })).mode || 'ask',
        setMode: async (mode) => { await ask({ type: 'set_mode', mode }); },
        onStage: (stage, detail) => channel.forward({ kind: 'stage', stage, detail: detail || null, observed_at: new Date().toISOString() }),
      });
    }
  } catch (error) {
    channel.forward({ kind: 'stage', stage: 'handoff_unavailable', detail: String(error && error.message),
                      observed_at: new Date().toISOString() });
  }

  bridge.injectPageHook(`${chrome.runtime.getURL('shared/page-boot.js')}?${params}`);
})();
