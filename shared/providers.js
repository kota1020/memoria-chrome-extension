// ============================================================================
//  providers.js — provider ごとの解析だけを差し替える層（M5D / M5E）
//
//  下流（AIExchange → Raw Event → Artifact …）は provider が増えても変えない。
//  違いはこのファイルの Parser の中だけに閉じる。
//
//  Parser が満たすべき契約
//    origins()      … その provider の対象オリジン（ここ以外では動かない）
//    matches(url)   … 会話 API かどうか（狭く保つ。閲覧履歴を集めないための芯）
//    parseRequest(bodyText, url) → { conversationID, humanMessageID,
//                                    assistantMessageID, parentMessageID,
//                                    prompt, hasPrompt } | null
//    createAssembler() … SSE から「可視 text だけ」を組み立てる状態機械
//
//  実通信構造が確認できていない provider は status: 'probe_required' のままにし、
//  本文を推測で取り出さない（degraded として扱い、既存の観測へ委ねる）
// ============================================================================

import { classifyRequest, parseRequest, createStreamAssembler } from './capture-core.js';

/// Claude（claude.ai）— 実機 Probe 済み（extension/PROBE-M5B-0.md）
export const claudeProvider = {
  id: 'anthropic',
  status: 'verified',
  origins: () => ['https://claude.ai'],
  matches(url, base) {
    return classifyRequest(url, base);
  },
  parseRequest(bodyText) {
    return parseRequest(bodyText);
  },
  createAssembler() {
    return createStreamAssembler();
  },
};

/// ChatGPT（chatgpt.com / chat.openai.com）— 実通信構造は**未確認**。
/// Probe が通るまで本文を取り出さない（推測で位置を固定しない）
export const chatgptProvider = {
  id: 'openai',
  status: 'probe_required',
  origins: () => ['https://chatgpt.com', 'https://chat.openai.com'],
  matches(url, base) {
    try {
      const parsed = new URL(url, base);
      if (!this.origins().includes(parsed.origin)) return null;
      // 会話の送信・再生成に相当する経路だけを見る（一覧・設定は見ない）
      if (/\/backend-api\/(f\/)?conversation(\/|$)/.test(parsed.pathname)) {
        return { conversationID: null, kind: 'completion' };
      }
      return null;
    } catch {
      return null;
    }
  },
  parseRequest() {
    // Probe で構造を確かめるまで、本文も ID も取り出さない
    return null;
  },
  createAssembler() {
    return null;
  },
};

/// Kimi（kimi.com / kimi.moonshot.cn）— 実通信構造は**未確認**
export const kimiProvider = {
  id: 'moonshot',
  status: 'probe_required',
  origins: () => ['https://kimi.com', 'https://www.kimi.com', 'https://kimi.moonshot.cn'],
  matches(url, base) {
    try {
      const parsed = new URL(url, base);
      if (!this.origins().includes(parsed.origin)) return null;
      if (/\/api\/chat\//.test(parsed.pathname)) {
        return { conversationID: null, kind: 'completion' };
      }
      return null;
    } catch {
      return null;
    }
  },
  parseRequest() {
    return null;
  },
  createAssembler() {
    return null;
  },
};

export const providers = [claudeProvider, chatgptProvider, kimiProvider];

/// その URL を扱える provider を返す（対象オリジン以外では必ず null）
export function providerFor(url, base) {
  for (const provider of providers) {
    const hit = provider.matches(url, base);
    if (hit) return { provider, hit };
  }
  return null;
}

export function providerByOrigin(origin) {
  return providers.find((p) => p.origins().includes(origin)) || null;
}

/// origin → provider ID。対応表はここ1箇所だけ（page world も content script も同じ答えを使う）
export function providerIDForOrigin(origin) {
  return providerByOrigin(origin)?.id || 'unknown';
}
