// ============================================================================
//  dom-capture.js — 表示された会話から prompt / 確定 response を読む共有コア
//
//  通信を読めない provider のための第二の経路。
//  自動化対策の回避も、内部コードの改変も一切しない。
//  「ユーザー本人が普通に使ったときに画面へ出たもの」だけを読む。
//
//  守ること
//    ・opt-in 後に**新しく追加・更新された** message だけを取る
//      （ページを開いた時点で既に表示されている過去履歴は取り込まない）
//    ・streaming 中は確定させない。停止ボタンの消失・生成状態の終了・
//      本文が一定時間変化しないこと、の**複数証拠**が揃って初めて確定する
//    ・公式 ID が取れないときは捏造せず、決定的な local key を作り
//      id_source = 'derived_dom' として確信度を下げる
// ============================================================================

/// provider ごとの「どこを見るか」。ここだけが provider 差分
export const DOM_PROFILES = {
  openai: {
    origins: ['https://chatgpt.com', 'https://chat.openai.com'],
    // 実測（2026-08-06）: 各メッセージは data-message-id / data-message-author-role を持つ
    messageSelector: '[data-message-id]',
    idAttribute: 'data-message-id',
    roleAttribute: 'data-message-author-role',
    // 会話 ID は URL の /c/<id>
    conversationFromLocation: (url) => {
      const match = /\/c\/([0-9a-f-]{8,})/i.exec(url);
      return match ? match[1] : null;
    },
    // 生成中を示す証拠（どれか1つでも残っていれば「まだ終わっていない」）
    generatingSelectors: ['[data-testid="stop-button"]', 'button[aria-label*="停止"]',
                          'button[aria-label*="Stop"]', '[data-testid="composer-speech-button"][disabled]'],
    generatingSignalVerified: true,
  },
  moonshot: {
    origins: ['https://kimi.com', 'https://www.kimi.com', 'https://kimi.moonshot.cn'],
    // 実測（2026-08-07）: 発言は .chat-content-item。役割は class で分かれる。
    // message ID にあたる属性は表示に出ていないので derived_dom になる
    messageSelector: '.chat-content-item',
    idAttribute: 'data-message-id',          // 実際には無い（derived へ落ちる）
    roleAttribute: 'data-role',
    roleOf: (element) => {
      const names = typeof element.className === 'string' ? element.className : '';
      if (/chat-content-item-user/.test(names)) return 'user';
      if (/chat-content-item-assistant/.test(names)) return 'assistant';
      return null;
    },
    // 会話 ID は URL の /chat/<id>
    conversationFromLocation: (url) => {
      const match = /\/chat\/([A-Za-z0-9_-]{6,})/.exec(url);
      return match ? match[1] : null;
    },
    // 実測（2026-08-07）: 生成中は送信ボタンが停止ボタンに変わり、
    // .send-button-container に stop が付く。生成中の6枚すべてに出ていた
    generatingSelectors: ['.send-button-container.stop',
                          '[class*="send-button-container"][class*="stop"]'],
    generatingSignalVerified: true,
  },
};

export function domProfileForOrigin(origin) {
  for (const profile of Object.values(DOM_PROFILES)) {
    if (profile.origins.includes(origin)) return profile;
  }
  return null;
}

/// 本文から決定的な鍵を作る（公式 ID が無いときだけ使う）。
/// provider + 会話 + role + 表示順 + 本文ハッシュ。乱数も時刻も混ぜない
export async function derivedMessageID({ provider, conversationID, role, turnIndex, text }) {
  const source = [provider, conversationID || 'no-conv', role, String(turnIndex), text].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `dom-${hex.slice(0, 24)}`;
}

/// 表示を監視して、確定した message だけを渡す。
///   emit(record) … { conversation_id, message_id, parent_message_id, role, text,
///                    id_source, completion_evidence, occurred_at }
export function installDOMCapture({ profile, providerID, emit, onActivity, onBaseline,
                                    settleMs = 1500, pollMs = 500,
                                    conversationWaitMs = 15000, stuckMs = 30000 }) {
  if (!profile) return () => {};

  /// opt-in 後に「新しく現れた」ものだけを対象にするための基準。
  /// 既に表示されている message は履歴なので取り込まない
  ///
  /// 何を「同じ発言」とみなすか（2026-08-07 の実測で分かったこと）
  ///   本文から鍵を作っていたが、streaming 中は本文が伸びるたびに鍵が変わる。
  ///   結果、生成中の発言は毎回「初めて見たもの」になり、
  ///   同一性が保てず、生成中であることにも気づけなかった。
  ///   要素そのものは伸びている間もずっと同じなので、それを identity にする。
  ///   本文の鍵は「別の要素として作り直されたとき」の保険として併用する
  const preexistingElements = new WeakSet();
  const preexistingKeys = new Set();
  const emittedElements = new WeakSet();
  const emittedKeys = new Set();
  const pending = new Map();   // element -> { text, lastChangedAt, ... }

  function markPreexisting(element, index) {
    preexistingElements.add(element);
    preexistingKeys.add(keyOf(element, index));
  }
  function isKnown(element, index) {
    return preexistingElements.has(element) || emittedElements.has(element)
      || preexistingKeys.has(keyOf(element, index)) || emittedKeys.has(keyOf(element, index));
  }

  /// 履歴の基準をいつ決めるか（2026-08-07 の実測で分かったこと）
  ///
  /// content script は document_start で走る。その時点の DOM は空なので、
  /// そこで「既にあったもの」を数えても何も入らない。
  /// 結果、あとから描画された過去の会話がぜんぶ「新しく現れた」ことになり、
  /// 既存の会話を開いただけで3往復ぶんが取り込まれた。
  ///
  /// なので基準は「描画が落ち着いたとき」に決める。
  ///   ・開いた時点で URL に会話 ID がある = 既存の会話を見ている → 描画された分は履歴
  ///   ・会話 ID が無い = 新規の会話 → 履歴は無い（最初の発言から取る）
  ///   ・会話を切り替えたら決め直す（別の会話の履歴が描画されるため）
  const baselineStableMs = 800;
  const baselineMaxMs = 8000;
  let baseline = null;

  function startBaseline(now) {
    baseline = { startedAt: now, lastCount: -1, stableSince: now };
  }
  function baselineDone() { return baseline === null; }

  /// 履歴と新しい発言の境目を決めて閉じる。
  /// 数だけ知らせる（本文は出さない）ので、あとから「何件を履歴として除いたか」が分かる
  function closeBaseline(reason, elements) {
    if (baseline === null) return;
    elements.forEach(markPreexisting);
    baseline = null;
    if (onBaseline) {
      try { onBaseline({ reason, history_count: elements.length }); }
      catch { /* 観測でページを壊さない */ }
    }
  }

  /// 利用者が送信した瞬間は、履歴と新しい発言の境目そのもの。
  /// 推測で待つより確か。ここで基準を閉じる
  function onUserSend() {
    if (baseline === null) return;
    let elements = [];
    try { elements = [...document.querySelectorAll(profile.messageSelector)]; } catch { /* noop */ }
    closeBaseline('user_send', elements);
  }

  /// 描画が落ち着いたか。落ち着いたらそこまでを履歴として確定する
  function advanceBaseline(elements, now) {
    if (elements.length !== baseline.lastCount) {
      baseline.lastCount = elements.length;
      baseline.stableSince = now;
    }
    elements.forEach(markPreexisting);
    if (elements.length > 0 && now - baseline.stableSince >= baselineStableMs) {
      closeBaseline('render_settled', elements);
    } else if (now - baseline.startedAt >= baselineMaxMs) {
      closeBaseline('timeout', elements);
    }
  }

  function conversationID() {
    try { return profile.conversationFromLocation(location.href); } catch { return null; }
  }

  function isGenerating() {
    return profile.generatingSelectors.some((selector) => {
      try { return !!document.querySelector(selector); } catch { return false; }
    });
  }

  function roleOf(element) {
    if (profile.roleOf) return profile.roleOf(element);
    const raw = element.getAttribute(profile.roleAttribute) || '';
    if (raw === 'user' || raw === 'human') return 'user';
    if (raw === 'assistant' || raw === 'bot') return 'assistant';
    return null;
  }

  function textOf(element) {
    return (element.innerText || '').trim();
  }

  function keyOf(element, index) {
    const official = element.getAttribute(profile.idAttribute);
    if (official) return `official:${official}`;
    // 公式 ID が無い場合、位置は当てにならない（一覧が間引かれると全部ずれる）。
    // 役割と本文で覚えておけば、位置がずれても同じ発言だと分かる
    const text = (element.innerText || '').trim();
    return `content:${roleOf(element) || '?'}:${text.length}:${text.slice(0, 80)}`;
  }

  // 既存の会話を開いているなら、描画が落ち着くまでを履歴として扱う。
  // 新規の会話（URL に会話 ID が無い）は履歴が無いので、最初の発言から取る
  let lastConversation = conversationID();
  if (lastConversation) startBaseline(Date.now());

  async function finalize(entry, index) {
    // 「出した」印は await より前に、同期のうちに付ける。
    // 鍵づくりは非同期なので、その待ち時間に次の走査が入ると
    // 同じ発言を何度も出してしまう（公式 ID の無い provider で顕在化）
    const element = entry.element;
    if (emittedElements.has(element)) return;
    emittedElements.add(element);
    emittedKeys.add(keyOf(element, index));
    const role = roleOf(element);
    const text = entry.text;
    if (!role || !text) { emittedElements.delete(element); return; }

    const conversation = conversationID();
    const official = entry.element.getAttribute(profile.idAttribute);
    let messageID = official;
    let idSource = 'official';
    if (!messageID) {
      // 公式 ID が無い。捏造せず、決定的な local key を作る
      messageID = await derivedMessageID({ provider: providerID,
                                           conversationID: conversation, role,
                                           turnIndex: index, text });
      idSource = 'derived_dom';
    }

    // 親は「画面に表示されている直前の message」。関係だけを表示順から取る。
    // 公式 ID があればそれを、無ければ同じ規則で導いた鍵を使う（捏造はしない）
    const evidence = [...entry.evidence];
    let parentID = null;
    if (entry.parentOfficialID) {
      parentID = entry.parentOfficialID;
    } else if (entry.parentElement) {
      const parentRole = roleOf(entry.parentElement);
      const parentText = textOf(entry.parentElement);
      if (parentRole && parentText) {
        parentID = await derivedMessageID({ provider: providerID,
                                            conversationID: conversation, role: parentRole,
                                            turnIndex: entry.parentIndex, text: parentText });
      }
    }
    if (parentID) evidence.push('parent_from_dom_order');

    if (onActivity && role === 'assistant') {
      // 生成中の画面と、確定後の画面。その差が「生成中だけ出ている部品」
      try { onActivity('completed'); } catch { /* 観測でページを壊さない */ }
    }
    emit({
      kind: 'exchange',
      conversation_id: conversation
        || (await derivedMessageID({ provider: providerID, conversationID: null,
                                     role: 'conversation', turnIndex: 0,
                                     text: location.pathname })),
      message_id: messageID,
      parent_message_id: parentID,
      role,
      text,
      is_partial: false,
      capture_method: 'direct_dom',
      id_source: idSource,
      completion_evidence: evidence,
      occurred_at: new Date().toISOString(),
    });
  }

  function scan() {
    let elements;
    try { elements = [...document.querySelectorAll(profile.messageSelector)]; }
    catch { return; }

    const now0 = Date.now();
    // 会話を切り替えたら、その会話の履歴が描画されるので基準を決め直す。
    // 会話 ID が付いただけ（新規の会話で送信した直後）は切り替えではない
    const conversation = conversationID();
    if (conversation && lastConversation && conversation !== lastConversation) {
      pending.clear();
      startBaseline(now0);
    }
    if (conversation) lastConversation = conversation;

    if (!baselineDone()) {
      advanceBaseline(elements, now0);
      return;
    }

    const generating = isGenerating();

    // 新しい発言は必ず一覧の末尾に増える。
    // 既知のものより前に現れた見慣れない要素は、あとから読み込まれた履歴。
    // Kimi はここで古い履歴を遅れて描画してきた（2026-08-07 実測）
    let lastKnownIndex = -1;
    elements.forEach((element, index) => {
      if (isKnown(element, index) || pending.has(element)) lastKnownIndex = index;
    });
    elements.forEach((element, index) => {
      if (index < lastKnownIndex && !isKnown(element, index) && !pending.has(element)) {
        markPreexisting(element, index);
      }
    });

    // 表示順の直前にある message（role を持つもの）を親の候補として持ち回る
    let previousMessage = null;
    elements.forEach((element, index) => {
      const officialID = element.getAttribute(profile.idAttribute);
      const parentCandidate = previousMessage;
      if (roleOf(element)) previousMessage = { officialID, element, index };

      if (isKnown(element, index)) return;
      const text = textOf(element);
      if (!text) return;

      const previous = pending.get(element);
      const now = Date.now();
      if (!previous || previous.text !== text) {
        pending.set(element, { text, lastChangedAt: now, element, evidence: [],
                           parentOfficialID: parentCandidate && parentCandidate.officialID,
                           parentElement: parentCandidate && parentCandidate.element,
                           parentIndex: parentCandidate && parentCandidate.index });
        // 本文が伸びている＝いま生成中。その瞬間の画面でしか分からないことがある
        if (previous && onActivity && roleOf(element) === 'assistant') {
          try { onActivity('growing'); } catch { /* 観測でページを壊さない */ }
        }
        return;
      }
      if (!previous.parentElement && parentCandidate) {
        previous.parentOfficialID = parentCandidate.officialID;
        previous.parentElement = parentCandidate.element;
        previous.parentIndex = parentCandidate.index;
      }
      // 確定は複数証拠で判断する
      const evidence = [];
      const signalVerified = profile.generatingSignalVerified !== false;
      // 生成中の目印が確かめられていない provider では、
      // 「生成中でない」を証拠に使わない（目印が無いから false なだけかもしれない）
      if (signalVerified && !generating) evidence.push('not_generating');
      if (now - previous.lastChangedAt >= settleMs) evidence.push('dom_settled');
      if (!signalVerified && now - previous.lastChangedAt >= settleMs * 4) {
        evidence.push('dom_settled_long');
      }
      // user の発話は生成を伴わないので、落ち着いた時点で確定してよい
      if (roleOf(element) === 'user' && evidence.includes('dom_settled')) {
        evidence.push('user_message');
      }
      const enough = roleOf(element) === 'user'
        ? evidence.includes('dom_settled')
        : (signalVerified
            ? (evidence.includes('not_generating') && evidence.includes('dom_settled'))
            : evidence.includes('dom_settled_long'));
      if (!enough) {
        // 本文はとっくに止まっているのに「生成中」のままなら、目印の方が疑わしい。
        // ここで勝手に「終わった」ことにはしない。代わりに黙って止まらず知らせる。
        // 完了を捏造するより、取り込めていないと分かるほうがいい
        if (signalVerified && generating && !previous.stuckReported
            && now - previous.lastChangedAt >= stuckMs) {
          previous.stuckReported = true;
          if (onActivity) {
            try { onActivity('generating_signal_stuck'); } catch { /* noop */ }
          }
        }
        return;
      }

      // 会話 ID は送信直後に URL へ現れる。まだ無いうちに確定させると、
      // 同じ会話の prompt と response が別の会話 ID になってしまう（実測 2026-08-06）。
      // 一定時間は公式の会話 ID が付くのを待つ
      if (!conversationID() && now - previous.lastChangedAt < conversationWaitMs) {
        previous.evidence = evidence;
        return;
      }
      previous.evidence = evidence;
      finalize(previous, index).catch(() => {});
    });
  }

  /// 送信の合図（Enter と、送信ボタンらしき押下）。
  /// 押した本人の操作なので、ここが履歴と新しい発言の境目になる
  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) onUserSend();
  };
  const onPointerDown = (event) => {
    const target = event.target;
    if (!target || !target.closest) return;
    if (target.closest('button, [role="button"]')) onUserSend();
  };
  try {
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown, true);
  } catch { /* 使えない環境では描画の落ち着きだけで判断する */ }

  const timer = setInterval(scan, pollMs);
  let observer = null;
  try {
    observer = new MutationObserver(() => scan());
    observer.observe(document.documentElement, { childList: true, subtree: true,
                                                 characterData: true });
  } catch { /* MutationObserver が使えなくてもポーリングで足りる */ }

  return () => {
    clearInterval(timer);
    if (observer) observer.disconnect();
    try {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    } catch { /* noop */ }
  };
}
