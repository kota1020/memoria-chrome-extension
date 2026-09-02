import { buildContextQuery, hostnameFromUrl } from './context-query.js';

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

function renderContext(data) {
  const root = $('context');
  root.replaceChildren();
  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  const facts = Array.isArray(data?.facts) ? data.facts : [];
  const items = [
    ...tasks.slice(0, 3).map((task) => `${text(task.name || task.title || 'タスク')} ${task.status ? `［${text(task.status)}］` : ''}`.trim()),
    ...facts.slice(0, 3).map((fact) => typeof fact === 'string' ? fact : text(fact.text || fact.value || fact.name)),
  ].filter(Boolean);
  if (!items.length) return addEmpty(root, '現在の文脈はまだありません。');
  for (const value of items) {
    const node = document.createElement('p');
    node.className = 'context-item';
    node.textContent = value;
    root.append(node);
  }
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
    // chrome://, Web Storeなどの制限ページでは選択テキストを読まない。
    return '';
  }
}

async function load() {
  const status = $('status');
  status.className = 'status';
  status.textContent = 'Memoriaを確認しています…';
  try {
    const tab = await getActiveTab();
    const selection = await getSelection(tab.id);
    $('page-title').textContent = text(tab.title) || 'タイトルなし';
    $('page-host').textContent = hostnameFromUrl(tab.url) || 'このページのURLは取得できません';
    $('selection').textContent = selection ? `選択中: ${selection}` : '';
    $('selection').hidden = !selection;
    const query = buildContextQuery(tab, selection);
    const handoffParams = new URLSearchParams({ q: query, limit: '5', ai: 'chrome-sidepanel', disclosure: 'context' });
    const [handoff, context] = await Promise.all([
      getJson(`/handoff?${handoffParams}`),
      getJson('/context?disclosure=context'),
    ]);
    renderCards(Array.isArray(handoff?.cards) ? handoff.cards : []);
    renderContext(context);
    status.textContent = query ? 'ページの手がかりから、関連する記憶を絞りました。' : '現在の文脈を表示しています。';
  } catch (error) {
    $('cards').replaceChildren();
    $('context').replaceChildren();
    addEmpty($('cards'), 'Memoria APIに接続できません。');
    addEmpty($('context'), 'Memoriaを起動してから更新してください。');
    status.className = 'status error';
    status.textContent = `${error.message || '読み込みに失敗しました'}。`;
  }
}

document.addEventListener('DOMContentLoaded', load);
$('refresh')?.addEventListener('click', load);
