const $ = (id) => document.getElementById(id);
const lines = (value) => String(value || '').split('\n').map((s) => s.trim().toLowerCase()).filter(Boolean);

chrome.storage.local.get(['denylist', 'offlist', 'endpoint']).then((s) => {
  $('denylist').value = (s.denylist || []).join('\n');
  $('offlist').value = (s.offlist || []).join('\n');
  $('endpoint').value = s.endpoint || 'http://127.0.0.1:4319';
});

$('save').addEventListener('click', async () => {
  let endpoint = $('endpoint').value.trim() || 'http://127.0.0.1:4319';
  // 外部へ送る設定にはできないようにする。ここが製品の約束の芯
  try {
    const url = new URL(endpoint);
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('loopback only');
    endpoint = url.origin;
  } catch {
    $('saved').textContent = '渡し先は 127.0.0.1 のみです';
    $('saved').className = 'saved error';
    return;
  }
  await chrome.storage.local.set({ denylist: lines($('denylist').value), offlist: lines($('offlist').value), endpoint });
  $('endpoint').value = endpoint;
  $('saved').textContent = '保存しました';
  $('saved').className = 'saved';
});
