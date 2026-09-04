// ============================================================================
//  background.js — 実測を溜めて、このMacの中の memoria へまとめて渡す
//
//  content script は 127.0.0.1 を直接叩けない（CORS）ので、ここが唯一の送り口。
//  送り先は http://127.0.0.1:4319 の1本だけ。外部サーバーへは接続しない。
//
//  memoria が起動していない時は捨てずに少しだけ持っておき、次に繋がった時に渡す。
//  持ちすぎない（上限 200 件）。増え続けるくらいなら古いものから落とす
// ============================================================================

const DEFAULTS = {
  enabled: true,
  endpoint: 'http://127.0.0.1:4319',
  path: '/ingest/page',
  denylist: [],          // ここに入れたホストは本文を送らない（URLとタイトルだけ）
  offlist: [],           // ここに入れたホストは何も送らない
};

const QUEUE_LIMIT = 200;
const FLUSH_MS = 5000;
const state = { queue: [], flushing: false, lastError: null, sentTotal: 0, lastSentAt: null };

async function settings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
const matchesHost = (host, list) =>
  (list || []).some((entry) => {
    const e = String(entry || '').trim().toLowerCase();
    if (!e) return false;
    return host === e || host.endsWith(`.${e}`);
  });

/// 送る前に、利用者の設定で落とす分をここで落とす。
/// 落としたものは queue に入れない（後から漏れない）
function admit(event, config) {
  const host = hostOf(event.url);
  if (!host) return null;
  if (matchesHost(host, config.offlist)) return null;
  if (matchesHost(host, config.denylist)) {
    return { ...event, text: '', text_chars: 0, text_skipped: 'denylist' };
  }
  return event;
}

async function flush() {
  if (state.flushing || !state.queue.length) return;
  const config = await settings();
  if (!config.enabled) return;
  state.flushing = true;
  const batch = state.queue.slice(0, 50);
  try {
    const response = await fetch(`${config.endpoint}${config.path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        v: 1,
        source: 'chrome-extension',
        extension_version: chrome.runtime.getManifest().version,
        sent_at: new Date().toISOString(),
        events: batch,
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error(`api_${response.status}`);
    state.queue = state.queue.slice(batch.length);
    state.sentTotal += batch.length;
    state.lastSentAt = new Date().toISOString();
    state.lastError = null;
  } catch (error) {
    // memoria が動いていないだけのことが多い。溜めたまま次の機会を待つ
    state.lastError = String(error && error.message).slice(0, 80);
  } finally {
    state.flushing = false;
    await chrome.storage.session?.set?.({ queue: state.queue }).catch?.(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;

  if (message.channel === 'memoria-page' && message.event) {
    settings().then((config) => {
      if (!config.enabled) return;
      const event = admit({ ...message.event, tab_id: sender.tab?.id ?? null }, config);
      if (!event) return;
      state.queue.push(event);
      if (state.queue.length > QUEUE_LIMIT) state.queue = state.queue.slice(-QUEUE_LIMIT);
      if (state.queue.length >= 20) flush();
    });
    return;
  }

  if (message.channel === 'memoria-status') {
    settings().then((config) => sendResponse({
      enabled: config.enabled,
      endpoint: config.endpoint + config.path,
      queued: state.queue.length,
      sentTotal: state.sentTotal,
      lastSentAt: state.lastSentAt,
      lastError: state.lastError,
    }));
    return true;
  }

  if (message.channel === 'memoria-flush') { flush().then(() => sendResponse({ ok: true })); return true; }
  return;
});

chrome.alarms?.create?.('memoria-flush', { periodInMinutes: 1 });
chrome.alarms?.onAlarm?.addListener?.((alarm) => { if (alarm.name === 'memoria-flush') flush(); });
setInterval(flush, FLUSH_MS);
