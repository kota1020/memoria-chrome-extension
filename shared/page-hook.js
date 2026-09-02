// ============================================================================
//  page-hook.js — page world で Claude Web の通信を「読むだけ」観測する
//  （Cross-Browser Claude Web Capture の共有コア / M5B-0 は Probe モードのみ）
//
//  ・fetch を包むが、リクエストもレスポンスも改変しない（tee して読むだけ）
//  ・対象は claude.ai の会話 API だけ。それ以外の通信には触れない
//  ・M5B-0 では本文を page world の外へ出さない。
//    構造（キーパス・値の形・SSE イベント種別・時刻）だけを anonymize.js で畳んでから
//    content script へ postMessage する
//  ・M5B-1 で capture-core.js が同じフックを使い、本文つきの正規化を行う
// ============================================================================

import { keyShape, shapeOf, urlPattern, idTag, UUID_RE } from './anonymize.js';
import { classifyRequest, parseRequest, createStreamAssembler } from './capture-core.js';
import { providerIDForOrigin } from './providers.js';

const CHANNEL = 'memoria-claude-web';
const ORIGIN = 'https://claude.ai';

/// 会話 API かどうか。ここを狭く保つことが「閲覧履歴を集めない」の実装上の芯
export function isConversationAPI(rawURL) {
  try {
    const url = new URL(rawURL, location.href);
    if (url.origin !== ORIGIN) return false;
    return /\/api\/organizations\/[^/]+\/chat_conversations(\/|$)/.test(url.pathname)
      || /\/api\/.*\/completion(\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

function post(payload) {
  // origin と provider は page world が知っている事実として必ず載せる
  const enriched = { origin: location.origin, provider: providerIDForOrigin(location.origin),
                     ...payload };
  window.postMessage({ channel: CHANNEL, payload: enriched }, location.origin);
}

/// SSE の生テキストから「イベント種別と data のキー構造」だけを取り出す
async function digestSSEChunk(text, state) {
  for (const block of text.split('\n\n')) {
    if (!block.trim()) continue;
    let eventName = null;
    const dataLines = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) continue;
    let parsed = null;
    try {
      parsed = JSON.parse(dataLines.join('\n'));
    } catch {
      state.events.push({ event: eventName ?? '<none>', data: '<unparsable>' });
      continue;
    }
    const type = eventName ?? parsed.type ?? '<none>';
    // 同じ種別が何度も来る（delta）ので、初回だけ構造を残して以後は数える
    const known = state.byType.get(type);
    if (known) {
      known.count += 1;
      known.last_offset_ms = Math.round(performance.now() - state.startedAt);
    } else {
      state.byType.set(type, {
        count: 1,
        first_offset_ms: Math.round(performance.now() - state.startedAt),
        last_offset_ms: Math.round(performance.now() - state.startedAt),
        keys: await keyShape(parsed),
      });
    }
  }
}

async function probeRequestBody(init, request) {
  let bodyText = null;
  try {
    if (init && typeof init.body === 'string') bodyText = init.body;
    else if (request && request.method !== 'GET') bodyText = await request.clone().text();
  } catch { /* 読めなければ構造は諦める（通信は壊さない） */ }
  if (!bodyText) return null;
  try {
    return await keyShape(JSON.parse(bodyText));
  } catch {
    return { '.': `str(${bodyText.length})` };
  }
}

export function installProbeHook() {
  const originalFetch = window.fetch;
  let disabled = false;

  /// 観測でページを壊さないための最後の砦。
  /// 一度でも自分の処理で例外が出たら、以後は素の fetch へ戻して二度と触らない
  function disableHook(reason) {
    if (disabled) return;
    disabled = true;
    try { window.fetch = originalFetch; } catch { /* noop */ }
    try { post({ kind: 'probe_hook_disabled', reason: String(reason), observed_at: new Date().toISOString() }); } catch { /* noop */ }
  }

  /// レスポンスは絶対に作り直さない（原本をそのまま返す）。
  /// 観測は clone() 側だけで行い、読み切って捨てる
  function probeResponse(response, record, startedAt) {
    const contentType = response.headers.get('content-type') || '';
    record.status = response.status;
    record.content_type = contentType.split(';')[0];

    let clone;
    try {
      clone = response.clone();
    } catch (error) {
      record.clone_error = String(error && error.name);
      post(record);
      return;
    }

    (async () => {
      try {
        if (contentType.includes('text/event-stream') && clone.body) {
          const state = { startedAt, byType: new Map(), events: [] };
          const reader = clone.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let seen = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            seen += value ? value.length : 0;
            if (seen > 8 * 1024 * 1024) { record.stream_truncated = true; break; }
            buffer += decoder.decode(value, { stream: true });
            const cut = buffer.lastIndexOf('\n\n');
            if (cut >= 0) {
              await digestSSEChunk(buffer.slice(0, cut), state);
              buffer = buffer.slice(cut + 2);
            }
          }
          if (buffer.trim()) await digestSSEChunk(buffer, state);
          record.stream = {
            total_ms: Math.round(performance.now() - startedAt),
            event_order: [...state.byType.keys()],
            event_types: Object.fromEntries(state.byType),
          };
        } else if (contentType.includes('application/json')) {
          record.response_keys = await keyShape(await clone.json());
        } else {
          // 本文は読まない（型だけ残す）
          try { await clone.body?.cancel(); } catch { /* noop */ }
        }
      } catch (error) {
        record.stream_error = String(error && error.name);
      }
      post(record);
    })();
  }

  window.fetch = function memoriaProbeFetch(input, init) {
    // ここから先で何が起きても、ページの通信は素の fetch の結果をそのまま返す
    const result = originalFetch.apply(this, arguments);
    if (disabled) return result;

    try {
      const rawURL = typeof input === 'string' ? input : (input && input.url) || '';
      if (!isConversationAPI(rawURL)) return result;

      const method = (init && init.method)
        || (typeof input === 'object' && input && input.method)
        || 'GET';
      const startedAt = performance.now();
      const record = {
        kind: 'probe_exchange',
        url_pattern: urlPattern(rawURL, location.href),
        method,
        observed_at: new Date().toISOString(),
      };

      // リクエスト本文の構造（送信そのものは待たせない）
      probeRequestBody(init, typeof input === 'object' ? input : null)
        .then((keys) => { record.request_keys = keys; })
        .catch(() => { record.request_keys = null; });

      result.then(
        (response) => { try { probeResponse(response, record, startedAt); } catch (e) { disableHook(e); } },
        () => { /* 通信エラーはページ側の問題。観測は何もしない */ }
      );
    } catch (error) {
      disableHook(error);
    }
    return result;
  };

  post({ kind: 'stage', stage: 'page_hook_ready', detail: 'probe',
         observed_at: new Date().toISOString() });
  post({ kind: 'probe_hook_installed', observed_at: new Date().toISOString() });
}

// ============================================================================
//  本番モード（M5B-1）— prompt と確定 response を取り出して渡す
//
//  Probe モードと同じく「原本のレスポンスは一切触らない」。観測は clone だけ。
//  何かあれば自分を無効化してページを素の状態へ戻す
// ============================================================================

export function installCaptureHook() {
  const originalFetch = window.fetch;
  let disabled = false;

  function disable(reason) {
    if (disabled) return;
    disabled = true;
    try { window.fetch = originalFetch; } catch { /* noop */ }
    try {
      post({ kind: 'capture_degraded', reason: String(reason),
             observed_at: new Date().toISOString() });
    } catch { /* noop */ }
  }

  function emitExchange(fields) {
    post({ kind: 'exchange', ...fields });
  }

  async function observe(response, context) {
    const contentType = response.headers.get('content-type') || '';
    // エラー応答（429 / 529 など）は JSON で返る。確定 response として扱わない
    if (!response.ok || !contentType.includes('text/event-stream') || !response.body) {
      post({ kind: 'capture_skipped', reason: `status_${response.status}`,
             observed_at: new Date().toISOString() });
      return;
    }
    let clone;
    try {
      clone = response.clone();
    } catch (error) {
      disable(error);
      return;
    }
    const assembler = createStreamAssembler();
    const reader = clone.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value ? value.length : 0;
        if (bytes > 16 * 1024 * 1024) break;      // 異常に長い応答は打ち切る
        buffer += decoder.decode(value, { stream: true });
        const cut = buffer.lastIndexOf('\n\n');
        if (cut >= 0) {
          assembler.push(buffer.slice(0, cut));
          buffer = buffer.slice(cut + 2);
        }
      }
      if (buffer.trim()) assembler.push(buffer);
    } catch (error) {
      post({ kind: 'capture_skipped', reason: 'stream_read_failed',
             observed_at: new Date().toISOString() });
      return;
    }

    // streaming 途中を確定 response にしない
    if (!assembler.isComplete()) {
      post({ kind: 'capture_skipped', reason: 'stream_incomplete',
             observed_at: new Date().toISOString() });
      return;
    }
    const text = assembler.text();
    if (!text) {
      // 可視 text が1つも無い（thinking だけ等）なら response を作らない
      post({ kind: 'capture_skipped', reason: 'no_visible_text',
             observed_at: new Date().toISOString() });
      return;
    }
    const messageID = assembler.assistantMessageID() || context.assistantMessageID;
    if (!messageID) {
      post({ kind: 'capture_skipped', reason: 'assistant_id_missing',
             observed_at: new Date().toISOString() });
      return;
    }
    emitExchange({
      conversation_id: context.conversationID,
      message_id: messageID,
      parent_message_id: assembler.parentMessageID() || context.parentForAssistant,
      role: 'assistant',
      text,
      is_partial: assembler.isPartial(),
      stop_reason: assembler.stopReason(),
      occurred_at: new Date().toISOString(),
    });
  }

  window.fetch = function memoriaCaptureFetch(input, init) {
    const result = originalFetch.apply(this, arguments);
    if (disabled) return result;
    try {
      const rawURL = typeof input === 'string' ? input : (input && input.url) || '';
      const classified = classifyRequest(rawURL, location.href);
      if (!classified) return result;

      const context = {
        conversationID: classified.conversationID,
        assistantMessageID: null,
        parentForAssistant: null,
      };

      // リクエスト本文から prompt 側を決める（送信は待たせない）
      probeRequestBodyText(init, typeof input === 'object' ? input : null)
        .then((bodyText) => {
          if (!bodyText) return;
          const parsed = parseRequest(bodyText);
          if (!parsed) return;
          context.assistantMessageID = parsed.assistantMessageID;
          context.parentForAssistant = parsed.humanMessageID || parsed.parentMessageID;
          // 再生成（prompt 空）では prompt を作らない
          if (!parsed.hasPrompt) return;
          emitExchange({
            conversation_id: classified.conversationID,
            message_id: parsed.humanMessageID,
            parent_message_id: parsed.parentMessageID,
            role: 'user',
            text: parsed.prompt,
            is_partial: false,
            occurred_at: new Date().toISOString(),
          });
        })
        .catch(() => { /* 解析できなければ何も出さない */ });

      result.then(
        (response) => { observe(response, context).catch((e) => disable(e)); },
        () => { /* 通信失敗はページ側の問題 */ }
      );
    } catch (error) {
      disable(error);
    }
    return result;
  };

  // 通信からは取れない provider（ChatGPT / Kimi）は、表示から読む経路も併用する。
  // 起動時点で既に出ている過去履歴は取り込まない（dom-capture.js の責任）
  // 表示から読む経路は content script 側（content-capture.js）が持つ。
  // page world への注入が届かないページがあるので、そこに依存させない

  post({ kind: 'stage', stage: 'page_hook_ready', detail: 'capture',
         observed_at: new Date().toISOString() });
  post({ kind: 'capture_hook_installed', observed_at: new Date().toISOString() });
}

async function probeRequestBodyText(init, request) {
  try {
    if (init && typeof init.body === 'string') return init.body;
    if (request && request.method !== 'GET') return await request.clone().text();
  } catch { /* 読めなければ諦める */ }
  return null;
}

export { CHANNEL, ORIGIN, idTag, shapeOf, UUID_RE };
