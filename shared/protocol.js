// ============================================================================
//  protocol.js — 拡張 → memoria-browser-host のレコード形式（共有）
//
//  Chromium / Firefox / Safari のどの transport でも、host が受け取る JSON は
//  この1形式だけ。ブラウザ差分は transport（Native Messaging / App Group）に閉じる
// ============================================================================

export const PROTOCOL_VERSION = 'browser_capture_v1';
export const BUILDER = 'protocol_v2';

/// page world から来た payload を、host が受け取る最終形へ包む唯一の関数。
/// Chromium / Firefox / Safari の background は転送するだけで、
/// record_type の判断をそれぞれで持たない（差分を transport だけに閉じるため）
export function buildRecord({ browser, extensionID, extensionVersion, payload }) {
  if (payload && payload.kind === 'exchange') {
    return exchangeRecord({
      browser, extensionID, extensionVersion,
      conversationID: payload.conversation_id,
      messageID: payload.message_id,
      parentMessageID: payload.parent_message_id,
      role: payload.role,
      text: payload.text,
      isPartial: payload.is_partial,
      occurredAt: payload.occurred_at,
    });
  }
  return probeRecord({ browser, extensionID, extensionVersion, payload });
}

/// M5B-0（Probe）で送るレコード。本文は含まない
export function probeRecord({ browser, extensionID, extensionVersion, payload }) {
  return {
    protocol_version: PROTOCOL_VERSION,
    record_type: 'probe',
    provider: 'anthropic',
    origin: 'https://claude.ai',
    browser,                       // { browser_id, browser_family, user_agent_brand, version }
    extension_id: extensionID,
    extension_version: extensionVersion,
    payload,                       // 匿名化済みの構造だけ
    sent_at: new Date().toISOString(),
  };
}

/// M5B-1 以降で送る本番レコードの形（M5B-0 では未使用。host 側の schema 検証と対にする）
export function exchangeRecord({
  browser, extensionID, extensionVersion,
  conversationID, messageID, parentMessageID, role,
  text, isPartial, occurredAt, captureMethod = 'direct_web',
}) {
  return {
    protocol_version: PROTOCOL_VERSION,
    record_type: 'exchange',
    provider: 'anthropic',
    origin: 'https://claude.ai',
    browser,
    extension_id: extensionID,
    extension_version: extensionVersion,
    conversation_id: conversationID,
    message_id: messageID,
    parent_message_id: parentMessageID,
    role,                          // "user" | "assistant"
    text,
    is_partial: !!isPartial,
    capture_method: captureMethod,
    occurred_at: occurredAt,
    sent_at: new Date().toISOString(),
  };
}
