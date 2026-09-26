// AI Watchtower: dashboard and admin panel.
//
// Reads data/sources.json (categories, sources, settings, library),
// data/items.json (fetched items), data/watch.json (watched-page changes),
// data/health.json (per-source status) and data/summaries.json.
//
// The admin panel edits a copy of sources.json and commits it through the
// GitHub API with a token the user pastes in. The token is kept in
// sessionStorage only, so it is gone when the tab closes.
(function () {
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = u => /^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '#';
const store = {
  get(k, d) { try { const v = localStorage.getItem('aiw:' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('aiw:' + k, JSON.stringify(v)); } catch (e) {} },
};
const session = {
  get(k) { try { return sessionStorage.getItem('aiw:' + k); } catch (e) { return null; } },
  set(k, v) { try { v === null ? sessionStorage.removeItem('aiw:' + k) : sessionStorage.setItem('aiw:' + k, v); } catch (e) {} },
};
const H = 3600e3, DAY = 24 * H;
const NOW = Date.now();

// "New" means published or fetched after your previous visit. The cutoff is
// fixed for the whole tab session so reloading doesn't clear it.
let cutoff = +session.get('cutoff');
if (!cutoff) {
  cutoff = store.get('lastVisit', NOW - DAY);
  session.set('cutoff', String(cutoff));
  store.set('lastVisit', NOW);
}

let CFG = null, ITEMS = [], WATCH = {}, HEALTH = {}, SUMMARIES = {}, UPDATED = null;
let readIds = new Set(store.get('read', []));
let starIds = new Set(store.get('stars', []));
let state = { view: 'brief', cat: null, range: store.get('range', 0), type: 'All', src: null, country: null, sel: -1 };

/* ---------------- data ---------------- */
async function loadJSON(path, fallback) {
  try {
    const r = await fetch(path + '?v=' + Math.floor(NOW / 60000), { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}
const srcById = id => CFG.sources.find(s => s.id === id);
const catBy = k => CFG.categories.find(c => c.key === k) || { key: k, short: k, name: k, color: '#8C9099' };

function hydrate(raw) {
  ITEMS = raw.map(it => {
    const s = srcById(it.source);
    if (!s || s.active === false) return null;
    const cats = (s.cats || []).filter(k => CFG.categories.some(c => c.key === k));
    if (!cats.length) return null;
    const t = Date.parse(it.published) || Date.parse(it.fetched) || 0;
    const f = Date.parse(it.fetched) || t;
    return { ...it, t, f, src: s, cats, type: s.type || 'News', countries: it.countries || [] };
  }).filter(Boolean).sort((a, b) => b.t - a.t);
}
let RAW_ITEMS = [];

/* ---------------- helpers ---------------- */
const isNew = it => Math.max(it.t, it.f) > cutoff && it.t > NOW - 7 * DAY && !readIds.has(it.id);
const inRange = it => !state.range || NOW - it.t <= state.range * DAY;
function rel(t) {
  const d = NOW - t;
  if (d < 0) return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  if (d < H) return Math.max(1, Math.round(d / 60e3)) + 'm ago';
  if (d < DAY) return Math.round(d / H) + 'h ago';
  if (d < 30 * DAY) return Math.round(d / DAY) + 'd ago';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function focusHits(it) {
  const t = (it.title + ' ' + (it.preview || '')).toLowerCase();
  return (CFG.settings?.focus_keywords || []).filter(k => {
    if (k.length <= 4 && k === k.toUpperCase()) return new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(it.title + ' ' + (it.preview || ''));
    return t.includes(k.toLowerCase());
  });
}
function score(it) {
  const age = NOW - it.t;
  let s = focusHits(it).length * 3;
  if (['Official', 'Think tank'].includes(it.type)) s += 1.5;
  if (it.cats.some(c => ['geo', 'risk', 'mil', 'peace', 'multi'].includes(c))) s += 1;
  if (age < 2 * DAY) s += 2.5; else if (age < 7 * DAY) s += 1;
  if (it.countries.length) s += .5;
  if (it.src.method === 'arxiv') s -= 1.5;
  return s;
}
function catLabel(k) { const c = catBy(k); return `<span class="catlabel"><i style="background:${esc(c.color)}"></i>${esc(c.short)}</span>`; }
function toast(msg, ms) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), ms || 2800); }
const ICONS = {
  brief: '<path d="M4 5h16M4 10h10M4 15h16M4 20h8"/>',
  world: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  lib: '<path d="M5 4h4v16H5zM10 4h4v16h-4zM15.5 4.5l3.5 1 -3.5 15-3.5-1z"/>',
  saved: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  admin: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
};
const ico = k => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${ICONS[k]}</svg>`;
const starSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';

function watchInfo(s) {
  const w = WATCH[s.id];
  const h = HEALTH[s.id];
  if (h && h.status === 'error') return { cls: '', label: 'unreachable', what: h.error || 'Could not load the page' };
  if (!w) return { cls: '', label: 'not checked yet', what: 'Checked on the next fetch' };
  if (w.changed_at) {
    const t = Date.parse(w.changed_at);
    const recent = NOW - t < DAY;
    const first = (w.added || [])[0];
    return { cls: recent ? 'changed' : '', label: 'changed ' + rel(t), what: first ? 'New: ' + first.text : 'Page content changed', url: first?.url, t };
  }
  return { cls: '', label: 'no change', what: 'Watching since ' + rel(Date.parse(w.checked_at)).replace(' ago', ' ago') };
}

/* ---------------- nav ---------------- */
function renderNav() {
  const newTotal = ITEMS.filter(isNew).length;
  const main = [['brief', 'Briefing', newTotal], ['world', 'World', null], ['lib', 'Library', null], ['saved', 'Saved', starIds.size || null], ['admin', 'Admin', null]];
  $('#nav-main').innerHTML = main.map(([k, l, n]) => `<button data-view="${k}" aria-current="${state.view === k}">${ico(k)}${l}${n ? `<span class="count ${k === 'brief' ? 'new' : ''}">${n}</span>` : ''}</button>`).join('');
  $('#nav-cats').innerHTML = CFG.categories.map(c => {
    const n = ITEMS.filter(i => i.cats.includes(c.key) && isNew(i)).length;
    return `<button data-cat="${esc(c.key)}" aria-current="${state.view === 'cat' && state.cat === c.key}"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.short)}<span class="count ${n ? 'new' : ''}">${n || ''}</span></button>`;
  }).join('');
  const up = Date.parse(UPDATED);
  $('#synced').textContent = up ? rel(up) : 'never';
  const next = new Date(NOW); next.setUTCMinutes(0, 0, 0); next.setUTCHours(next.getUTCHours() + (next.getUTCHours() % 2 ? 1 : 2));
  const mins = Math.max(1, Math.round((next - NOW) / 60e3));
  $('#nextfetch').textContent = mins < 60 ? `in ${mins}m` : `in ${Math.floor(mins / 60)}h ${mins % 60}m`;
  $('#src-count').textContent = CFG.sources.filter(s => s.active !== false).length + ' sources · ' + CFG.categories.length + ' categories';
  $$('#range button').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.r === state.range)));
}

/* ---------------- briefing ---------------- */
function spark(cat) {
  const days = 14, counts = Array(days).fill(0);
  ITEMS.forEach(i => { if (i.cats.includes(cat.key)) { const d = Math.floor((NOW - i.t) / DAY); if (d >= 0 && d < days) counts[days - 1 - d]++; } });
  const max = Math.max(1, ...counts), w = 200, h = 28;
  const pts = counts.map((c, i) => [i * (w / (days - 1)), h - 3 - (c / max) * (h - 7)]);
  const line = pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ');
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,${h} ${line} ${w},${h}" fill="${esc(cat.color)}" opacity=".12"/><polyline points="${line}" fill="none" stroke="${esc(cat.color)}" stroke-width="1.5" vector-effect="non-scaling-stroke"/><circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="${esc(cat.color)}"/></svg>`;
}
function whyTags(it) {
  const f = focusHits(it).slice(0, 3).map(k => `<span class="tag focus">${esc(k)}</span>`);
  const c = it.countries.slice(0, 2).map(k => `<span class="tag">${esc(k)}</span>`);
  return f.concat(c).join('');
}
function renderBrief() {
  const pool = ITEMS.filter(i => NOW - i.t < 7 * DAY && i.t <= NOW + H);
  const perSource = {};
  const top = pool.map(i => [score(i), i]).sort((a, b) => b[0] - a[0] || b[1].t - a[1].t)
    .filter(([, i]) => (perSource[i.source] = (perSource[i.source] || 0) + 1) <= 2).slice(0, 8).map(x => x[1]);
  const newItems = ITEMS.filter(isNew);
  const newCats = new Set(newItems.flatMap(i => i.cats)).size;
  const date = new Date(NOW).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const watch = CFG.sources.filter(s => s.method === 'watch' && s.active !== false).map(s => ({ s, w: watchInfo(s) }))
    .sort((a, b) => (b.w.t || 0) - (a.w.t || 0)).slice(0, 10);
  const srcCounts = {};
  ITEMS.filter(i => NOW - i.t < 7 * DAY).forEach(i => srcCounts[i.source] = (srcCounts[i.source] || 0) + 1);
  const pulse = Object.entries(srcCounts).sort((a, b) => b[1] - a[1]).slice(0, 7);
  const pmax = pulse.length ? pulse[0][1] : 1;
  $('#view').innerHTML = `
    <div class="view-head"><div>
      <div class="eyebrow">Briefing · ${esc(date)}</div>
      <h2>What moved in AI since you last looked</h2>
      <p class="lede">${newItems.length ? `<strong>${newItems.length} new items</strong> across ${newCats} ${newCats === 1 ? 'category' : 'categories'} since your last visit.` : 'Nothing new since your last visit.'} Top developments are ranked by your focus keywords, source type and recency.</p>
    </div></div>
    <div class="brief-grid">
      <section>
        <div class="section-title"><h3>Top developments</h3><span>last 7 days</span></div>
        <div class="top-list">${top.length ? top.map((it, n) => `
          <article class="top-item ${n === 0 ? 'lead' : ''}" data-id="${esc(it.id)}">
            <div class="rank num">${String(n + 1).padStart(2, '0')}</div>
            <div>
              <h3 class="t">${esc(it.title)}</h3>
              <div class="meta" style="margin-top:6px">${isNew(it) ? '<span class="newdot" title="New"></span>' : ''}${catLabel(it.cats[0])}<span class="sep">/</span>${esc(it.src.name)}<span class="sep">/</span>${rel(it.t)}</div>
            </div>
            <div class="why">${whyTags(it)}</div>
          </article>`).join('') : '<div class="empty">No items from the last 7 days yet.</div>'}
        </div>
        <div class="tiles">${CFG.categories.map(c => {
          const its = ITEMS.filter(i => i.cats.includes(c.key));
          const n = its.filter(isNew).length;
          const latest = its[0];
          return `<button class="tile" data-cat="${esc(c.key)}">
            <div class="tile-head"><i style="background:${esc(c.color)}"></i>${esc(c.short)}<span class="n num ${n ? '' : 'zero'}">${n ? n + ' new' : 'quiet'}</span></div>
            <p>${latest ? esc(latest.title) : 'Watched pages only. Updates appear when a page changes.'}</p>
            ${spark(c)}
          </button>`;
        }).join('')}</div>
      </section>
      <aside class="side">
        ${watch.length ? `<div class="panel">
          <h3>Watched institutions <small>page checks</small></h3>
          ${watch.map(({ s, w }) => `<div class="watch"><a href="${esc(safeUrl(s.home || s.url))}" target="_blank" rel="noopener">${esc(s.name)}</a><span class="when ${w.cls}">${esc(w.label)}</span><span class="what">${w.url ? `<a href="${esc(safeUrl(w.url))}" target="_blank" rel="noopener">${esc(w.what)}</a>` : esc(w.what)}</span></div>`).join('')}
        </div>` : ''}
        ${pulse.length ? `<div class="panel">
          <h3>Most active sources <small>7 days</small></h3>
          ${pulse.map(([id, c]) => `<div class="pulse-row"><span>${esc(srcById(id)?.name || id)}</span><span class="bar"><b style="width:${(c / pmax * 100).toFixed(0)}%"></b></span><span class="num">${c}</span></div>`).join('')}
        </div>` : ''}
      </aside>
    </div>`;
}

/* ---------------- feeds ---------------- */
function feedRows(list, showCat) {
  if (!list.length) return `<div class="empty">Nothing matches these filters. Try a wider time range.</div>`;
  let html = '', lastDay = '', dividerDone = false;
  list.forEach((it, n) => {
    if (!dividerDone && n > 0 && !isNew(it) && isNew(list[n - 1])) { html += `<div class="divider-new">Earlier</div>`; dividerDone = true; }
    const day = new Date(it.t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    if (day !== lastDay) { html += `<div class="day">${esc(day)}</div>`; lastDay = day; }
    html += `<article class="row ${readIds.has(it.id) ? 'read' : ''}" data-id="${esc(it.id)}">
      <span class="mark">${isNew(it) ? '<span class="newdot"></span>' : ''}</span>
      <h3 class="t">${esc(it.title)}</h3>
      <button class="star" data-star="${esc(it.id)}" aria-pressed="${starIds.has(it.id)}" aria-label="Save">${starSvg}</button>
      <div class="meta">${showCat ? catLabel(it.cats[0]) + '<span class="sep">/</span>' : ''}${esc(it.src.name)}<span class="sep">/</span>${esc(it.type)}<span class="sep">/</span>${rel(it.t)}${focusHits(it).slice(0, 2).map(k => `<span class="tag focus">${esc(k)}</span>`).join('')}</div>
      ${it.preview ? `<p class="pv">${esc(it.preview)}</p>` : ''}
    </article>`;
  });
  return html;
}
function renderCat() {
  const c = catBy(state.cat);
  let list = ITEMS.filter(i => i.cats.includes(c.key));
  const srcs = [...new Map(list.map(i => [i.source, i.src.name])).entries()];
  const types = ['All', ...new Set(list.map(i => i.type))];
  list = list.filter(inRange).filter(i => state.type === 'All' || i.type === state.type).filter(i => !state.src || i.source === state.src);
  const watch = CFG.sources.filter(s => s.method === 'watch' && (s.cats || []).includes(c.key) && s.active !== false);
  const newN = ITEMS.filter(i => i.cats.includes(c.key) && isNew(i)).length;
  const sum = SUMMARIES[c.key];
  const sumFresh = sum && NOW - Date.parse(sum.generated_at) < 3 * DAY && sum.bullets?.length;
  $('#view').innerHTML = `
    <div class="view-head"><div>
      <div class="eyebrow"><span class="catlabel"><i style="background:${esc(c.color)}"></i>Category</span></div>
      <h2>${esc(c.name)}</h2>
      <p class="lede">${newN ? `<strong>${newN} new</strong> · ` : ''}${srcs.length} sources with posts${watch.length ? ` · ${watch.length} watched ${watch.length === 1 ? 'page' : 'pages'}` : ''}</p>
    </div></div>
    ${sumFresh ? `<div class="summary-box"><div class="eyebrow">${sum.method === 'llm' ? 'AI summary' : 'Key lines'} · ${rel(Date.parse(sum.generated_at))}</div><ul>${sum.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul></div>` : ''}
    ${watch.length ? `<div class="watch-strip">${watch.map(s => { const w = watchInfo(s); return `<a class="wpill" href="${esc(safeUrl(w.url || s.home || s.url))}" target="_blank" rel="noopener" title="${esc(w.what)}">${esc(s.name)}<span class="when ${w.cls}">${esc(w.label)}</span></a>`; }).join('')}</div>` : ''}
    ${types.length > 2 ? `<div class="filters" role="group" aria-label="Source type">${types.map(t => `<button class="chip" data-type="${esc(t)}" aria-pressed="${state.type === t}">${esc(t)}</button>`).join('')}</div>` : ''}
    ${srcs.length > 1 ? `<div class="src-row" role="group" aria-label="Source"><button class="chip" data-src="" aria-pressed="${!state.src}">All sources</button>${srcs.map(([id, name]) => `<button class="chip" data-src="${esc(id)}" aria-pressed="${state.src === id}">${esc(name)}</button>`).join('')}</div>` : ''}
    <div class="feed">${feedRows(list, false)}</div>
    <div class="kbd-hint"><span><kbd>j</kbd> <kbd>k</kbd> move</span><span><kbd>o</kbd> open</span><span><kbd>s</kbd> save</span><span><kbd>m</kbd> read / unread</span></div>`;
}
function renderSaved() {
  const list = ITEMS.filter(i => starIds.has(i.id));
  $('#view').innerHTML = `
    <div class="view-head"><div><div class="eyebrow">Reading list</div><h2>Saved</h2>
    <p class="lede">Items you starred. Stored in this browser only.</p></div></div>
    <div class="feed">${list.length ? feedRows(list, true) : '<div class="empty">Nothing saved yet. Press the star on any item, or <kbd>s</kbd> when it is selected.</div>'}</div>`;
}

/* ---------------- world ---------------- */
const COORD = { 'United States': [39, -98], 'China': [35, 104], 'United Kingdom': [54, -2], 'European Union': [50.8, 4.4], 'Australia': [-25, 134], 'African Union': [9, 38.7], 'Taiwan': [23.7, 121], 'Japan': [36, 138], 'India': [21, 78], 'Russia': [60, 90], 'Pakistan': [30, 70], 'South Korea': [36.5, 128], 'Ukraine': [49, 32], 'Israel': [31, 35], 'Iran': [32, 53], 'France': [46.6, 2.2], 'Germany': [51, 10], 'Canada': [56, -106], 'Saudi Arabia': [24, 45], 'United Arab Emirates': [24, 54], 'Singapore': [1.35, 103.8], 'Brazil': [-14, -51], 'United Nations': [40.7, -74], 'NATO': [50.9, 4.4], 'Sweden': [60, 15], 'Estonia': [58.6, 25] };
function renderWorld() {
  const counts = {};
  ITEMS.filter(inRange).forEach(i => i.countries.forEach(c => counts[c] = (counts[c] || 0) + 1));
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const W = 1000, Hh = 470, max = entries.length ? entries[0][1] : 1;
  const proj = ([lat, lon]) => [(lon + 180) / 360 * W, (82 - lat) / 164 * Hh];
  let grid = '';
  for (let lon = -150; lon <= 150; lon += 30) { const x = (lon + 180) / 360 * W; grid += `<line x1="${x}" y1="0" x2="${x}" y2="${Hh}"/>`; }
  for (let lat = -60; lat <= 60; lat += 30) { const y = (82 - lat) / 164 * Hh; grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`; }
  const dots = entries.filter(([c]) => COORD[c]).map(([c, n]) => {
    const [x, y] = proj(COORD[c]); const r = 6 + Math.sqrt(n / max) * 26; const on = state.country === c;
    const anchorEnd = x > W - 170;
    return `<g class="mdot" data-country="${esc(c)}" style="cursor:pointer"><circle cx="${x}" cy="${y}" r="${r}" fill="#F2B84B" fill-opacity="${on ? .35 : .14}" stroke="#F2B84B" stroke-opacity="${on ? 1 : .55}"/><circle cx="${x}" cy="${y}" r="2.5" fill="#F2B84B"/><text x="${anchorEnd ? x - r - 6 : x + r + 6}" y="${y + 4}" text-anchor="${anchorEnd ? 'end' : 'start'}" fill="#ECE7DD" font-size="13" font-family="IBM Plex Sans, sans-serif">${esc(c)} <tspan fill="#8C9099" font-family="JetBrains Mono, monospace" font-size="11">${n}</tspan></text></g>`;
  }).join('');
  const list = state.country ? ITEMS.filter(inRange).filter(i => i.countries.includes(state.country)) : [];
  $('#view').innerHTML = `
    <div class="view-head"><div><div class="eyebrow">Geography</div><h2>Where developments are happening</h2>
    <p class="lede">Countries and blocs mentioned in headlines and summaries. Select one to see its timeline.</p></div></div>
    <div class="map-wrap"><svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Map of mentions by country"><g stroke="#1B1E24" stroke-width="1">${grid}</g><rect x="0" y="0" width="${W}" height="${Hh}" fill="none" stroke="#23272F"/>${dots}</svg></div>
    <div class="country-list">${entries.map(([c, n]) => `<button class="country" data-country="${esc(c)}" aria-pressed="${state.country === c}"><span>${esc(c)}</span><span class="num">${n}</span></button>`).join('')}</div>
    ${state.country ? `<div class="section-title"><h3>${esc(state.country)} timeline</h3><span>${list.length} items</span></div><div class="feed">${feedRows(list, true)}</div>` : ''}`;
}

/* ---------------- library ---------------- */
function renderLib() {
  const lib = CFG.library || { readings: [], trackers: [] };
  $('#view').innerHTML = `
    <div class="view-head"><div><div class="eyebrow">Reference</div><h2>Library</h2>
    <p class="lede">Annual reports, key readings and trackers. These don't stream news, so they live here instead of in the feed.</p></div></div>
    <div class="section-title"><h3>Important readings &amp; reports</h3><span>${lib.readings.length} titles</span></div>
    <div class="lib-grid">${lib.readings.map(r => `
      <article class="book ${r.url ? '' : 'nolink'}">
        ${r.meta ? `<div class="by">${esc(r.meta)}</div>` : ''}
        <h3>${esc(r.title)}</h3>
        ${r.desc ? `<p>${esc(r.desc)}</p>` : ''}
        <div class="foot">${r.url ? `<a class="btn small" href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">Open ↗</a>${r.next ? `<span class="next">${esc(r.next)}</span>` : ''}` : `<span>No link yet. Add one in Admin → Library.</span>`}</div>
      </article>`).join('')}</div>
    <div class="section-title" style="margin-top:30px"><h3>Trackers &amp; leaderboards</h3><span>live data on the source site</span></div>
    <div class="feed">${lib.trackers.map(t => `<div class="tracker"><b>${esc(t.title)}</b><span>${esc(t.desc)}</span><a class="btn small" href="${esc(safeUrl(t.url))}" target="_blank" rel="noopener">Open ↗</a></div>`).join('') || '<div class="empty">No trackers yet.</div>'}</div>`;
}

/* ---------------- reader ---------------- */
let readerItem = null;
function openReader(id) {
  const it = ITEMS.find(i => i.id === id); if (!it) return;
  readerItem = it;
  if (!readIds.has(id)) { readIds.add(id); store.set('read', [...readIds].slice(-3000)); }
  const words = new Set((it.title.toLowerCase().match(/[a-z]{5,}/g) || []).filter(w => !['about', 'their', 'there', 'which', 'would', 'could', 'after', 'model', 'models'].includes(w)));
  const related = ITEMS.filter(o => o.id !== id).map(o => {
    let s = 0; o.countries.forEach(c => { if (it.countries.includes(c)) s += 1.5; });
    (o.title.toLowerCase().match(/[a-z]{5,}/g) || []).forEach(w => { if (words.has(w)) s += 1; });
    if (o.cats.some(c => it.cats.includes(c))) s += .5;
    if (Math.abs(o.t - it.t) < 3 * DAY) s += .5;
    return [s, o];
  }).filter(x => x[0] >= 2.5).sort((a, b) => b[0] - a[0]).slice(0, 4).map(x => x[1]);
  $('#reader').innerHTML = `
    <div class="reader-top">${catLabel(it.cats[0])}<button class="btn small x" id="r-close" aria-label="Close">Close <kbd>esc</kbd></button></div>
    <div class="reader-body">
      <h2>${esc(it.title)}</h2>
      ${it.preview ? `<p class="pv">${esc(it.preview)}</p>` : `<p class="note">The source didn't include a summary. Open the original to read it.</p>`}
      <div class="btn-row">
        <a class="btn primary" href="${esc(safeUrl(it.url))}" target="_blank" rel="noopener">Open original ↗</a>
        <button class="btn" id="r-star">${starIds.has(it.id) ? 'Saved' : 'Save'}</button>
        <button class="btn" id="r-unread">Mark unread</button>
      </div>
      <dl class="kv">
        <dt>Source</dt><dd>${esc(it.src.name)} · ${esc(it.type)}</dd>
        <dt>Published</dt><dd>${new Date(it.t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</dd>
        <dt>Categories</dt><dd>${it.cats.map(k => catLabel(k)).join(' &nbsp; ')}</dd>
        ${it.countries.length ? `<dt>Countries</dt><dd>${it.countries.map(esc).join(', ')}</dd>` : ''}
        ${focusHits(it).length ? `<dt>Your focus</dt><dd>${focusHits(it).map(k => `<span class="tag focus">${esc(k)}</span>`).join(' ')}</dd>` : ''}
      </dl>
      ${related.length ? `<div><div class="eyebrow">Related coverage</div><div class="related">${related.map(o => `<button data-open="${esc(o.id)}">${esc(o.title)}<span>${esc(o.src.name)} · ${rel(o.t)}</span></button>`).join('')}</div></div>` : ''}
    </div>`;
  $('#reader').classList.add('on'); $('#scrim').classList.add('on');
  renderNav();
  $$(`[data-id="${CSS.escape(id)}"]`).forEach(el => el.classList.add('read'));
}
function closeReader() { $('#reader').classList.remove('on'); if (!$('#palette').classList.contains('on')) $('#scrim').classList.remove('on'); readerItem = null; }

/* ---------------- palette ---------------- */
let palIdx = 0, palRes = [];
function openPalette() { $('#palette').classList.add('on'); $('#scrim').classList.add('on'); const i = $('#pal-input'); i.value = ''; renderPalette(''); setTimeout(() => i.focus(), 20); }
function closePalette() { $('#palette').classList.remove('on'); if (!readerItem) $('#scrim').classList.remove('on'); }
function renderPalette(q) {
  q = q.trim().toLowerCase();
  const cats = CFG.categories.filter(c => !q || c.name.toLowerCase().includes(q) || c.short.toLowerCase().includes(q)).slice(0, q ? 5 : 12).map(c => ({ kind: 'Categories', label: c.name, hint: 'category', go: () => go('cat', c.key) }));
  const views = [['Briefing', 'brief'], ['World map', 'world'], ['Library', 'lib'], ['Saved', 'saved'], ['Admin panel', 'admin']].filter(([l]) => !q || l.toLowerCase().includes(q)).map(([l, k]) => ({ kind: 'Go to', label: l, hint: 'page', go: () => go(k) }));
  const items = q ? ITEMS.filter(i => (i.title + ' ' + i.src.name + ' ' + (i.preview || '')).toLowerCase().includes(q)).slice(0, 10).map(i => ({ kind: 'Headlines', label: i.title, hint: i.src.name, go: () => openReader(i.id) })) : [];
  const srcs = q ? CFG.sources.filter(s => s.name.toLowerCase().includes(q) && (s.cats || []).length).slice(0, 5).map(s => ({ kind: 'Sources', label: s.name, hint: catBy(s.cats[0]).short, go: () => { go('cat', s.cats[0]); state.src = s.id; render(); } })) : [];
  palRes = [...items, ...srcs, ...cats, ...views]; palIdx = 0;
  let html = '', last = '';
  palRes.forEach((r, n) => { if (r.kind !== last) { html += `<div class="pal-group">${esc(r.kind)}</div>`; last = r.kind; } html += `<button class="pal-item ${n === 0 ? 'act' : ''}" data-pal="${n}"><span>${esc(r.label)}</span><small>${esc(r.hint)}</small></button>`; });
  $('#pal-list').innerHTML = html || '<div class="empty">No matches.</div>';
}
function palMove(d) { const els = $$('.pal-item'); if (!els.length) return; palIdx = (palIdx + d + els.length) % els.length; els.forEach((e, n) => e.classList.toggle('act', n === palIdx)); els[palIdx].scrollIntoView({ block: 'nearest' }); }
function palGo(n) { const r = palRes[n]; if (!r) return; closePalette(); r.go(); }

/* ================= ADMIN ================= */
const A = { authed: false, token: null, draft: null, sha: null, dirty: 0, tab: 'sources', q: '', f: 'all', editing: null, busy: false };
const API = `https://api.github.com/repos/${SITE_CONFIG.owner}/${SITE_CONFIG.repo}`;
const METHODS = { feed: 'Feed', substack: 'Substack (rss2json)', scrape: 'Scraper', arxiv: 'arXiv query', watch: 'Watch page', auto: 'Auto-detect' };
const TYPES = ['Newsletter', 'News', 'Official', 'Think tank', 'Research', 'Tracker', 'Lab', 'Industry', 'Podcast'];

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function gh(path, opts = {}) {
  return fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${A.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}
const b64decode = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
const b64encode = s => { const bytes = new TextEncoder().encode(s); let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b)); return btoa(bin); };

async function loadDraft() {
  const r = await gh(`/contents/${SITE_CONFIG.sourcesPath}?ref=${SITE_CONFIG.branch}`);
  if (!r.ok) throw new Error(`GitHub returned ${r.status} while reading the source list`);
  const j = await r.json();
  A.draft = JSON.parse(b64decode(j.content));
  A.sha = j.sha; A.dirty = 0; A.editing = null;
}
async function saveDraft() {
  if (A.busy) return;
  A.busy = true; renderAdmin();
  try {
    const body = { message: `admin: update sources and settings (${A.dirty} change${A.dirty === 1 ? '' : 's'})`, content: b64encode(JSON.stringify(A.draft, null, 2) + '\n'), sha: A.sha, branch: SITE_CONFIG.branch };
    const r = await gh(`/contents/${SITE_CONFIG.sourcesPath}`, { method: 'PUT', body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) { toast('The source list changed on GitHub since you opened it. Reloaded the latest version; make your edits again.', 5000); await loadDraft(); return; }
    if (!r.ok) throw new Error(`GitHub returned ${r.status}. Check that the token has Contents: read and write.`);
    A.sha = (await r.json()).content.sha;
    A.dirty = 0;
    CFG = JSON.parse(JSON.stringify(A.draft));
    hydrate(RAW_ITEMS);
    toast('Saved. The live site updates in about a minute; new sources are fetched on the next run.', 5000);
  } catch (e) {
    toast('Save failed: ' + e.message, 6000);
  } finally {
    A.busy = false; render();
  }
}
async function dispatch(file, label) {
  try {
    const r = await gh(`/actions/workflows/${file}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: SITE_CONFIG.branch }) });
    if (r.status === 204) return toast(`${label} started. It takes a minute or two.`, 4000);
    if (r.status === 403 || r.status === 404) return toast('The token needs Actions: read and write permission for this.', 5000);
    toast(`GitHub returned ${r.status}.`);
  } catch (e) { toast('Could not reach GitHub: ' + e.message); }
}
function touch(msg) { A.dirty++; if (msg) toast(msg + ' (not saved yet)', 1800); renderAdmin(); }
function detectMethod(url) {
  const u = (url || '').trim();
  if (!u) return null;
  if (/^cat:|^all:|^ti:|^abs:/i.test(u)) return ['arxiv', 'arXiv search query. Papers come from the arXiv API.'];
  if (!/^https?:\/\//i.test(u)) return ['error', 'Start the address with https://'];
  if (/\.substack\.com/i.test(u)) return ['substack', 'Substack blocks GitHub\'s servers, so this is read through rss2json.'];
  if (/(\/feed\/?$|\/rss|\.xml(\?|$)|\.rss$|\.atom|atom\.xml|feeds?\.)/i.test(u)) return ['feed', 'Looks like a feed address. It will be read directly.'];
  return ['auto', 'The next run looks for a feed on this page. If there is none, the page is watched for changes instead.'];
}
function normalizeSubstack(u) { return /\.substack\.com/i.test(u) && !/\/feed\/?$/i.test(u) ? u.replace(/\/+$/, '') + '/feed' : u; }
function newId(name) {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'source', id = base, n = 2;
  while (A.draft.sources.some(s => s.id === id)) id = base + '-' + n++;
  return id;
}
function statusPill(s) {
  const h = HEALTH[s.id];
  if (s.active === false) return '<span class="pill off"><i></i>Paused</span>';
  if (!h) return '<span class="pill warn"><i></i>Not fetched yet</span>';
  if (h.status === 'error') return '<span class="pill err"><i></i>Failing</span>';
  if (h.status === 'warn') return '<span class="pill warn"><i></i>No items</span>';
  return '<span class="pill ok"><i></i>Healthy</span>';
}
function healthNote(s) {
  const h = HEALTH[s.id]; if (!h) return '';
  if (h.error) return esc(h.error);
  if (h.resolved) return 'Detected: ' + esc(METHODS[h.resolved.method] || h.resolved.method);
  return '';
}
function lastPost(s) {
  if (s.method === 'watch' || HEALTH[s.id]?.resolved?.method === 'watch') { const w = watchInfo(s); return esc(w.label); }
  const it = RAW_ITEMS.find(i => i.source === s.id);
  return it ? rel(Date.parse(it.published)) : '—';
}
const catChecks = (sel, attr) => A.draft.categories.map(c => `<button type="button" class="chip" data-${attr}="${esc(c.key)}" aria-pressed="${sel.includes(c.key)}">${esc(c.short)}</button>`).join('');

function renderGate() {
  $('#view').innerHTML = `
    <form class="gate" id="gate">
      <div class="eyebrow">Restricted</div>
      <h2>Admin panel</h2>
      <p class="note">Changes are saved to the GitHub repository. Use a fine-grained token for <b>${esc(SITE_CONFIG.owner)}/${esc(SITE_CONFIG.repo)}</b> with Contents: read and write, and Actions: read and write for the refresh buttons. It's kept in this tab only.</p>
      <div class="field"><label for="g-pw">Password</label><input class="inp" id="g-pw" type="password" autocomplete="current-password" required></div>
      <div class="field"><label for="g-tok">GitHub token</label><input class="inp" id="g-tok" type="password" autocomplete="off" required></div>
      <p class="err-text" id="g-err" hidden></p>
      <button class="btn primary" type="submit">Unlock</button>
    </form>`;
}
async function tryLogin(pw, token) {
  const err = $('#g-err');
  const show = m => { if (err) { err.textContent = m; err.hidden = false; } };
  if (await sha256(pw) !== SITE_CONFIG.passwordHashSHA256) return show('That password is not right.');
  A.token = token.trim();
  try {
    const r = await gh('');
    if (!r.ok) throw new Error();
    const repo = await r.json();
    if (repo.permissions && !repo.permissions.push) return show('This token can read the repository but not change it. Give it Contents: read and write.');
    await loadDraft();
  } catch (e) {
    A.token = null;
    return show('GitHub did not accept that token for this repository.');
  }
  session.set('tok', A.token);
  A.authed = true;
  renderAdmin();
}

function renderAdmin() {
  if (!A.authed) return renderGate();
  const D = A.draft;
  const tabs = [['sources', 'Sources'], ['add', 'Add sources'], ['cats', 'Categories'], ['email', 'Email alerts'], ['focus', 'Priorities'], ['lib', 'Library']];
  let body = '';
  if (A.tab === 'sources') {
    const q = A.q.toLowerCase();
    const st = s => { const h = HEALTH[s.id]; return s.active === false ? 'off' : !h ? 'new' : h.status; };
    const rows = D.sources.map((s, i) => [s, i]).filter(([s]) =>
      (!q || (s.name + ' ' + s.url).toLowerCase().includes(q)) &&
      (A.f === 'all' || (A.f === 'problems' ? ['error', 'warn', 'new'].includes(st(s)) : A.f === 'off' ? s.active === false : s.method === A.f)));
    const count = k => D.sources.filter(s => st(s) === k).length;
    body = `
      <div class="stats">
        <div class="stat"><b class="num">${D.sources.length}</b><span>Sources</span></div>
        <div class="stat"><b class="num" style="color:var(--ok)">${count('ok')}</b><span>Healthy</span></div>
        <div class="stat"><b class="num" style="color:var(--warn)">${count('warn') + count('new')}</b><span>Need a look</span></div>
        <div class="stat"><b class="num" style="color:var(--err)">${count('error')}</b><span>Failing</span></div>
      </div>
      <div class="filters">
        <input class="inp" id="a-q" placeholder="Filter by name or address" value="${esc(A.q)}" style="max-width:260px">
        ${[['all', 'All'], ['problems', 'Problems'], ['feed', 'Feeds'], ['substack', 'Substack'], ['watch', 'Watched pages'], ['scrape', 'Scraped'], ['off', 'Paused']].map(([k, l]) => `<button class="chip" data-af="${k}" aria-pressed="${A.f === k}">${l}</button>`).join('')}
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Source</th><th>Categories</th><th>Method</th><th>Status</th><th>Latest</th><th>On</th><th></th></tr></thead>
        <tbody>${rows.map(([s, i]) => `<tr>
          <td>${esc(s.name)}<span class="sub"><a class="linkish" href="${esc(safeUrl(s.home || s.url))}" target="_blank" rel="noopener">${esc((s.home || s.url || s.query || '').replace(/^https?:\/\/(www\.)?/, '').slice(0, 42))}</a> · ${esc(s.type)}</span></td>
          <td><div class="catchips">${(s.cats || []).map(k => `<span class="catchip">${esc(D.categories.find(c => c.key === k)?.short || k)}</span>`).join('') || '<span class="sub" style="margin:0">none</span>'}</div></td>
          <td>${esc(METHODS[s.method] || s.method)}</td>
          <td>${statusPill(s)}${healthNote(s) ? `<span class="sub">${healthNote(s)}</span>` : ''}</td>
          <td class="num">${lastPost(s)}</td>
          <td><button class="switch" role="switch" data-toggle="${i}" aria-checked="${s.active !== false}" aria-label="Fetch ${esc(s.name)}"></button></td>
          <td><button class="btn small" data-edit="${i}">${A.editing === i ? 'Close' : 'Edit'}</button></td>
        </tr>${A.editing === i ? editRow(s, i) : ''}`).join('')}</tbody>
      </table></div>
      <div class="btn-row" style="margin-top:14px"><button class="btn" id="run-fetch">Refresh all sources now</button></div>`;
  } else if (A.tab === 'add') {
    body = `<div class="two-col">
      <form class="card" id="add-form">
        <h3>Add one source</h3>
        <div class="field"><label for="n-name">Name</label><input class="inp" id="n-name" placeholder="e.g. Rising Tide (Helen Toner)" required></div>
        <div class="field"><label for="n-url">Web address, feed address or arXiv query</label><input class="inp" id="n-url" placeholder="https://helentoner.substack.com" required></div>
        <div class="detect" id="detect"><span>Paste an address to see how it will be read.</span></div>
        <div class="field"><label>Categories</label><div class="checks">${catChecks([], 'pick')}</div></div>
        <div class="field"><label for="n-type">Type</label><select class="inp" id="n-type">${TYPES.map(t => `<option>${t}</option>`).join('')}</select></div>
        <div class="btn-row"><button class="btn primary" type="submit">Add source</button></div>
      </form>
      <div class="card">
        <h3>Bulk import</h3>
        <p class="note">One source per line: a name, then a dash or tab, then the address. You can paste straight from your index document.</p>
        <textarea class="inp" id="bulk" placeholder="Rising Tide — https://helentoner.substack.com&#10;SIPRI — https://www.sipri.org"></textarea>
        <div class="field"><label for="bulk-cat">Add all to</label><select class="inp" id="bulk-cat">${D.categories.map(c => `<option value="${esc(c.key)}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="bulk-type">Type</label><select class="inp" id="bulk-type">${TYPES.map(t => `<option>${t}</option>`).join('')}</select></div>
        <div class="btn-row"><button class="btn primary" type="button" id="bulk-go">Add these</button></div>
      </div>
    </div>`;
  } else if (A.tab === 'cats') {
    body = `<div class="card" style="padding:0;gap:0">
      ${D.categories.map((c, i) => `<div class="cat-row">
        <div class="mv"><button data-up="${i}" aria-label="Move up">▲</button><button data-down="${i}" aria-label="Move down">▼</button></div>
        <input type="color" value="${esc(c.color)}" data-color="${i}" aria-label="Colour for ${esc(c.short)}">
        <div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:8px"><input class="inp" value="${esc(c.name)}" data-rename="${i}" aria-label="Full name"><input class="inp" value="${esc(c.short)}" data-short="${i}" aria-label="Short name"></div>
        <span class="mono num" style="font-size:12px;color:var(--faint)">${D.sources.filter(s => (s.cats || []).includes(c.key)).length} sources</span>
        <button class="btn small" data-delcat="${i}">Remove</button>
      </div>`).join('')}
    </div>
    <form class="filters" id="cat-add" style="margin-top:14px"><input class="inp" id="cat-new" placeholder="New category name" style="max-width:320px" required><button class="btn primary" type="submit">Add category</button></form>
    <p class="note">Removing a category takes it off its sources. Sources left with no category stop appearing until you give them one.</p>`;
  } else if (A.tab === 'email') {
    const al = D.settings.alerts;
    body = `<div class="card" style="max-width:720px">
      <h3>Email alerts</h3>
      <p class="note">Every 2.5 hours (00:00, 02:30, 05:00 … UTC), new items in the chosen categories are emailed, grouped by category. No email is sent when nothing is new. The recipient address is stored as a GitHub secret, not on this site.</p>
      <label class="toggle-row"><button type="button" class="switch" role="switch" id="al-on" aria-checked="${al.enabled !== false}"></button><span>Send email alerts</span></label>
      <div class="field"><label>Categories to include</label><div class="checks">${catChecks(al.categories || [], 'ecat')}</div></div>
      <label class="toggle-row"><button type="button" class="switch" role="switch" id="al-focus" aria-checked="${!!al.focus_only}"></button><span>Only items that match my focus keywords</span></label>
      <div class="btn-row"><button class="btn" id="run-alert">Send alert now</button></div>
    </div>`;
  } else if (A.tab === 'focus') {
    body = `<div class="card" style="max-width:720px">
      <h3>Focus keywords</h3>
      <p class="note">Items that mention these rise to the top of the Briefing and get an amber tag. Short all-caps words like LAWS only match as whole words.</p>
      <div class="kw">${D.settings.focus_keywords.map((k, i) => `<span>${esc(k)}<button data-delkw="${i}" aria-label="Remove ${esc(k)}">×</button></span>`).join('')}</div>
      <form class="filters" id="kw-add"><input class="inp" id="kw-new" placeholder="Add a keyword, e.g. OEWG" style="max-width:280px" required><button class="btn primary" type="submit">Add</button></form>
    </div>`;
  } else if (A.tab === 'lib') {
    const L = D.library;
    body = `<div class="section-title"><h3>Readings &amp; reports</h3><span>title · address · note</span></div>
    <div class="card" style="padding:0;gap:0">${L.readings.map((r, i) => `<div class="lib-edit">
      <input class="inp" value="${esc(r.title)}" data-lib="readings.${i}.title" aria-label="Title">
      <input class="inp" value="${esc(r.url)}" data-lib="readings.${i}.url" placeholder="https://" aria-label="Address">
      <input class="inp" value="${esc(r.meta)}" data-lib="readings.${i}.meta" placeholder="Publisher" aria-label="Publisher">
      <button class="btn small" data-dellib="readings.${i}">Remove</button></div>`).join('')}</div>
    <div class="btn-row" style="margin:10px 0 24px"><button class="btn" data-addlib="readings">Add a reading</button></div>
    <div class="section-title"><h3>Trackers</h3><span>title · address · description</span></div>
    <div class="card" style="padding:0;gap:0">${L.trackers.map((r, i) => `<div class="lib-edit">
      <input class="inp" value="${esc(r.title)}" data-lib="trackers.${i}.title" aria-label="Title">
      <input class="inp" value="${esc(r.url)}" data-lib="trackers.${i}.url" placeholder="https://" aria-label="Address">
      <input class="inp" value="${esc(r.desc)}" data-lib="trackers.${i}.desc" aria-label="Description">
      <button class="btn small" data-dellib="trackers.${i}">Remove</button></div>`).join('')}</div>
    <div class="btn-row" style="margin-top:10px"><button class="btn" data-addlib="trackers">Add a tracker</button></div>`;
  }
  $('#view').innerHTML = `
    <div class="view-head"><div><div class="eyebrow">Admin</div><h2>Sources &amp; settings</h2>
    <p class="lede">Edits stay here until you save. Saving commits the source list to GitHub; the live site updates about a minute later.</p></div>
    <button class="btn" id="lock">Lock</button></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${A.tab === k}">${l}</button>`).join('')}</div>
    ${body}
    ${A.dirty ? `<div class="savebar"><span><b>${A.dirty} unsaved change${A.dirty === 1 ? '' : 's'}</b></span><button class="btn" id="discard">Discard</button><button class="btn primary" id="save" ${A.busy ? 'disabled' : ''}>${A.busy ? 'Saving…' : 'Save to site'}</button></div>` : ''}`;
}
function editRow(s, i) {
  return `<tr class="edit-row"><td colspan="7"><form class="edit-grid" data-editform="${i}">
    <div class="field"><label>Name</label><input class="inp" name="name" value="${esc(s.name)}" required></div>
    <div class="field"><label>Method</label><select class="inp" name="method">${Object.entries(METHODS).map(([k, l]) => `<option value="${k}" ${s.method === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field wide"><label>${s.method === 'arxiv' ? 'arXiv query' : 'Address fetched'}</label><input class="inp" name="${s.method === 'arxiv' ? 'query' : 'url'}" value="${esc(s.method === 'arxiv' ? s.query : s.url)}"></div>
    <div class="field wide"><label>Link shown on the site</label><input class="inp" name="home" value="${esc(s.home || '')}" placeholder="https://"></div>
    <div class="field"><label>Type</label><select class="inp" name="type">${TYPES.map(t => `<option ${s.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="field"><label>Country (optional)</label><input class="inp" name="country" value="${esc(s.country || '')}"></div>
    <div class="field wide"><label>Only keep items mentioning (comma separated, optional)</label><input class="inp" name="filter" value="${esc((s.filter || []).join(', '))}"></div>
    <div class="field wide"><label>Categories</label><div class="checks">${catChecks(s.cats || [], 'ecats')}</div></div>
    <div class="btn-row wide"><button class="btn primary" type="submit">Apply</button><button class="btn" type="button" data-delsrc="${i}">Delete source</button></div>
  </form></td></tr>`;
}

/* ---------------- routing ---------------- */
const VIEWS = { brief: renderBrief, cat: renderCat, world: renderWorld, lib: renderLib, saved: renderSaved, admin: renderAdmin };
function go(view, cat) {
  if (state.view === 'admin' && view !== 'admin' && A.dirty) toast('You have unsaved admin changes. They stay until you save or discard them.', 3500);
  state.view = view; state.sel = -1;
  if (view === 'cat') { if (state.cat !== cat) { state.type = 'All'; state.src = null; } state.cat = cat; }
  const hash = view === 'cat' ? 'cat-' + cat : view === 'brief' ? '' : view;
  try { history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search); } catch (e) {}
  $('#rail').classList.remove('on');
  closeReader();
  render();
  window.scrollTo({ top: 0 });
}
function render() { renderNav(); VIEWS[state.view](); }
function select(n) {
  const els = $$('.row, .top-item');
  if (!els.length) return;
  state.sel = Math.max(0, Math.min(els.length - 1, n));
  els.forEach((e, i) => e.classList.toggle('sel', i === state.sel));
  els[state.sel].scrollIntoView({ block: 'nearest' });
}
function selectedId() { const el = $$('.row, .top-item')[state.sel]; return el ? el.dataset.id : null; }
function toggleStar(id) {
  starIds.has(id) ? starIds.delete(id) : starIds.add(id);
  store.set('stars', [...starIds]);
  $$(`[data-star="${CSS.escape(id)}"]`).forEach(b => b.setAttribute('aria-pressed', String(starIds.has(id))));
  toast(starIds.has(id) ? 'Saved to your reading list' : 'Removed from saved');
  renderNav();
}
function fromHash() {
  const h = location.hash.replace('#', '');
  if (h.startsWith('cat-') && CFG.categories.some(c => c.key === h.slice(4))) { state.view = 'cat'; state.cat = h.slice(4); }
  else if (VIEWS[h]) state.view = h;
}

/* ---------------- events ---------------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button, [data-id], .mdot, a');
  if (!t || t.matches('a')) return;
  const d = t.dataset;
  if (d.view) return go(d.view);
  if (d.cat && !t.closest('form')) return go('cat', d.cat);
  if (d.star) { e.stopPropagation(); return toggleStar(d.star); }
  if (d.open) return openReader(d.open);
  if (d.pal) return palGo(+d.pal);
  if (d.r !== undefined) { state.range = +d.r; store.set('range', state.range); return render(); }
  if (d.type) { state.type = d.type; return render(); }
  if (d.src !== undefined) { state.src = d.src || null; return render(); }
  if (d.country) { state.country = state.country === d.country ? null : d.country; return render(); }
  if (t.id === 'r-close') return closeReader();
  if (t.id === 'r-star' && readerItem) { toggleStar(readerItem.id); t.textContent = starIds.has(readerItem.id) ? 'Saved' : 'Save'; return; }
  if (t.id === 'r-unread' && readerItem) { readIds.delete(readerItem.id); store.set('read', [...readIds]); toast('Marked unread'); closeReader(); return render(); }
  if (t.id === 'search-btn') return openPalette();
  if (t.id === 'menu-btn') { $('#rail').classList.add('on'); $('#scrim').classList.add('on'); return; }
  if (d.id !== undefined && t.matches('.row, .top-item')) return openReader(d.id);
  // admin
  const D = A.draft;
  if (d.tab) { A.tab = d.tab; A.editing = null; return renderAdmin(); }
  if (d.af) { A.f = d.af; return renderAdmin(); }
  if (d.toggle) { const s = D.sources[+d.toggle]; s.active = s.active === false; return touch(`${s.name} ${s.active ? 'switched on' : 'paused'}`); }
  if (d.edit) { A.editing = A.editing === +d.edit ? null : +d.edit; return renderAdmin(); }
  if (d.pick || d.ecats) { t.setAttribute('aria-pressed', String(t.getAttribute('aria-pressed') !== 'true')); return; }
  if (d.delsrc) { if (!t.dataset.confirm) { t.dataset.confirm = '1'; t.textContent = 'Click again to delete'; t.classList.add('primary'); return; } const s = D.sources.splice(+d.delsrc, 1)[0]; A.editing = null; return touch(`Deleted ${s.name}`); }
  if (d.up || d.down) { const i = +(d.up ?? d.down), j = d.up !== undefined ? i - 1 : i + 1; if (j < 0 || j >= D.categories.length) return; [D.categories[i], D.categories[j]] = [D.categories[j], D.categories[i]]; return touch(); }
  if (d.delcat) {
    if (!t.dataset.confirm) { t.dataset.confirm = '1'; t.textContent = 'Confirm'; t.classList.add('primary'); return; }
    const c = D.categories.splice(+d.delcat, 1)[0];
    D.sources.forEach(s => s.cats = (s.cats || []).filter(k => k !== c.key));
    D.settings.alerts.categories = (D.settings.alerts.categories || []).filter(k => k !== c.key);
    return touch(`Removed ${c.short}`);
  }
  if (d.delkw) { D.settings.focus_keywords.splice(+d.delkw, 1); return touch(); }
  if (d.ecat) { const al = D.settings.alerts; al.categories = (al.categories || []).includes(d.ecat) ? al.categories.filter(k => k !== d.ecat) : [...(al.categories || []), d.ecat]; return touch(); }
  if (d.dellib) { const [k, i] = d.dellib.split('.'); D.library[k].splice(+i, 1); return touch(); }
  if (d.addlib) { D.library[d.addlib].push(d.addlib === 'readings' ? { title: 'New reading', meta: '', desc: '', url: '', next: '' } : { title: 'New tracker', desc: '', url: '' }); return touch(); }
  if (t.id === 'al-on') { D.settings.alerts.enabled = D.settings.alerts.enabled === false; return touch(D.settings.alerts.enabled ? 'Alerts on' : 'Alerts off'); }
  if (t.id === 'al-focus') { D.settings.alerts.focus_only = !D.settings.alerts.focus_only; return touch(); }
  if (t.id === 'run-fetch') return dispatch(SITE_CONFIG.workflowFile, 'Refresh');
  if (t.id === 'run-alert') return dispatch(SITE_CONFIG.alertsWorkflowFile, 'Alert email');
  if (t.id === 'save') return saveDraft();
  if (t.id === 'discard') { loadDraft().then(() => { toast('Changes discarded'); renderAdmin(); }).catch(e => toast(e.message)); return; }
  if (t.id === 'lock') { if (A.dirty && !t.dataset.confirm) { t.dataset.confirm = '1'; t.textContent = 'Lock and lose changes'; return; } Object.assign(A, { authed: false, token: null, draft: null, dirty: 0 }); session.set('tok', null); return renderAdmin(); }
  if (t.id === 'bulk-go') {
    const lines = $('#bulk').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const m = l.match(/^(.*?)\s*(?:[—–|\t]|\s-\s|,)\s*(https?:\/\/\S+)\s*$/) || l.match(/^(https?:\/\/\S+)$/);
      return m ? (m[2] ? [m[1].trim(), m[2]] : [m[1].replace(/^https?:\/\/(www\.)?/, '').split('/')[0], m[1]]) : null;
    });
    const good = lines.filter(Boolean), bad = lines.length - good.length;
    if (!good.length) return toast('No lines had a name and an https:// address.');
    const cat = $('#bulk-cat').value, type = $('#bulk-type').value;
    let added = 0;
    good.forEach(([name, url]) => {
      if (D.sources.some(s => s.url === url || s.home === url)) return;
      const m = detectMethod(url);
      D.sources.push({ id: newId(name), name, method: m[0], url: normalizeSubstack(url), home: url, cats: [cat], type, active: true });
      added++;
    });
    A.tab = 'sources'; A.f = 'problems';
    return touch(`${added} added${bad ? `, ${bad} lines skipped` : ''}${good.length - added ? `, ${good.length - added} already listed` : ''}`);
  }
});
$('#scrim').addEventListener('click', () => { closePalette(); closeReader(); $('#rail').classList.remove('on'); $('#scrim').classList.remove('on'); });
document.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, D = A.draft;
  if (f.id === 'gate') return tryLogin($('#g-pw').value, $('#g-tok').value);
  if (f.id === 'add-form') {
    const name = $('#n-name').value.trim(), url = $('#n-url').value.trim();
    const cats = $$('[data-pick][aria-pressed="true"]').map(b => b.dataset.pick);
    const m = detectMethod(url);
    if (!m || m[0] === 'error') return toast('Enter an address starting with https://, or an arXiv query like cat:cs.AI');
    if (!cats.length) return toast('Pick at least one category');
    const src = { id: newId(name), name, method: m[0], url: m[0] === 'arxiv' ? '' : normalizeSubstack(url), home: m[0] === 'arxiv' ? 'https://arxiv.org' : url, cats, type: $('#n-type').value, active: true };
    if (m[0] === 'arxiv') src.query = url;
    D.sources.unshift(src);
    A.tab = 'sources'; A.f = 'all'; A.q = '';
    return touch(`${name} added`);
  }
  if (f.dataset.editform !== undefined) {
    const s = D.sources[+f.dataset.editform], fd = new FormData(f);
    s.name = fd.get('name').trim() || s.name;
    s.method = fd.get('method');
    if (fd.has('query')) s.query = fd.get('query').trim(); else s.url = fd.get('url').trim();
    s.home = fd.get('home').trim();
    s.type = fd.get('type');
    const country = fd.get('country').trim(); if (country) s.country = country; else delete s.country;
    const filter = fd.get('filter').split(',').map(x => x.trim()).filter(Boolean); if (filter.length) s.filter = filter; else delete s.filter;
    s.cats = $$('[data-ecats][aria-pressed="true"]').map(b => b.dataset.ecats);
    A.editing = null;
    return touch(`${s.name} updated`);
  }
  if (f.id === 'cat-add') {
    const n = $('#cat-new').value.trim(); if (!n) return;
    let key = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 20).replace(/-$/, '') || 'cat';
    while (D.categories.some(c => c.key === key)) key += '-2';
    D.categories.push({ key, short: n.split(/[ ,&]/)[0], name: n, color: '#9AA3B5' });
    D.settings.alerts.categories = [...(D.settings.alerts.categories || []), key];
    return touch(`Added ${n}`);
  }
  if (f.id === 'kw-add') { const n = $('#kw-new').value.trim(); if (!n || D.settings.focus_keywords.includes(n)) return; D.settings.focus_keywords.push(n); return touch(); }
});
document.addEventListener('change', e => {
  const t = e.target, D = A.draft; if (!D) return;
  if (t.dataset.rename !== undefined) { D.categories[+t.dataset.rename].name = t.value.trim() || D.categories[+t.dataset.rename].name; return touch(); }
  if (t.dataset.short !== undefined) { D.categories[+t.dataset.short].short = t.value.trim() || D.categories[+t.dataset.short].short; return touch(); }
  if (t.dataset.color !== undefined) { D.categories[+t.dataset.color].color = t.value; return touch(); }
  if (t.dataset.lib) { const [k, i, field] = t.dataset.lib.split('.'); D.library[k][+i][field] = t.value.trim(); return touch(); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'pal-input') return renderPalette(t.value);
  if (t.id === 'n-url') { const m = detectMethod(t.value); $('#detect').innerHTML = m ? `<span><b>${esc(m[0] === 'error' ? 'Check the address' : METHODS[m[0]])}</b><br>${esc(m[1])}</span>` : '<span>Paste an address to see how it will be read.</span>'; return; }
  if (t.id === 'a-q') { A.q = t.value; const pos = t.selectionStart; renderAdmin(); const n = $('#a-q'); n.focus(); n.setSelectionRange(pos, pos); }
});
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if ($('#palette').classList.contains('on')) {
    if (e.key === 'Escape') return closePalette();
    if (e.key === 'ArrowDown') { e.preventDefault(); return palMove(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); return palMove(-1); }
    if (e.key === 'Enter') { e.preventDefault(); return palGo(palIdx); }
    return;
  }
  if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); return openPalette(); }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') { closeReader(); $('#rail').classList.remove('on'); $('#scrim').classList.remove('on'); return; }
  if (state.view === 'admin') return;
  if (e.key === 'j') return select(state.sel + 1);
  if (e.key === 'k') return select(state.sel - 1);
  if ((e.key === 'o' || e.key === 'Enter') && state.sel >= 0) { const id = selectedId(); if (id) openReader(id); return; }
  if (e.key === 's') { const id = readerItem ? readerItem.id : selectedId(); if (id) toggleStar(id); return; }
  if (e.key === 'm') { const id = readerItem ? readerItem.id : selectedId(); if (!id) return; readIds.has(id) ? readIds.delete(id) : readIds.add(id); store.set('read', [...readIds]); toast(readIds.has(id) ? 'Marked read' : 'Marked unread'); closeReader(); render(); }
});
window.addEventListener('beforeunload', e => { if (A.dirty) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('hashchange', () => { fromHash(); render(); });

/* ---------------- start ---------------- */
async function init() {
  try {
    CFG = await loadJSON('data/sources.json');
  } catch (e) {
    $('#view').innerHTML = '<div class="empty">Could not load the source list (data/sources.json). Try reloading the page.</div>';
    return;
  }
  const [items, watch, health, sums] = await Promise.all([
    loadJSON('data/items.json', { items: [] }), loadJSON('data/watch.json', {}),
    loadJSON('data/health.json', { sources: {} }), loadJSON('data/summaries.json', {}),
  ]);
  RAW_ITEMS = items.items || []; UPDATED = items.updated; WATCH = watch; HEALTH = health.sources || {}; SUMMARIES = sums;
  hydrate(RAW_ITEMS);
  fromHash();
  const tok = session.get('tok');
  if (tok) { A.token = tok; loadDraft().then(() => { A.authed = true; if (state.view === 'admin') renderAdmin(); }).catch(() => session.set('tok', null)); }
  render();
}
init();
})();
