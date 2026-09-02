// ============================================================================
//  outcome-capture.js — 外部で確定した結果を content script から観測する（M6A）
//
//  対象は2つ。
//    ・メール送信  … 送信して、送信できたことが確かめられたとき
//    ・フォーム送信 … 送信して、受け付けられたことが確かめられたとき
//
//  いちばん大事な約束
//    **押しただけでは確定にしない。** 成功の証拠が要る。
//
//  そして **中身は一切見ない。**
//    本文・件名・宛先・入力値・token は読まない。読める形の関数も置かない。
//    出すのは「何件宛てだったか」「どんな形のフォームだったか」まで。
//
//  自動化対策の回避も、内部コードの改変も、認証フローへの介入もしない。
//  ページが普通に出している通信の成否と、普通に出る確認表示だけを見る
// ============================================================================

/// provider ごとの見どころ。ここだけが差分
export const OUTCOME_PROFILES = {
  gmail: {
    origins: ['https://mail.google.com'],
    // 送信の通信（ページ自身が出すもの）
    sendRequest: (url) => /\/mail\/u\/\d+\/.*(SendMessage|sendmessage)/.test(url)
      || /\/sync\/u\/\d+\/i\/s\b/.test(url),
    // 送信できたことを示す表示（Gmail は「メッセージを送信しました」を出す）
    ackSelectors: ['[aria-live="assertive"]', '.bAq', '.vh'],
    ackPattern: /送信しました|Message sent|メッセージを送信/i,
  },
};

export function outcomeProfileForOrigin(origin) {
  for (const [id, profile] of Object.entries(OUTCOME_PROFILES)) {
    if (profile.origins.includes(origin)) return { id, ...profile };
  }
  return null;
}

/// URL の可変部分を伏せた形。どのページかは分かるが、ID は残さない
export function pageKey(href) {
  try {
    const url = new URL(href);
    const path = url.pathname.split('/').map((part) => {
      if (!part) return part;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(part)) return '<uuid>';
      if (/^[A-Za-z0-9_-]{16,}$/.test(part)) return '<id>';
      if (/^\d+$/.test(part)) return '<n>';
      return part;
    }).join('/');
    return url.origin + path;
  } catch {
    return '<unparsable>';
  }
}

/// フォームの「形」。項目の種類と数だけを見る。**値は読まない**
export async function formFingerprint(form) {
  const shapes = [];
  let elements = [];
  try { elements = [...form.querySelectorAll('input, select, textarea')]; } catch { /* noop */ }
  for (const element of elements) {
    const type = (element.getAttribute('type') || element.tagName || '').toLowerCase();
    // name は項目の種類を表すので形として残すが、値は決して読まない
    const name = (element.getAttribute('name') || '').slice(0, 40);
    shapes.push(`${type}:${name}`);
  }
  const source = [pageKey(location.href), shapes.sort().join('|')].join('#');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `form-${hex.slice(0, 24)}`;
}

/// 宛先の「向き」だけを分類する。ドメイン名そのものは出さない
export function destinationCategory(recipientDomains, ownDomain) {
  if (!recipientDomains || !recipientDomains.length) return 'unknown';
  const external = recipientDomains.filter((d) => d && d !== ownDomain).length;
  if (external === 0) return 'same_domain';
  if (external === recipientDomains.length) return 'external';
  return 'mixed';
}

// ---- フォーム送信 ------------------------------------------------------------

/// submit を見て、成功の証拠が揃ったときだけ確定として渡す。
///   emit(record) … { kind:'outcome', outcome_kind:'form_submit', ... }
export function installFormOutcome({ emit, confirmWindowMs = 8000 }) {
  const pending = new Map();   // fingerprint -> { at, evidence:Set, timer }

  function finish(fingerprint) {
    const entry = pending.get(fingerprint);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(fingerprint);
    const evidence = [...entry.evidence];
    // 押しただけでは確定にしない。成功を示す証拠が2つ以上要る
    const strong = evidence.filter((e) => e === 'post_ok' || e === 'navigated'
                                       || e === 'success_ui');
    emit({
      kind: 'outcome',
      outcome_kind: 'form_submit',
      origin: location.origin,
      page_key: entry.pageKey,
      form_fingerprint: fingerprint,
      acknowledged: strong.length >= 2,
      evidence,
      occurred_at: entry.at,
    });
  }

  const onSubmit = (event) => {
    const form = event.target;
    if (!form || form.tagName !== 'FORM') return;
    formFingerprint(form).then((fingerprint) => {
      const entry = { at: new Date().toISOString(), evidence: new Set(['submit_click']),
                      pageKey: pageKey(location.href), timer: null };
      entry.timer = setTimeout(() => finish(fingerprint), confirmWindowMs);
      pending.set(fingerprint, entry);
    }).catch(() => { /* 観測でページを壊さない */ });
  };

  /// ページが出した通信の成否・遷移・成功表示を証拠として足す
  function addEvidence(name) {
    for (const entry of pending.values()) entry.evidence.add(name);
  }

  const onUnload = () => { addEvidence('navigated'); for (const key of pending.keys()) finish(key); };
  const onMessage = (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.channel !== 'memoria-outcome-signal') return;
    if (typeof event.data.evidence === 'string') addEvidence(event.data.evidence);
  };

  try {
    document.addEventListener('submit', onSubmit, true);
    window.addEventListener('pagehide', onUnload);
    window.addEventListener('message', onMessage);
  } catch { /* 使えない環境では何もしない */ }

  return () => {
    try {
      document.removeEventListener('submit', onSubmit, true);
      window.removeEventListener('pagehide', onUnload);
      window.removeEventListener('message', onMessage);
    } catch { /* noop */ }
    for (const entry of pending.values()) clearTimeout(entry.timer);
    pending.clear();
  };
}

// ---- メール送信 --------------------------------------------------------------

/// 送信操作と、送信できたことを示す表示の両方が揃って初めて確定にする
export function installEmailOutcome({ profile, emit, confirmWindowMs = 12000,
                                      pollMs = 500 }) {
  if (!profile) return () => {};
  let pending = null;

  function ackVisible() {
    for (const selector of profile.ackSelectors) {
      let nodes = [];
      try { nodes = [...document.querySelectorAll(selector)]; } catch { continue; }
      for (const node of nodes) {
        if (profile.ackPattern.test((node.innerText || '').trim())) return true;
      }
    }
    return false;
  }

  function finish(acknowledged) {
    if (!pending) return;
    const entry = pending;
    pending = null;
    emit({
      kind: 'outcome',
      outcome_kind: 'email_send',
      provider: profile.id,
      // スレッド・メッセージの ID は「どのやり取りか」を指すだけで中身を含まない。
      // 取れないことも多いので、無ければ入れない
      thread_id: entry.threadID || null,
      message_id: entry.messageID || null,
      recipient_count: entry.recipientCount ?? null,
      destination_domain_category: entry.destinationCategory || 'unknown',
      acknowledged,
      evidence: acknowledged ? [...entry.evidence, 'send_ack'] : [...entry.evidence],
      occurred_at: entry.at,
    });
  }

  /// 送信操作が起きたことを外から知らせる（クリック・通信のどちらでもよい）
  function noteSendStarted(detail = {}) {
    if (pending) return;
    pending = { at: new Date().toISOString(), evidence: ['send_click'],
                threadID: detail.threadID, messageID: detail.messageID,
                recipientCount: detail.recipientCount,
                destinationCategory: detail.destinationCategory,
                startedAt: Date.now() };
  }

  const timer = setInterval(() => {
    if (!pending) return;
    if (ackVisible()) { finish(true); return; }
    // 待っても確認表示が出なければ、候補のまま残す（確定にはしない）
    if (Date.now() - pending.startedAt >= confirmWindowMs) finish(false);
  }, pollMs);

  const onMessage = (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.channel !== 'memoria-outcome-signal') return;
    if (event.data.evidence === 'send_request') noteSendStarted(event.data.detail || {});
  };
  try { window.addEventListener('message', onMessage); } catch { /* noop */ }

  return {
    noteSendStarted,
    stop() {
      clearInterval(timer);
      try { window.removeEventListener('message', onMessage); } catch { /* noop */ }
    },
  };
}
