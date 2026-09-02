// ============================================================================
//  anonymize.js — Probe 用の匿名化（Cross-Browser Claude Web Capture / M5B-0）
//
//  M5B-0 の Probe は「通信の構造」だけを知るためのもの。
//  本文・タイトル・URL の可変部分は page world を出る前にここで落とす。
//
//  ID の同一性（response の message uuid が SSE の開始と終了で同じか、
//  parent がどれを指すか）は確認する必要があるので、
//  生 ID の代わりに「セッションごとのランダム salt 付きハッシュの先頭8桁」を使う。
//  salt はメモリ上だけで、保存もしないし送りもしない。
//  こうすると値そのものは復元できないが、等しいかどうかは判定できる
// ============================================================================

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// salt は「拡張のインストール単位」で固定する（chrome.storage.local に置き、外へは出ない）。
// ページを再読み込みしても同じ UUID が同じタグになるので、
// 「再読み込み後も同じ message か」を生 ID を残さずに検証できる。
// 渡されなかった場合はページ単位のランダム salt（同一性の検証はできないが安全側）
let salt = crypto.getRandomValues(new Uint8Array(16)).join('-');
const cache = new Map();

export function setProbeSalt(value) {
  if (typeof value === 'string' && value.length >= 8) {
    salt = value;
    cache.clear();
  }
}

/// 値を復元できない安定タグ。同じ入力なら同じタグ（同一性の確認だけができる）
export async function idTag(value) {
  if (cache.has(value)) return cache.get(value);
  const data = new TextEncoder().encode(salt + '|' + value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const tag = 'id:' + hex.slice(0, 8);
  cache.set(value, tag);
  return tag;
}

/// 値の「形」だけを返す。文字列は長さだけ（本文は絶対に残さない）
export async function shapeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  switch (typeof value) {
    case 'boolean': return 'bool';
    case 'number': return Number.isInteger(value) ? 'int' : 'float';
    case 'object': return `object(${Object.keys(value).length})`;
    case 'string':
      if (UUID_RE.test(value)) return await idTag(value);
      // 列挙値らしき短い ASCII だけは値を残す（human / assistant / completed など）
      if (value.length <= 24 && /^[a-z0-9_\-.]+$/i.test(value)) return `enum:${value}`;
      return `str(${value.length})`;
    default: return typeof value;
  }
}

/// JSON をキーパスと値の形だけに畳む。深さと配列要素数は制限する
export async function keyShape(value, prefix = '', depth = 0, out = {}) {
  if (depth > 4 || value === null || typeof value !== 'object') {
    out[prefix || '.'] = await shapeOf(value);
    return out;
  }
  if (Array.isArray(value)) {
    out[prefix || '.'] = `array(${value.length})`;
    // 先頭2要素だけ構造を見る（本文は shapeOf で落ちる）
    for (let i = 0; i < Math.min(value.length, 2); i++) {
      await keyShape(value[i], `${prefix}[${i}]`, depth + 1, out);
    }
    return out;
  }
  for (const key of Object.keys(value).sort()) {
    await keyShape(value[key], prefix ? `${prefix}.${key}` : key, depth + 1, out);
  }
  return out;
}

/// URL の可変部分（UUID・クエリ値）を伏せてパターンだけにする。
/// 相対 URL（"/api/..." 形式で fetch されることがある）も location 基準で解決する
export function urlPattern(rawURL, base = (typeof location !== 'undefined' ? location.href : undefined)) {
  try {
    const url = new URL(rawURL, base);
    const path = url.pathname
      .split('/')
      .map((part) => {
        if (!part) return part;
        if (UUID_RE.test(part)) return '<uuid>';
        // 利用者IDや会話IDのような「長い不透明な文字列」も伏せる。
        // 実測で wss の path に user-<id> が入っていた（2026-08-06）
        if (/^[A-Za-z]+-[A-Za-z0-9_-]{12,}$/.test(part)) return '<id>';
        if (/^[A-Za-z0-9_-]{16,}$/.test(part) && /\d/.test(part)) return '<id>';
        return part;
      })
      .join('/');
    // host 名にも識別子が入ることがあるので、既知のサービス以外は畳む

    const query = [...url.searchParams.keys()].sort();
    return url.origin + path + (query.length ? `?${query.join('&')}=<redacted>` : '');
  } catch {
    return '<unparsable>';
  }
}
