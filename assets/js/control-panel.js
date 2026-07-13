// Control Panel — AI Developments Dashboard
//
// SECURITY MODEL (read this before deploying):
// This is a static site — there is no server to keep secrets on.
// Two layers gate access:
//   1. A password, checked client-side against a SHA-256 hash (deters casual
//      visitors, but anyone who reads this file's source can see the hash).
//   2. A GitHub Personal Access Token (fine-grained, repo-scoped, YOUR account)
//      that you paste in each session. This is the layer that actually
//      matters: without a valid token, no write can reach the repo. The
//      token lives only in sessionStorage (cleared when the tab closes) and
//      is never written to a file or committed.
// For real protection beyond "keeps out casual visitors," put this page
// behind GitHub Pages + a Cloudflare Access rule, or move source-editing to
// a private repo you access via `git`/GitHub's own UI instead of a public
// control panel. This setup is a convenience layer, not a security boundary.

// ---- CONFIG: fill these in after you create your repo ----
const CONFIG = {
  owner: 'YOUR_GITHUB_USERNAME',
  repo: 'ai-dev-dashboard',
  branch: 'main',
  sourcesPath: 'data/sources.json',
  // Generate with: echo -n "yourpassword" | shasum -a 256
  passwordHashSHA256: 'REPLACE_WITH_YOUR_PASSWORD_HASH',
};
// ------------------------------------------------------------

let githubToken = null;
let sourcesCache = null;
let sourcesSha = null;

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function attemptLogin() {
  const pw = document.getElementById('pw').value;
  const pat = document.getElementById('pat').value.trim();
  const errEl = document.getElementById('auth-error');
  errEl.textContent = '';

  if (!pat) {
    errEl.textContent = 'GitHub token is required.';
    return;
  }
  const hash = await sha256(pw);
  if (hash !== CONFIG.passwordHashSHA256) {
    errEl.textContent = 'Incorrect password.';
    return;
  }

  // Verify the token actually works before unlocking the UI
  try {
    const res = await fetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}`, {
      headers: { Authorization: `Bearer ${pat}` }
    });
    if (!res.ok) throw new Error('Token rejected by GitHub');
  } catch (e) {
    errEl.textContent = 'GitHub token could not be verified. Check scope/repo access.';
    return;
  }

  githubToken = pat;
  sessionStorage.setItem('gh_pat', pat);
  document.getElementById('auth-gate').style.display = 'none';
  document.getElementById('panel-header').style.display = 'flex';
  document.getElementById('panel-main').style.display = 'block';
  loadSources();
}

async function ghGet(path) {
  const res = await fetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}?ref=${CONFIG.branch}`, {
    headers: { Authorization: `Bearer ${githubToken}` }
  });
  if (!res.ok) throw new Error('Failed to fetch ' + path);
  const json = await res.json();
  const content = decodeURIComponent(escape(atob(json.content)));
  return { data: JSON.parse(content), sha: json.sha };
}

async function ghPut(path, dataObj, sha, message) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(dataObj, null, 2))));
  const res = await fetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${githubToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message, content, sha, branch: CONFIG.branch })
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error('GitHub write failed: ' + errBody);
  }
  return res.json();
}

async function loadSources() {
  try {
    const { data, sha } = await ghGet(CONFIG.sourcesPath);
    sourcesCache = data;
    sourcesSha = sha;
    renderCategories();
  } catch (e) {
    showToast('Failed to load sources.json — ' + e.message);
  }
}

function renderCategories() {
  const container = document.getElementById('categories');
  let html = '';
  for (const [key, cfg] of Object.entries(sourcesCache.categories)) {
    html += `
      <div class="category-block">
        <h3>${escapeHtml(cfg.label)} <span class="cat-type">${escapeHtml(cfg.type)}</span></h3>
        <div id="rows-${key}">
          ${cfg.sources.map(s => renderSourceRow(key, s)).join('')}
        </div>
        <div class="add-row">
          <input type="text" id="new-name-${key}" placeholder="Source name">
          <input type="text" id="new-url-${key}" placeholder="${cfg.type === 'x_api' ? 'X handle (no @)' : cfg.type === 'arxiv' ? 'arXiv query e.g. cat:cs.AI' : 'Feed URL'}">
          <button class="btn" onclick="addSource('${key}')">Add</button>
        </div>
      </div>`;
  }
  container.innerHTML = html;
}

function renderSourceRow(catKey, source) {
  const urlField = source.url || source.handle || source.query || '';
  return `
    <div class="source-row" data-id="${source.id}">
      <span>${escapeHtml(source.name)}</span>
      <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;">${escapeHtml(urlField)}</span>
      <label style="font-family:var(--font-mono);font-size:10px;color:var(--text-secondary);display:flex;align-items:center;gap:4px;">
        <input type="checkbox" ${source.active ? 'checked' : ''} onchange="toggleSource('${catKey}','${source.id}', this.checked)"> active
      </label>
      <button class="btn secondary" style="width:auto;padding:6px 10px;font-size:11px;" onclick="removeSource('${catKey}','${source.id}')">Remove</button>
    </div>`;
}

function toggleSource(catKey, id, active) {
  const src = sourcesCache.categories[catKey].sources.find(s => s.id === id);
  if (src) src.active = active;
  persistSources('Toggle source ' + id);
}

function removeSource(catKey, id) {
  const cat = sourcesCache.categories[catKey];
  cat.sources = cat.sources.filter(s => s.id !== id);
  renderCategories();
  persistSources('Remove source ' + id);
}

function addSource(catKey) {
  const nameEl = document.getElementById(`new-name-${catKey}`);
  const urlEl = document.getElementById(`new-url-${catKey}`);
  const name = nameEl.value.trim();
  const val = urlEl.value.trim();
  if (!name || !val) {
    showToast('Enter both a name and a value.');
    return;
  }
  const cat = sourcesCache.categories[catKey];
  const id = 'src_' + Math.random().toString(36).slice(2, 8);
  const entry = { id, name, active: true };
  if (cat.type === 'x_api') entry.handle = val;
  else if (cat.type === 'arxiv') entry.query = val;
  else entry.url = val;

  cat.sources.push(entry);
  nameEl.value = '';
  urlEl.value = '';
  renderCategories();
  persistSources('Add source ' + name);
}

async function persistSources(message) {
  try {
    const result = await ghPut(CONFIG.sourcesPath, sourcesCache, sourcesSha, `control-panel: ${message}`);
    sourcesSha = result.content.sha;
    showToast('Saved to repo.');
  } catch (e) {
    showToast('Save failed — ' + e.message);
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Auto-resume session if token still present (tab refresh, not new tab)
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pw').addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); });
  document.getElementById('pat').addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); });
});
