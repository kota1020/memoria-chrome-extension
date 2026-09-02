export function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

export function buildContextQuery(tab = {}, selection = '') {
  const parts = [tab.title, hostnameFromUrl(tab.url), selection]
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return parts.join(' ').slice(0, 1200);
}
