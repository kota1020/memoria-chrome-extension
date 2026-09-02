// ============================================================================
//  content-capture.js — content script（ISOLATED world）側の取り込み（共有）
//
//  なぜ page world ではなくここでやるのか（2026-08-07 の実測）
//    ChatGPT では page world への module 注入が届かず、
//    表示から読む経路がまるごと動かなかった。
//    一方 Kimi では同じコードが最後まで通っている。
//    ページ側の事情に左右されるのは、注入という手段そのもの。
//
//    表示を読むだけなら page world は要らない。content script から
//    同じ document が見える。通信を観測する必要があるのは Claude だけなので、
//    「表示から読む」経路はここへ移し、注入の成否から切り離す。
//
//  ここでも守ることは変わらない
//    ・opt-in 後に新しく現れた message だけ
//    ・確定は複数の証拠が揃ってから
//    ・公式 ID を捏造しない
// ============================================================================

import { domProfileForOrigin, installDOMCapture } from './dom-capture.js';
import { installStructureReporter } from './dom-structure.js';
import { providerIDForOrigin } from './providers.js';

/// 表示から読む経路を content script 側で有効にする。
/// 対象外の origin では何もしない（対応表に無い場所では動かない）
export function installContentCapture({ emit, origin = location.origin } = {}) {
  const profile = domProfileForOrigin(origin);
  if (!profile) return () => {};

  const providerID = providerIDForOrigin(origin);
  const send = (payload) => emit({ origin, provider: providerID, ...payload });

  // プロファイルが空振りしたときだけ、構造の「形」を報告する（本文は出さない）
  const reporter = installStructureReporter({
    profile, providerID, emit: (record) => send(record),
  });

  const stopCapture = installDOMCapture({
    profile, providerID, emit: (record) => send(record),
    // 生成中の目印が未確認の provider は、伸びている最中の画面を一度だけ見る。
    // 停止ボタンの名前が分かれば「終わった」と言い切れるようになる
    // 生成中の目印が未確認の provider は、伸びている最中と確定直後の画面を採る。
    // その差が「生成中だけ出ている部品」＝停止ボタンになる
    onActivity: (phase) => {
      // 生成中の目印が当てにならないときは、必ず表に出す（黙って取りこぼさない）
      if (phase === 'generating_signal_stuck') {
        send({ kind: 'stage', stage: 'generating_signal_stuck', detail: providerID,
               observed_at: new Date().toISOString() });
        reporter.report('while_generating');
        return;
      }
      if (profile.generatingSignalVerified === false) {
        reporter.report(phase === 'completed' ? 'after_completion' : 'while_generating');
      }
    },
    // 何件を履歴として除いたかを残す（件数だけ。本文は出さない）
    onBaseline: (info) => send({ kind: 'stage', stage: 'history_baseline_closed',
                                 detail: info.reason, history_count: info.history_count,
                                 observed_at: new Date().toISOString() }),
  });

  send({ kind: 'stage', stage: 'dom_capture_ready', detail: providerID,
         world: 'isolated', observed_at: new Date().toISOString() });

  return () => { stopCapture(); reporter.stop(); };
}

// ============================================================================
//  外部で確定した結果（M6A）
//
//  AI のやり取りとは別の経路。対象も、出す項目も、確定の条件も違う。
//  こちらは「中身を見ない」ことが前提なので、同じ関数には混ぜない
// ============================================================================

import { outcomeProfileForOrigin, installFormOutcome, installEmailOutcome }
  from './outcome-capture.js';

/// フォーム送信とメール送信の観測を始める。
/// どちらも押しただけでは確定にせず、成功の証拠が揃ったときだけ確定として出す
export function installOutcomeCapture({ emit, origin = location.origin } = {}) {
  const stops = [];
  const send = (payload) => emit({ origin, ...payload });

  // フォームはどのサイトでも同じ形で見られる（許可されたサイトでしか動かない）
  stops.push(installFormOutcome({ emit: send }));

  // メールは provider ごとに確認表示の出方が違う
  const profile = outcomeProfileForOrigin(origin);
  if (profile) {
    const mail = installEmailOutcome({ profile, emit: send });
    if (typeof mail === 'function') stops.push(mail);
    else stops.push(() => mail.stop());
  }

  return () => stops.forEach((stop) => { try { stop(); } catch { /* noop */ } });
}
