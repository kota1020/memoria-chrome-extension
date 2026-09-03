// ============================================================================
//  handoff.js — 記憶をAIの入力欄へ渡す共有コア（ChatGPT / Claude Web / Gemini）
//
//  何をするか
//    利用者が送信しようとした瞬間（Enter / 送信ボタン）に一度だけ止め、
//    ローカルの memoria read API（127.0.0.1:4319 /handoff）から
//    「その質問に関係する記憶カード」を取り、パネルで見せる。
//    OK された分だけを入力欄の末尾に足してから、元の送信を続ける。
//
//  守ること
//    ・渡すのは翻訳済みの理解（facts / タスク名）だけ。生画面・生OCRは渡さない
//    ・利用者が確認して選んだものだけを足す（「このAIには毎回OK」を選んだ時だけ無確認）
//    ・カードが無ければ何もせず素通し。API が落ちていても送信は止めない
//    ・ページ内部のコードは改変しない。入力欄への挿入は execCommand('insertText') だけ
//    ・自動化対策の回避はしない。送信の再実行は利用者の操作を1回だけ再現する
// ============================================================================

export const MARKER_HEAD = '[memoria]';

/// provider ごとの入力欄と送信ボタン。ここだけが provider 差分
export const COMPOSER_PROFILES = {
  openai: {
    origins: ['https://chatgpt.com', 'https://chat.openai.com'],
    label: 'ChatGPT',
    // 実測（2026-09-03・ヘッドレス/未ログイン）: 入力欄は textarea#mobile-composer-prompt.wm-composer-textarea、
    // 送信は aria-label に「送信」を含む button。ログイン後は #prompt-textarea（ProseMirror）＋ data-testid=send-button
    composer: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea.wm-composer-textarea', '#mobile-composer-prompt', 'textarea[data-id="root"]', 'form textarea'],
    send: ['[data-testid="send-button"]', 'button[aria-label*="送信"]', 'button[aria-label*="Send"]'],
    verified: 'selectors',   // セレクタは実測済み。送信の再実行まで実機で通したら true にする
  },
  anthropic: {
    origins: ['https://claude.ai'],
    label: 'Claude',
    composer: ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"][data-placeholder]'],
    send: ['button[aria-label*="送信"]', 'button[aria-label*="Send"]', 'button[type="submit"]'],
    verified: false,   // claude.ai はヘッドレスだと待機ページで止まる。実機で測るまで未検証
  },
  google: {
    origins: ['https://gemini.google.com'],
    label: 'Gemini',
    // 実測（2026-09-03・ヘッドレス/未ログイン）: 入力欄は div.ql-editor（Quill）。送信ボタンは本文が入るまで現れない
    // （＝挿入後に探せば居る。無ければ Enter を再現）
    composer: ['rich-textarea .ql-editor[contenteditable="true"]', 'div.ql-editor[contenteditable="true"]'],
    send: ['button[aria-label*="プロンプトを送信"]', 'button[aria-label*="送信"]', 'button[aria-label*="Send"]', 'button.send-button'],
    verified: 'selectors',
  },
};

export function composerProfileForOrigin(origin) {
  for (const [id, profile] of Object.entries(COMPOSER_PROFILES)) {
    if (profile.origins.includes(origin)) return { id, ...profile };
  }
  return null;
}

/// 下書きから「何を聞こうとしているか」だけを取り出す（既に足した記憶ブロックは除く）
export function extractQuery(draft) {
  const text = String(draft || '');
  const at = text.indexOf(MARKER_HEAD);
  return (at >= 0 ? text.slice(0, at) : text).trim().slice(0, 500);
}

/// 記憶ブロックが既に入っていれば二重に足さない
export function hasHandoffBlock(draft) {
  return String(draft || '').includes(MARKER_HEAD);
}

/// カード → 入力欄へ足す文面。短く、AIが前提として読める形。
/// 生の evidence / URL は入れない（渡すのは理解だけ）
export function buildHandoffBlock(cards, { label = 'AI' } = {}) {
  const rows = (cards || []).filter(Boolean).map((c) => `- ${String(c.title || '').trim()}${c.text ? `（${String(c.text).trim()}）` : ''}`);
  if (!rows.length) return '';
  return `\n\n${MARKER_HEAD} 関係する記憶（本人の画面から。前提として使ってください）\n${rows.join('\n')}`;
}

/// 送信の一時停止が必要か。空の下書き・記憶入り・自動OFF なら止めない
export function shouldIntercept({ draft, mode }) {
  if (mode === 'off') return false;
  const q = extractQuery(draft);
  if (!q) return false;
  if (hasHandoffBlock(draft)) return false;
  return true;
}

// ---- 以下はブラウザ内でだけ動く部分 ---------------------------------------------

function firstMatch(selectors, root = document) {
  for (const s of selectors) {
    const el = root.querySelector(s);
    if (el) return el;
  }
  return null;
}

function readDraft(el) {
  if (!el) return '';
  if (el.tagName === 'TEXTAREA') return el.value;
  return el.innerText || el.textContent || '';
}

/// 入力欄の末尾へ文を足す。contenteditable は execCommand（ProseMirror / Quill が拾える唯一の共通口）
function appendToComposer(el, block) {
  if (!el) return false;
  el.focus();
  if (el.tagName === 'TEXTAREA') {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter ? setter.call(el, el.value + block) : (el.value += block);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  let ok = false;
  try { ok = document.execCommand('insertText', false, block); } catch { ok = false; }
  if (!ok) {
    el.appendChild(document.createTextNode(block));
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: block }));
  }
  return true;
}

/// 元の送信を1回だけ再現する（ボタンがあれば押す。無ければ Enter を投げる）
function resend(profile, composer) {
  const btn = firstMatch(profile.send);
  if (btn && !btn.disabled) { btn.click(); return 'button'; }
  composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  return 'enter';
}

const PANEL_ID = 'memoria-handoff-panel';
const CSS = `
#${PANEL_ID}{position:fixed;right:20px;bottom:96px;z-index:2147483646;width:360px;max-width:calc(100vw - 40px);
  background:#0f1115;color:#e8e8ea;border:1px solid #2a2d35;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.45);
  font:13px/1.5 -apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif}
#${PANEL_ID} header{display:flex;align-items:center;gap:8px;padding:12px 14px 6px;font-weight:600}
#${PANEL_ID} header .lock{margin-left:auto;font-weight:400;font-size:11px;color:#9aa0ab}
#${PANEL_ID} ul{list-style:none;margin:0;padding:4px 10px;max-height:260px;overflow:auto}
#${PANEL_ID} li{display:flex;gap:8px;align-items:flex-start;padding:6px 4px;border-radius:8px}
#${PANEL_ID} li:hover{background:#171a21}
#${PANEL_ID} li input{margin-top:3px}
#${PANEL_ID} li .t{flex:1}
#${PANEL_ID} li .k{font-size:10px;color:#9aa0ab;margin-right:4px}
#${PANEL_ID} footer{display:flex;gap:8px;align-items:center;padding:8px 12px 12px;border-top:1px solid #1f232b;flex-wrap:wrap}
#${PANEL_ID} button{border:0;border-radius:9px;padding:7px 12px;font:inherit;cursor:pointer}
#${PANEL_ID} .ok{background:#c9f04d;color:#0f1115;font-weight:600}
#${PANEL_ID} .skip{background:#232730;color:#e8e8ea}
#${PANEL_ID} label.auto{margin-left:auto;font-size:11px;color:#9aa0ab;display:flex;gap:4px;align-items:center}
`;

/// パネル。Promise で {cards, auto} | null（渡さない）を返す
function showPanel({ cards, label }) {
  return new Promise((resolve) => {
    document.getElementById(PANEL_ID)?.remove();
    if (!document.getElementById(`${PANEL_ID}-css`)) {
      const style = document.createElement('style');
      style.id = `${PANEL_ID}-css`;
      style.textContent = CSS;
      document.documentElement.appendChild(style);
    }
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('role', 'dialog');
    panel.innerHTML = `
      <header><span>memoria</span><span>この${cards.length}件を${label}に渡します</span><span class="lock">🔒 記憶はこのMacの中</span></header>
      <ul></ul>
      <footer>
        <button class="ok">渡して送信</button>
        <button class="skip">渡さず送信</button>
        <label class="auto"><input type="checkbox" class="auto-box">この${label}には毎回OK</label>
      </footer>`;
    const list = panel.querySelector('ul');
    const KIND = { fact: '記憶', task: '作業', memory: 'メモ' };
    cards.forEach((c, i) => {
      const li = document.createElement('li');
      const box = document.createElement('input');
      box.type = 'checkbox'; box.checked = true; box.dataset.i = String(i);
      const t = document.createElement('span'); t.className = 't';
      const k = document.createElement('span'); k.className = 'k'; k.textContent = KIND[c.kind] || c.kind;
      t.appendChild(k); t.appendChild(document.createTextNode(c.title || ''));
      li.appendChild(box); li.appendChild(t);
      list.appendChild(li);
    });
    const done = (value) => { panel.remove(); resolve(value); };
    panel.querySelector('.ok').addEventListener('click', () => {
      const chosen = [...list.querySelectorAll('input[type=checkbox]')].filter((b) => b.checked).map((b) => cards[Number(b.dataset.i)]);
      done({ cards: chosen, auto: panel.querySelector('.auto-box').checked });
    });
    panel.querySelector('.skip').addEventListener('click', () => done(null));
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
    document.documentElement.appendChild(panel);
    panel.querySelector('.ok').focus();
  });
}

/// content script から呼ぶ入口（ISOLATED world 側）。
///   fetchCards(query) … background 経由で /handoff を引く（Promise<cards[]>）
///   getMode()/setMode(mode) … 'ask' | 'auto' | 'off'（provider ごと。storage は呼び出し側）
///
/// 送信を止めるのは MAIN world の handoff-gate.js。ここは止まった知らせを受けて
/// 「何を渡すか」を決め、入力欄へ足してから、門を開けるよう頼むだけ。
/// ISOLATED から直接止められないことは 2026-09-03 に Gemini 実測で確認済み
export function installHandoff({ profile, fetchCards, getMode, setMode, onStage }) {
  if (!profile || window.__memoriaHandoffInstalled) return () => {};
  window.__memoriaHandoffInstalled = true;
  const CHANNEL = 'memoria-handoff-gate';
  const stage = (name, detail) => { try { onStage?.(name, detail); } catch { /* noop */ } };
  const toGate = (message) => window.postMessage({ __memoria: CHANNEL, toGate: true, ...message }, location.origin);

  let busy = false;

  async function onHeld() {
    if (busy) return;
    busy = true;
    try {
      const composer = firstMatch(profile.composer);
      const draft = readDraft(composer);
      const mode = await getMode();
      if (!composer || !shouldIntercept({ draft, mode })) { toGate({ type: 'release' }); return; }

      let cards = [];
      try { cards = await fetchCards(extractQuery(draft)); }
      catch (error) { stage('handoff_api_unavailable', String(error && error.message)); }

      let chosen = null;
      if (cards.length) {
        if (mode === 'auto') chosen = { cards, auto: true };
        else {
          chosen = await showPanel({ cards, label: profile.label });
          if (chosen?.auto) await setMode('auto');
        }
      }
      if (chosen?.cards?.length) {
        appendToComposer(composer, buildHandoffBlock(chosen.cards, { label: profile.label }));
        stage('handoff_inserted', String(chosen.cards.length));
      } else {
        stage(cards.length ? 'handoff_skipped' : 'handoff_no_cards');
      }
      toGate({ type: 'release' });
    } finally { busy = false; }
  }

  const onMessage = (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__memoria !== CHANNEL || data.toGate) return;
    if (data.type === 'held') { onHeld(); return; }
    if (data.type === 'ready') { stage('handoff_gate_ready', profile.id); return; }
    if (data.type === 'released') { stage('handoff_resent', data.how); return; }
  };

  window.addEventListener('message', onMessage);
  toGate({ type: 'config', composer: profile.composer, send: profile.send });
  stage('handoff_installed', profile.id);

  return () => {
    window.removeEventListener('message', onMessage);
    window.__memoriaHandoffInstalled = false;
  };
}
