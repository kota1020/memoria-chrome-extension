// ============================================================================
//  capture-core.js — Claude Web の prompt / 確定 response を取り出す共有コア
//  （Cross-Browser Claude Web Capture / M5B-1）
//
//  ブラウザに依存しない処理はすべてここにある。Chromium / Firefox / Safari は
//  「注入方法」と「host への渡し方」だけが違い、この解析は1本しかない。
//
//  実機 Probe（2026-08-05・extension/PROBE-M5B-0.md）で確かめた構造
//    送信      POST .../chat_conversations/<conv>/completion
//              request.prompt / request.turn_message_uuids.{human,assistant}_message_uuid
//              request.parent_message_uuid
//    再生成    POST .../retry_completion（prompt は空・assistant uuid だけ新規）
//    streaming SSE  message_start → content_block_start → content_block_delta*
//                   → content_block_stop → message_delta(stop_reason) → message_stop
//
//  絶対に保存しないもの
//    ・thinking ブロック（content_block.type === 'thinking'）
//    ・tools / attachments / files / 認証ヘッダ
//    ・claude.ai 以外の通信
// ============================================================================

export const CONVERSATION_PATH_RE =
  /\/api\/organizations\/[^/]+\/chat_conversations\/([0-9a-f-]{36})\/(completion|retry_completion)(\/|$)/i;

/// 送信・再生成のエンドポイントか。会話 ID と種別を返す
export function classifyRequest(rawURL, base) {
  let url;
  try {
    url = new URL(rawURL, base);
  } catch {
    return null;
  }
  const match = CONVERSATION_PATH_RE.exec(url.pathname);
  if (!match) return null;
  return { conversationID: match[1], kind: match[2] };
}

/// 送信リクエストから prompt 側の情報を取り出す。
/// 再生成（prompt が空）では prompt レコードを作らない
export function parseRequest(bodyText) {
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return null;
  }
  const uuids = body.turn_message_uuids || {};
  const humanID = typeof uuids.human_message_uuid === 'string' ? uuids.human_message_uuid : null;
  const assistantID = typeof uuids.assistant_message_uuid === 'string'
    ? uuids.assistant_message_uuid : null;
  const parentID = typeof body.parent_message_uuid === 'string' ? body.parent_message_uuid : null;
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  return {
    humanMessageID: humanID,
    assistantMessageID: assistantID,
    parentMessageID: parentID,
    prompt,
    hasPrompt: prompt.length > 0 && !!humanID,
  };
}

/// SSE を読みながら「可視 text だけ」を組み立てる状態機械。
/// thinking ブロックは index ごと除外する（保存も連結もしない）
export function createStreamAssembler() {
  const visibleBlocks = new Map();   // index -> 連結した text
  const blockKinds = new Map();      // index -> 'text' | 'thinking' | その他
  const state = {
    assistantMessageID: null,
    parentMessageID: null,
    stopReason: null,
    sawMessageStop: false,
    sawError: false,
  };

  function handleEvent(name, data) {
    const type = name || (data && data.type) || '';
    switch (type) {
      case 'message_start': {
        const message = data.message || {};
        if (typeof message.uuid === 'string') state.assistantMessageID = message.uuid;
        if (typeof message.parent_uuid === 'string') state.parentMessageID = message.parent_uuid;
        break;
      }
      case 'content_block_start': {
        const block = data.content_block || {};
        blockKinds.set(data.index, block.type);
        if (block.type === 'text' && typeof block.text === 'string' && block.text) {
          visibleBlocks.set(data.index, block.text);
        }
        break;
      }
      case 'content_block_delta': {
        const delta = data.delta || {};
        // 二重の門番: delta 自身が text_delta で、かつ block も text であること
        if (delta.type !== 'text_delta' || typeof delta.text !== 'string') break;
        if (blockKinds.has(data.index) && blockKinds.get(data.index) !== 'text') break;
        visibleBlocks.set(data.index, (visibleBlocks.get(data.index) || '') + delta.text);
        break;
      }
      case 'message_delta': {
        const delta = data.delta || {};
        if (typeof delta.stop_reason === 'string') state.stopReason = delta.stop_reason;
        break;
      }
      case 'message_stop':
        state.sawMessageStop = true;
        break;
      case 'error':
        state.sawError = true;
        break;
      default:
        break;
    }
  }

  return {
    /// SSE のテキスト塊を投入する（"\n\n" 区切りで完結したブロックだけ渡すこと）
    push(chunk) {
      for (const block of chunk.split('\n\n')) {
        if (!block.trim()) continue;
        let eventName = null;
        const dataLines = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        try {
          handleEvent(eventName, JSON.parse(dataLines.join('\n')));
        } catch {
          // 壊れた1イベントで全体を捨てない
        }
      }
    },
    /// 確定条件: message_stop を見た、または stop_reason が来ている
    isComplete() {
      return state.sawMessageStop || state.stopReason !== null;
    },
    /// 中断・異常終了だったか（is_partial の判断材料）
    isPartial() {
      if (state.sawError) return true;
      if (!state.sawMessageStop) return true;
      return state.stopReason !== null && state.stopReason !== 'end_turn'
        && state.stopReason !== 'stop_sequence';
    },
    text() {
      return [...visibleBlocks.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, value]) => value)
        .join('\n\n')
        .trim();
    },
    assistantMessageID: () => state.assistantMessageID,
    parentMessageID: () => state.parentMessageID,
    stopReason: () => state.stopReason,
  };
}
