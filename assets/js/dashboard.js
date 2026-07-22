// AI Developments Dashboard — rendering logic
// Reads data/sources.json (config) + data/articles/<category>.json (items)
// + data/history/<category>.json (sparkline points)

const CATEGORY_META = {
  overall:    { color: 'var(--c-overall)' },
  hardware:   { color: 'var(--c-hardware)' },
  governance: { color: 'var(--c-governance)' },
  tools:      { color: 'var(--c-tools)' },
  military:   { color: 'var(--c-military)' },
  x_feed:     { color: 'var(--c-xfeed)' },
  papers:     { color: 'var(--c-papers)' },
};

const COUNTRY_COORDS = {
  'united states': [38, -97], 'usa': [38, -97], 'us': [38, -97],
  'european union': [50.8, 4.3], 'eu': [50.8, 4.3],
  'france': [46.6, 2.2], 'germany': [51.2, 10.5], 'united kingdom': [54, -2],
  'uk': [54, -2], 'china': [35, 103], 'japan': [36, 138], 'india': [21, 78],
  'canada': [56, -106], 'australia': [-25, 133], 'singapore': [1.35, 103.8],
  'south korea': [36, 128], 'pakistan': [30, 70], 'switzerland': [46.8, 8.2],
  'brazil': [-14, -51], 'international': [46.2, 6.1], 'oecd': [48.85, 2.35],
  'un': [46.2, 6.1], 'united nations': [46.2, 6.1],
};

const STOPWORDS = new Set(['the','a','an','of','to','in','on','for','and','or','is','are',
  'at','by','with','from','as','it','its','this','that','be','has','have','will','new',
  'says','after','over','into','how','why','what','ai','vs','amid','than','their','not']);

let STATE = { channels: {}, activeChips: new Set(), searchQuery: '' };

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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const safe = escapeHtml(text);
  const q = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(`(${q})`, 'ig'), '<mark>$1</mark>');
}

function signalBars(count) {
  const lit = count === 0 ? 0 : count < 3 ? 1 : count < 8 ? 2 : count < 15 ? 3 : 4;
  let html = '<span class="signal-bars">';
  for (let i = 0; i < 4; i++) html += `<span style="opacity:${i < lit ? 1 : 0.25}"></span>`;
  return html + '</span>';
}

function renderSparkline(history, color) {
  if (!history || history.length < 2) {
    return `<svg class="sparkline" viewBox="0 0 100 24" width="100" height="24"></svg>`;
  }
  const counts = history.map(h => h.count);
  const max = Math.max(...counts, 1);
  const min = Math.min(...counts, 0);
  const range = Math.max(max - min, 1);
  const w = 100, h = 24, pad = 2;
  const step = (w - pad * 2) / (counts.length - 1);
  const points = counts.map((c, i) => {
    const x = pad + i * step;
    const y = h - pad - ((c - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="sparkline" viewBox="0 0 100 24" width="100" height="24">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

function renderItem(item) {
  const hasPreview = !!item.preview;
  return `
    <li data-title="${escapeHtml((item.title + ' ' + (item.preview||'') + ' ' + (item.source||'')).toLowerCase())}">
      <div class="item-title-row" ${hasPreview ? `onclick="toggleExpand(this)"` : ''}>
        <a class="item-title" href="${item.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(item.title)}</a>
        <span class="item-meta">${escapeHtml(item.source || '')} · ${timeAgo(item.published)}</span>
      </div>
      ${hasPreview ? `<div class="item-preview">${escapeHtml(item.preview)}</div>` : ''}
    </li>`;
}

function toggleExpand(rowEl) {
  rowEl.parentElement.classList.toggle('is-expanded');
}

function renderChannel(catKey, label, data, history) {
  const meta = CATEGORY_META[catKey] || { color: 'var(--amber)' };
  const colorVarName = meta.color.replace('var(', '').replace(')', '');
  const colorResolved = getComputedStyle(document.documentElement).getPropertyValue(colorVarName) || '#F2B155';
  const items = (data.items || []).slice(0, 8);
  const isActive = items.length > 0;

  const itemsHtml = items.map(item => renderItem(item)).join('');
  const emptyHtml = items.length ? '' :
    `<div class="empty-state">No items fetched yet.<br>Run the fetch workflow or check sources in the control panel.</div>`;

  return `
    <div class="channel ${isActive ? 'is-active' : ''}" data-cat="${catKey}" style="--signal-color:${meta.color}">
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
      ${renderSparkline(history, colorResolved.trim() || '#F2B155')}
      <ul class="item-list">${itemsHtml}</ul>
      ${emptyHtml}
    </div>`;
}

function renderAllChannels() {
  const grid = document.getElementById('channel-grid');
  let html = '';
  for (const [key, ch] of Object.entries(STATE.channels)) {
    html += renderChannel(key, ch.label, ch.data, ch.history);
  }
  grid.innerHTML = html;
  applyFilters();
}

function renderChips() {
  const row = document.getElementById('chip-row');
  let html = '';
  for (const [key, ch] of Object.entries(STATE.channels)) {
    const off = STATE.activeChips.has(key);
    const colorVarName = ((CATEGORY_META[key]||{}).color || '').replace('var(','').replace(')','');
    const color = colorVarName ? getComputedStyle(document.documentElement).getPropertyValue(colorVarName) : '#F2B155';
    html += `<div class="chip ${off ? 'is-off' : ''}" style="color:${off ? '' : color.trim()}" onclick="toggleChip('${key}')">
      <span class="chip-swatch"></span>${escapeHtml(ch.label)}
    </div>`;
  }
  row.innerHTML = html;
}

function toggleChip(key) {
  if (STATE.activeChips.has(key)) STATE.activeChips.delete(key);
  else STATE.activeChips.add(key);
  renderChips();
  applyFilters();
}

function applyFilters() {
  const query = document.getElementById('search-input').value.trim().toLowerCase();
  STATE.searchQuery = query;

  document.querySelectorAll('.channel').forEach(chEl => {
    const catKey = chEl.dataset.cat;
    const hiddenByChip = STATE.activeChips.has(catKey);
    let visibleItemCount = 0;
    const allLis = chEl.querySelectorAll('.item-list li');

    allLis.forEach(li => {
      const matches = !query || (li.dataset.title || '').includes(query);
      li.classList.toggle('is-filtered-out', !matches);
      if (matches) visibleItemCount++;
    });

    const hiddenBySearch = !!query && visibleItemCount === 0 && allLis.length > 0;
    chEl.classList.toggle('is-hidden', hiddenByChip || hiddenBySearch);
  });
}

function selectKeyword(word) {
  document.getElementById('search-input').value = word;
  applyFilters();
}

function renderKeywordStrip() {
  const freq = {};
  for (const ch of Object.values(STATE.channels)) {
    for (const item of (ch.data.items || [])) {
      const words = (item.title || '').toLowerCase().match(/[a-z0-9][a-z0-9\-]{2,}/g) || [];
      for (const w of words) {
        if (STOPWORDS.has(w)) continue;
        freq[w] = (freq[w] || 0) + 1;
      }
    }
  }
  const top = Object.entries(freq)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  const strip = document.getElementById('keyword-strip');
  strip.innerHTML = top.map(([word, count]) =>
    `<span class="keyword-chip" onclick="selectKeyword('${word.replace(/'/g, "")}')">${escapeHtml(word)}<span class="kw-count">${count}</span></span>`
  ).join('');
}

function project(lat, lon, w, h) {
  const x = (lon + 180) / 360 * w;
  const y = (90 - lat) / 180 * h;
  return [x, y];
}

function renderGovernanceMap() {
  const gov = STATE.channels['governance'];
  const section = document.getElementById('map-section');
  if (!gov) { section.style.display = 'none'; return; }

  const counts = {};
  for (const item of (gov.data.items || [])) {
    const country = (item.country || '').toLowerCase().trim();
    if (!country) continue;
    counts[country] = (counts[country] || 0) + 1;
  }
  const plotted = Object.entries(counts).filter(([c]) => COUNTRY_COORDS[c]);
  if (plotted.length === 0) { section.style.display = 'none'; return; }

  section.style.display = 'block';
  const w = 700, h = 340;
  const maxCount = Math.max(...plotted.map(([, c]) => c), 1);

  let gridLines = '';
  for (let gx = 0; gx <= w; gx += w / 12) gridLines += `<line x1="${gx}" y1="0" x2="${gx}" y2="${h}" stroke="var(--hairline)" stroke-width="1"/>`;
  for (let gy = 0; gy <= h; gy += h / 6) gridLines += `<line x1="0" y1="${gy}" x2="${w}" y2="${gy}" stroke="var(--hairline)" stroke-width="1"/>`;

  let markers = '';
  for (const [country, count] of plotted) {
    const [lat, lon] = COUNTRY_COORDS[country];
    const [x, y] = project(lat, lon, w, h);
    const r = 4 + (count / maxCount) * 10;
    markers += `
      <g class="map-marker">
        <circle cx="${x}" cy="${y}" r="${r}"/>
        <text x="${x + r + 4}" y="${y + 3}">${escapeHtml(country)} · ${count}</text>
      </g>`;
  }

  document.getElementById('map-container').innerHTML =
    `<svg viewBox="0 0 ${w} ${h}">${gridLines}${markers}</svg>`;
}

async function triggerRefresh() {
  const btn = document.getElementById('refresh-btn');
  let token = sessionStorage.getItem('gh_pat_dashboard');
  if (!token) {
    token = prompt('GitHub token (fine-grained, Actions: write) — used once per session, never stored on disk:');
    if (!token) return;
    sessionStorage.setItem('gh_pat_dashboard', token);
  }

  btn.classList.add('is-loading');
  btn.textContent = '↻ Triggering…';
  try {
    const res = await fetch(
      `https://api.github.com/repos/${SITE_CONFIG.owner}/${SITE_CONFIG.repo}/actions/workflows/${SITE_CONFIG.workflowFile}/dispatches`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: SITE_CONFIG.branch }),
      }
    );
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    showToast('Fetch workflow triggered — data will update in a minute or two.');
  } catch (e) {
    sessionStorage.removeItem('gh_pat_dashboard');
    showToast('Could not trigger refresh — ' + e.message);
  } finally {
    btn.classList.remove('is-loading');
    btn.textContent = '↻ Refresh now';
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

async function init() {
  const grid = document.getElementById('channel-grid');
  try {
    const sources = await loadJSON('data/sources.json');
    let mostRecentSync = null;

    for (const [key, cfg] of Object.entries(sources.categories)) {
      let data = { items: [], last_updated: null };
      let history = [];
      try { data = await loadJSON(`data/articles/${key}.json`); } catch (e) { console.warn('No article data for', key); }
      try { history = await loadJSON(`data/history/${key}.json`); } catch (e) { /* optional */ }

      if (data.last_updated && (!mostRecentSync || data.last_updated > mostRecentSync)) {
        mostRecentSync = data.last_updated;
      }
      STATE.channels[key] = { label: cfg.label, data, history, sources: cfg.sources };
    }

    renderAllChannels();
    renderChips();
    renderKeywordStrip();
    renderGovernanceMap();
    document.getElementById('last-sync').textContent = mostRecentSync ? timeAgo(mostRecentSync) : 'never';
  } catch (err) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:60px;">
      Could not load dashboard data. Check that data/sources.json exists.</div>`;
    console.error(err);
  }
}

init();
