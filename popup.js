const $ = (id) => document.getElementById(id);
const ask = (channel) => new Promise((r) => chrome.runtime.sendMessage({ channel }, (x) => { void chrome.runtime.lastError; r(x || {}); }));

async function render() {
  const s = await ask('memoria-status');
  $('enabled').checked = !!s.enabled;
  $('sent').textContent = s.sentTotal ?? 0;
  $('queued').textContent = s.queued ?? 0;
  $('last').textContent = s.lastSentAt ? new Date(s.lastSentAt).toLocaleTimeString('ja-JP') : 'まだ';
  const state = $('state');
  if (!s.enabled) { state.className = 'state off'; state.textContent = 'いまは止まっています。ページは一切読み取っていません。'; return; }
  if (s.lastError) {
    state.className = 'state error';
    state.textContent = `memoriaにつながりません（${s.lastError}）。Macでmemoriaを起動すると、待っている分から渡します。`;
    return;
  }
  state.className = 'state ok';
  state.textContent = `渡し先は ${s.endpoint} だけ。外部サーバーへは送っていません。`;
}

$('enabled').addEventListener('change', async (e) => {
  await chrome.storage.local.set({ enabled: e.target.checked });
  render();
});
$('flush').addEventListener('click', async () => { await ask('memoria-flush'); render(); });
$('options').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
render();
setInterval(render, 3000);
