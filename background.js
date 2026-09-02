// ============================================================================
//  background.js（Chromium 系共通・MV3 service worker）
//
//  ここは「転送だけ」を行う層。**import を一切持たない**。
//
//  なぜ import を無くしたか（2026-08-06）
//    MV3 の module service worker は、依存の解決に失敗すると
//    worker 自体が登録されず、content script からの sendMessage が
//    どこにも届かないまま静かに失われる。原因が外から見えないので、
//    転送層だけは自己完結させ、解析・正規化は page world の共有コアに置く。
//
//  診断のため、各段階を本文なしのステータスとして host へ送る
//    service_worker_started / native_port_connected /
//    probe_record_sent / native_send_failed
// ============================================================================

const HOST = 'com.zerogrid.memoria.browserhost';
const CHANNEL = 'memoria-claude-web';
const PROTOCOL_VERSION = 'browser_capture_v1';
const BUILDER = 'background_v3_noimport';

/// 対象サイト（ここ以外からのメッセージは受け取らない）
const ALLOWED_ORIGINS = ['https://claude.ai', 'https://chatgpt.com', 'https://chat.openai.com',
                         'https://kimi.com', 'https://www.kimi.com', 'https://kimi.moonshot.cn',
                         'https://gemini.google.com'];

/// 記憶の引き渡し（handoff）。content script は localhost を直接触らず、ここ経由で
/// ローカルの memoria read API だけを引く。返すのは翻訳済みの理解（カード）だけ
const HANDOFF_CHANNEL = 'memoria-handoff';
const READ_API = 'http://127.0.0.1:4319';
const PROVIDER_LABEL = { anthropic: 'claude', openai: 'chatgpt', google: 'gemini', moonshot: 'kimi' };

// 拡張アイコンを押したら、現在のタブに対する記憶の蛇口を開く。
// 古いChromiumやテスト環境ではAPIが無いので、存在時だけ設定する。
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}


/// origin → provider。background は「どのサイトのタブから来たか」を知っているので、
/// provider は自己申告ではなくここで決める（payload の provider は信用しない）
const PROVIDER_BY_ORIGIN = {
  'https://claude.ai': 'anthropic',
  'https://chatgpt.com': 'openai',
  'https://chat.openai.com': 'openai',
  'https://kimi.com': 'moonshot',
  'https://www.kimi.com': 'moonshot',
  'https://kimi.moonshot.cn': 'moonshot',
};

function siteOf(sender) {
  const candidates = [sender.origin, sender.url, sender.tab && sender.tab.url].filter(Boolean);
  for (const value of candidates) {
    for (const origin of ALLOWED_ORIGINS) {
      if (value === origin || value.startsWith(origin + '/')) return origin;
    }
  }
  return null;
}

/// 外部結果（メール送信・フォーム送信）は AI provider の対応表に無い場所でも起きる。
/// そこは利用者が個別に許可したサイトなので、タブの origin をそのまま使う。
/// 実際に取り込むかどうかは collector 側の opt-in 一覧が決める
function originOf(sender) {
  const candidates = [sender.origin, sender.url, sender.tab && sender.tab.url].filter(Boolean);
  for (const value of candidates) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:') return url.origin;
    } catch { /* 次の候補へ */ }
  }
  return null;
}

function browserInfo() {
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  const named = brands.find((b) => !/Not.?A.?Brand/i.test(b.brand));
  return {
    browser_id: null,            // 正は host 側の判定（自己申告は補助証拠）
    browser_family: 'chromium',
    user_agent_brand: named ? named.brand : 'unknown',
    version: named ? named.version : 'unknown',
  };
}

function common() {
  return {
    protocol_version: PROTOCOL_VERSION,
    browser: browserInfo(),
    extension_id: chrome.runtime.id,
    extension_version: chrome.runtime.getManifest().version,
    sent_at: new Date().toISOString(),
  };
}

/// page world から来た payload を host が受け取る形へ包む。
/// record_type の判断はここ1箇所だけ（Firefox / Safari も同じ関数を持つ）
function buildRecord(payload, origin) {
  const provider = PROVIDER_BY_ORIGIN[origin] || 'unknown';
  // 外部結果（メール送信・フォーム送信）は別の record_type で送る。
  // 中身は content script 側で既に形だけに落としてある
  if (payload && payload.kind === 'outcome') {
    return {
      protocol_version: PROTOCOL_VERSION,
      record_type: 'outcome',
      outcome_kind: payload.outcome_kind,
      origin: origin,
      extension_id: chrome.runtime.id,
      extension_version: chrome.runtime.getManifest().version,
      occurred_at: payload.occurred_at,
      evidence: payload.evidence || null,
      acknowledged: payload.acknowledged === true,
      provider: payload.provider || null,
      thread_id: payload.thread_id || null,
      message_id: payload.message_id || null,
      recipient_count: typeof payload.recipient_count === 'number'
        ? payload.recipient_count : null,
      destination_domain_category: payload.destination_domain_category || null,
      form_fingerprint: payload.form_fingerprint || null,
      page_key: payload.page_key || null,
    };
  }
  if (payload && payload.kind === 'exchange') {
    return {
      ...common(),
      record_type: 'exchange',
      provider,
      origin,
      conversation_id: payload.conversation_id,
      message_id: payload.message_id,
      parent_message_id: payload.parent_message_id,
      role: payload.role,
      text: payload.text,
      is_partial: !!payload.is_partial,
      capture_method: payload.capture_method || 'direct_web',
      id_source: payload.id_source || 'official',
      completion_evidence: payload.completion_evidence,
      completion_evidence: payload.completion_evidence,
      provider_metadata: payload.provider_metadata,
      occurred_at: payload.occurred_at,
    };
  }
  return {
    ...common(),
    record_type: 'probe',
    provider,
    origin,
    payload,
  };
}

function sendToHost(record) {
  return new Promise((resolve) => {
    let port;
    try {
      port = chrome.runtime.connectNative(HOST);
    } catch (error) {
      resolve({ ok: false, reason: 'connect_failed' });
      return;
    }
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { port.disconnect(); } catch { /* noop */ }
      resolve(result);
    };
    port.onMessage.addListener((response) => done({ ok: true, response }));
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      done({ ok: false, reason: error ? String(error.message).slice(0, 80) : 'disconnected' });
    });
    try {
      port.postMessage(record);
    } catch {
      done({ ok: false, reason: 'post_failed' });
    }
  });
}

/// 診断用の段階記録（本文は持たない）
function stage(name, detail) {
  return sendToHost(buildRecord({ kind: 'stage', stage: name, detail: detail || null,
                                  observed_at: new Date().toISOString() },
                                ALLOWED_ORIGINS[0]));
}

async function handoffCards(query, provider) {
  const url = new URL('/handoff', READ_API);
  url.searchParams.set('q', String(query || '').slice(0, 500));
  url.searchParams.set('limit', '5');
  url.searchParams.set('ai', PROVIDER_LABEL[provider] || provider || 'unknown');
  const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`api_${response.status}`);
  const json = await response.json();
  return Array.isArray(json.cards) ? json.cards : [];
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.channel === HANDOFF_CHANNEL) {
    const origin = siteOf(sender);
    if (!origin) return;
    const provider = PROVIDER_BY_ORIGIN[origin] || 'unknown';
    if (message.type === 'cards') {
      handoffCards(message.query, provider)
        .then((cards) => sendResponse({ ok: true, cards }))
        .catch((error) => sendResponse({ ok: false, reason: String(error && error.message).slice(0, 80), cards: [] }));
      return true;
    }
    if (message.type === 'get_mode') {
      chrome.storage.local.get(`handoff_mode.${provider}`)
        .then((stored) => sendResponse({ ok: true, mode: stored[`handoff_mode.${provider}`] || 'ask' }))
        .catch(() => sendResponse({ ok: true, mode: 'ask' }));
      return true;
    }
    if (message.type === 'set_mode') {
      const mode = ['ask', 'auto', 'off'].includes(message.mode) ? message.mode : 'ask';
      chrome.storage.local.set({ [`handoff_mode.${provider}`]: mode })
        .then(() => sendResponse({ ok: true, mode }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
    return;
  }
  if (!message || message.channel !== CHANNEL) return;
  // 送信元の検証。content script から動的 import した module 経由だと
  // sender.url が chrome-extension:// になることがあるので、
  // origin / tab の URL も見て「対象サイトのタブから来たか」で判断する
  const isOutcome = message.payload && message.payload.kind === 'outcome';
  const origin = siteOf(sender) || (isOutcome ? originOf(sender) : null);
  if (!origin) return;
  sendToHost(buildRecord(message.payload, origin)).then(sendResponse);
  return true;   // 非同期応答
});

// service worker が起き上がったこと自体を記録する（届かなければ SW が動いていない）
stage('service_worker_started', BUILDER);

// ---- 拡張を読み込み直したあとの復旧 ------------------------------------------
//
// 拡張を再読み込みすると、開いたままのタブで動いていた content script は
// その場で無効になる（chrome.runtime が使えなくなる）。
// タブを再読み込みしない限り取り込みが止まったままになり、
// しかも画面には何も出ないので気づけない（2026-08-07 に実際に取りこぼした）。
//
// 起動時に、対象サイトのタブへ自分で入れ直す。
// 二重に入っても content script 側が自分で気づいて何もしない
const INJECT_MATCHES = [
  'https://claude.ai/*',
  'https://chatgpt.com/*', 'https://chat.openai.com/*',
  'https://kimi.com/*', 'https://www.kimi.com/*', 'https://kimi.moonshot.cn/*',
  'https://gemini.google.com/*',
];

async function reinjectOpenTabs(reason) {
  if (!chrome.scripting || !chrome.tabs) return;
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ url: INJECT_MATCHES });
  } catch (error) {
    stage('reinject_failed', String(error && error.message));
    return;
  }
  let injected = 0;
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, files: ['early-hook.js'], world: 'MAIN' });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id }, files: ['content.js'], world: 'ISOLATED' });
      injected += 1;
    } catch { /* 権限の無いタブは飛ばす */ }
  }
  stage('reinjected_open_tabs', `${reason}:${injected}/${tabs.length}`);
}

/// 利用者がサイトを個別に許可したら、そこにも content script を入れる。
/// 許可されるまでは何も入らない（インストール時に広い権限を求めない）
async function registerGrantedSites() {
  if (!chrome.permissions || !chrome.scripting) return;
  let granted;
  try { granted = await chrome.permissions.getAll(); } catch { return; }
  const extra = (granted.origins || []).filter((o) => !ALLOWED_ORIGINS
    .some((known) => o.startsWith(known)));
  if (!extra.length) return;
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ['memoria-outcome'] });
  } catch { /* まだ無いだけ */ }
  try {
    await chrome.scripting.registerContentScripts([{
      id: 'memoria-outcome',
      matches: extra,
      js: ['content.js'],
      runAt: 'document_idle',
      world: 'ISOLATED',
    }]);
    stage('outcome_sites_registered', String(extra.length));
  } catch (error) {
    stage('outcome_sites_register_failed', String(error && error.message));
  }
}
chrome.permissions?.onAdded?.addListener(() => registerGrantedSites());
registerGrantedSites();

chrome.runtime.onStartup?.addListener(() => {
  stage('service_worker_started', 'on_startup');
  reinjectOpenTabs('startup');
});
chrome.runtime.onInstalled?.addListener(() => {
  stage('service_worker_started', 'on_installed');
  reinjectOpenTabs('installed');
});
// service worker が起き直しただけのときも、取りこぼしが無いか見に行く
reinjectOpenTabs('worker_started');
