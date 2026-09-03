import { buildContextQuery, hostnameFromUrl } from './context-query.js';

// 問い合わせ先はこのMacの中だけ。ここ以外へは接続しない
const API = 'http://127.0.0.1:4319';
const $ = (id) => document.getElementById(id);

function text(value) {
  return String(value ?? '').trim();
}

function addEmpty(parent, message) {
  const node = document.createElement('p');
  node.className = 'empty';
  node.textContent = message;
  parent.append(node);
}

function renderCards(cards) {
  const root = $('cards');
  root.replaceChildren();
  $('card-count').textContent = cards.length ? `${cards.length}件` : '';
  if (!cards.length) return addEmpty(root, 'このページに近い記憶はまだありません。');
  for (const card of cards.slice(0, 5)) {
    const node = document.createElement('article');
    node.className = 'memory';
    const title = document.createElement('p');
    title.className = 'memory-title';
    title.textContent = text(card.title || card.name || card.kind || '記憶');
    const body = document.createElement('p');
    body.className = 'memory-text';
    body.textContent = text(card.text || card.goal || card.evidence || '');
    node.append(title, body);
    if (card.when || card.last_seen) {
      const meta = document.createElement('div');
      meta.className = 'memory-meta';
      meta.textContent = text(card.when || card.last_seen);
      node.append(meta);
    }
    root.append(node);
  }
}

/// 「続きから」＝ローカルMemoriaが走行中・中断中と見ているタスク。
/// 拡張側では何も推測しない。APIが返したものをそのまま並べるだけ
const RESUMABLE = new Set(['ongoing', 'paused', 'active', 'in_progress']);

function renderResume(tasks) {
  const section = $('resume-section');
  const root = $('resume');
  root.replaceChildren();
  const items = tasks.filter((task) => RESUMABLE.has(text(task.status))).slice(0, 3);
  section.hidden = items.length === 0;
  $('resume-count').textContent = items.length ? `${items.length}件` : '';
  for (const task of items) {
    const node = document.createElement('article');
    node.className = 'memory resume-item';
    const title = document.createElement('p');
    title.className = 'memory-title';
    title.textContent = text(task.name || task.title || 'タスク');
    node.append(title);
    const goal = text(task.goal);
    if (goal) {
      const body = document.createElement('p');
      body.className = 'memory-text';
      body.textContent = goal;
      node.append(body);
    }
    const meta = document.createElement('div');
    meta.className = 'memory-meta';
    const status = text(task.status) === 'paused' ? '中断中' : '作業中';
    const when = text(task.last_active).slice(11, 16);
    meta.textContent = [status, when ? `最終 ${when}` : ''].filter(Boolean).join(' ・ ');
    node.append(meta);
    root.append(node);
  }
}

function renderContext(data) {
  const root = $('context');
  root.replaceChildren();
  const facts = Array.isArray(data?.facts) ? data.facts : [];
  const items = facts
    .slice(0, 4)
    .map((fact) => (typeof fact === 'string' ? fact : text(fact.text || fact.value || fact.name)))
    .filter(Boolean);
  if (!items.length) return addEmpty(root, '現在の文脈はまだありません。');
  for (const value of items) {
    const node = document.createElement('p');
    node.className = 'context-item';
    node.textContent = value;
    root.append(node);
  }
}

/// つながらなかった理由を、利用者が次に何をすればいいか分かる日本語にする
function reasonText(error) {
  const message = String((error && error.message) || '');
  if (message.startsWith('Memoria API ')) {
    return `Memoriaは応答しましたが、エラーを返しました（${message.replace('Memoria API ', 'HTTP ')}）。`;
  }
  return `${API} へ接続できませんでした（Memoriaが起動していないか、別のポートで動いています）。`;
}

function showOffline(error) {
  for (const node of document.querySelectorAll('.api-url')) node.textContent = API;
  for (const node of document.querySelectorAll('.api-host')) node.textContent = API.replace(/^https?:\/\//, '');
  $('offline-reason').textContent = reasonText(error);
  $('offline').hidden = false;
  $('resume-section').hidden = true;
  $('cards-section').hidden = true;
  $('context-section').hidden = true;
  const status = $('status');
  status.className = 'status error';
  status.textContent = 'Memoriaの読み取りAPIに接続できません。';
}

function showOnline() {
  $('offline').hidden = true;
  $('cards-section').hidden = false;
  $('context-section').hidden = false;
}

async function getJson(path) {
  const response = await fetch(`${API}${path}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Memoria API ${response.status}`);
  return response.json();
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || {};
}

async function getSelection(tabId) {
  if (!tabId || !chrome.scripting?.executeScript) return '';
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window.getSelection?.().toString() || '').trim().slice(0, 800),
    });
    return text(result?.result);
  } catch {
    // chrome:// や Web Store など、拡張が触れないページでは何も読まない
    return '';
  }
}

async function load() {
  const status = $('status');
  status.className = 'status';
  status.textContent = 'Memoriaを確認しています…';
  const tab = await getActiveTab();
  const selection = await getSelection(tab.id);
  $('page-title').textContent = text(tab.title) || 'タイトルなし';
  $('page-host').textContent = hostnameFromUrl(tab.url) || 'このページのURLは取得できません';
  $('selection').textContent = selection ? `選択中: ${selection}` : '';
  $('selection').hidden = !selection;

  try {
    const query = buildContextQuery(tab, selection);
    const handoffParams = new URLSearchParams({
      q: query, limit: '5', ai: 'chrome-sidepanel', disclosure: 'context' });
    const [handoff, context] = await Promise.all([
      getJson(`/handoff?${handoffParams}`),
      getJson('/context?disclosure=context'),
    ]);
    showOnline();
    renderResume(Array.isArray(context?.tasks) ? context.tasks : []);
    renderCards(Array.isArray(handoff?.cards) ? handoff.cards : []);
    renderContext(context);
    status.textContent = query
      ? 'ページの手がかりから、関連する記憶を絞りました。'
      : '現在の文脈を表示しています。';
  } catch (error) {
    showOffline(error);
  }
}

document.addEventListener('DOMContentLoaded', load);
$('refresh')?.addEventListener('click', load);
