// AI Developments Dashboard — rendering logic
// Reads data/sources.json (labels/config) + data/articles/<category>.json (fetched items)

const CATEGORY_META = {
  overall:    { color: 'var(--c-overall)' },
  hardware:   { color: 'var(--c-hardware)' },
  governance: { color: 'var(--c-governance)' },
  tools:      { color: 'var(--c-tools)' },
  military:   { color: 'var(--c-military)' },
  x_feed:     { color: 'var(--c-xfeed)' },
  papers:     { color: 'var(--c-papers)' },
};

async function loadJSON(path) {
  const res = await fetch(path + '?_=' + Date.now());
  if (!res.ok) throw new Error('Failed to load ' + path);
  return res.json();
}

function timeAgo(iso) {
  if (!iso) return 'no data yet';
  const diffMs = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diffMs / 3600000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return hrs + 'h ago';
  return Math.floor(hrs / 24) + 'd ago';
}

function signalBars(count) {
  // activity level: 0 items = dim, scales up to 4 bars lit
  const lit = count === 0 ? 0 : count < 3 ? 1 : count < 8 ? 2 : count < 15 ? 3 : 4;
  let html = '<span class="signal-bars">';
  for (let i = 0; i < 4; i++) {
    html += `<span style="opacity:${i < lit ? 1 : 0.25}"></span>`;
  }
  return html + '</span>';
}

function renderChannel(catKey, label, data) {
  const meta = CATEGORY_META[catKey] || { color: 'var(--amber)' };
  const items = (data.items || []).slice(0, 8);
  const isActive = items.length > 0;

  const itemsHtml = items.length
    ? items.map(item => `
        <li>
          <a class="item-title" href="${item.url}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>
          <span class="item-meta">${escapeHtml(item.source || '')} · ${timeAgo(item.published)}</span>
        </li>`).join('')
    : '';

  const emptyHtml = items.length
    ? ''
    : `<div class="empty-state">No items fetched yet.<br>Run the fetch workflow or check sources in the control panel.</div>`;

  return `
    <div class="channel ${isActive ? 'is-active' : ''}" style="--signal-color:${meta.color}">
      <div class="channel-head">
        <div class="channel-title">
          <span class="swatch" style="background:${meta.color}"></span>
          <h2>${escapeHtml(label)}</h2>
          ${signalBars(items.length)}
        </div>
        <div class="channel-meta">
          ${items.length} item${items.length === 1 ? '' : 's'}<br>
          ${timeAgo(data.last_updated)}
        </div>
      </div>
      <ul class="item-list">${itemsHtml}</ul>
      ${emptyHtml}
    </div>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

async function init() {
  const grid = document.getElementById('channel-grid');
  try {
    const sources = await loadJSON('data/sources.json');
    const categories = sources.categories;
    let mostRecentSync = null;
    let html = '';

    for (const [key, cfg] of Object.entries(categories)) {
      let data = { items: [], last_updated: null };
      try {
        data = await loadJSON(`data/articles/${key}.json`);
      } catch (e) {
        console.warn('No data yet for', key);
      }
      if (data.last_updated && (!mostRecentSync || data.last_updated > mostRecentSync)) {
        mostRecentSync = data.last_updated;
      }
      html += renderChannel(key, cfg.label, data);
    }

    grid.innerHTML = html;
    document.getElementById('last-sync').textContent = mostRecentSync ? timeAgo(mostRecentSync) : 'never';
  } catch (err) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:60px;">
      Could not load dashboard data. Check that data/sources.json exists.</div>`;
    console.error(err);
  }
}

init();
