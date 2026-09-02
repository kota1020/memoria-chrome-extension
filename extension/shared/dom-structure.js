// ============================================================================
//  dom-structure.js — 表示構造の「形」だけを報告する（本文は出さない）
//
//  なぜ必要か
//    未対応の provider に DOM プロファイルを書くには、
//    「どの属性が message を表すか」を知る必要がある。
//    それを知るためだけに、利用者へ何度も同じ操作を頼むのは筋が悪い。
//
//  そこで、プロファイルが空振りしたときに一度だけ、
//  属性名・class の語・要素数・本文の長さだけを送る。
//  本文・タイトル・URL の可変部分は一切出さない（anonymize.js と同じ原則）
// ============================================================================

const INTERESTING = /message|msg|role|turn|chat|conversation|bubble|prompt|answer|response/i;

/// 値の形だけ（短い列挙値は残す。長い文字列は長さだけ）
function shapeOfValue(value) {
  const text = String(value);
  if (text.length <= 24 && /^[a-z0-9_\-.:]+$/i.test(text)) return text;
  return `str(${text.length})`;
}

/// この要素が「会話の1発言」らしいか。長めの本文を持つ末端寄りの要素を数える
function looksLikeMessage(element) {
  const text = (element.innerText || '').trim();
  if (text.length < 2) return false;
  const children = element.querySelectorAll('*').length;
  return children < 400;
}

/// 操作部品の見分けに使う属性（停止ボタンを見つけるため）
const CONTROL_ATTRIBUTES = ['aria-label', 'data-testid', 'title', 'type', 'disabled',
                            'aria-disabled', 'name'];
/// 送信・停止まわりらしい class の語。
/// 実測（2026-08-07）で、Kimi の送信部品は button でも role=button でもなかった
const CONTROL_CLASS = /send|stop|submit|abort|pause|action|composer|editor|input/i;

export function collectDOMStructure({ limit = 40 } = {}) {
  const attributes = new Map();   // 属性名 -> { count, values:Set }
  const classTokens = new Map();  // class の語 -> count
  const shapes = new Map();       // tag+属性名の組 -> { count, textLengths:[] }
  const controls = new Map();     // 部品の指紋 -> count

  let scanned = 0;
  let elements = [];
  try { elements = [...document.querySelectorAll('*')]; } catch { return null; }

  for (const element of elements) {
    scanned += 1;
    if (scanned > 20000) break;   // 極端に大きいページでは打ち切る

    let names = [];
    try { names = [...element.attributes].map((a) => a.name); } catch { continue; }

    for (const name of names) {
      if (!INTERESTING.test(name)) continue;
      if (!attributes.has(name)) attributes.set(name, { count: 0, values: new Set() });
      const entry = attributes.get(name);
      entry.count += 1;
      if (entry.values.size < 6) entry.values.add(shapeOfValue(element.getAttribute(name)));
    }

    // ボタン類は「いま生成中か」を知る手がかりになるので、名前だけ拾う
    const tag = element.tagName ? element.tagName.toLowerCase() : '';
    const tagClasses = typeof element.className === 'string' ? element.className : '';
    if (tag === 'button' || element.getAttribute('role') === 'button'
        || CONTROL_CLASS.test(tagClasses) || element.getAttribute('aria-label') !== null) {
      const marks = CONTROL_ATTRIBUTES
        .map((name) => {
          const value = element.getAttribute(name);
          return value === null ? null : `${name}=${shapeOfValue(value)}`;
        })
        .filter(Boolean);
      const classes = (typeof element.className === 'string' ? element.className : '')
        .split(/\s+/).filter(Boolean).slice(0, 4).join('.');
      const fingerprint = `${tag}{${marks.join(' ')}}${classes ? '.' + classes : ''}`;
      controls.set(fingerprint, (controls.get(fingerprint) || 0) + 1);
    }

    const className = typeof element.className === 'string' ? element.className : '';
    for (const token of className.split(/\s+/)) {
      if (!token || !INTERESTING.test(token)) continue;
      classTokens.set(token, (classTokens.get(token) || 0) + 1);
    }

    // 発言らしい要素の「形」を数える。本文は長さだけ
    const marker = names.filter((name) => INTERESTING.test(name)).sort().join(',');
    if ((marker || INTERESTING.test(className)) && looksLikeMessage(element)) {
      const key = `${element.tagName.toLowerCase()}[${marker || 'class'}]`;
      if (!shapes.has(key)) shapes.set(key, { count: 0, textLengths: [] });
      const shape = shapes.get(key);
      shape.count += 1;
      if (shape.textLengths.length < 8) {
        shape.textLengths.push((element.innerText || '').trim().length);
      }
    }
  }

  const top = (map, take) => [...map.entries()]
    .sort((a, b) => (b[1].count ?? b[1]) - (a[1].count ?? a[1]))
    .slice(0, take);

  return {
    path_shape: location.pathname.split('/')
      .map((part) => (part.length >= 12 ? '<id>' : part)).join('/'),
    element_count: elements.length,
    attributes: Object.fromEntries(top(attributes, limit)
      .map(([name, entry]) => [name, { count: entry.count, values: [...entry.values] }])),
    class_tokens: Object.fromEntries(top(classTokens, limit)),
    message_shapes: Object.fromEntries(top(shapes, limit)
      .map(([key, entry]) => [key, { count: entry.count, text_lengths: entry.textLengths }])),
    controls: Object.fromEntries(top(controls, limit)),
  };
}

/// プロファイルが空振りしているときだけ、構造を最大 maxReports 回だけ報告する。
/// 一度でも message を取れている provider では何も送らない
export function installStructureReporter({ profile, emit, providerID,
                                           delayMs = 8000, maxReports = 6 }) {
  let reports = 0;
  let stopped = false;     // stop() が呼ばれた（もう何もしない）
  let autoStopped = false; // プロファイルが当たったので自発的には送らない

  function profileFindsMessages() {
    if (!profile) return false;
    try { return document.querySelectorAll(profile.messageSelector).length > 0; }
    catch { return false; }
  }

  function report(reason) {
    if (stopped || reports >= maxReports) return;
    // 発言は取れているのに生成中の目印だけ分からない、ということがある。
    // 明示的に頼まれたときは、プロファイルが当たっていても採る
    const requested = reason === 'while_generating' || reason === 'after_completion';
    if (!requested && (autoStopped || profileFindsMessages())) { autoStopped = true; return; }
    const structure = collectDOMStructure();
    if (!structure || !Object.keys(structure.message_shapes).length) return;
    reports += 1;
    emit({ kind: 'probe_dom_structure', provider: providerID, reason,
           structure, observed_at: new Date().toISOString() });
  }

  const first = setTimeout(() => report('profile_found_nothing'), delayMs);
  const second = setTimeout(() => report('after_interaction'), delayMs * 4);

  return {
    /// 生成中など「その瞬間でないと分からない」形を頼むための口
    report,
    stop() {
      stopped = true;
      clearTimeout(first);
      clearTimeout(second);
    },
  };
}
