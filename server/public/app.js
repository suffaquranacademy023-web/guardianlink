'use strict';
const $ = (id) => document.getElementById(id);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
let tokens = JSON.parse(store.get('gl_tokens') || 'null'), mode = 'login', selected = null;

function toast(m) { const t = $('toast'); t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2500); }
function el(tag, props = {}, ...kids) { const e = document.createElement(tag); Object.assign(e, props); kids.forEach((k) => e.append(k)); return e; }
const fmt = (ts) => (ts ? new Date(ts).toLocaleString() : 'never');

async function api(method, path, body, retry = true) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(tokens ? { Authorization: 'Bearer ' + tokens.accessToken } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && tokens && retry && !path.startsWith('/auth/')) {
    const rr = await fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: tokens.refreshToken }) });
    if (rr.ok) { setTokens(await rr.json()); return api(method, path, body, false); }
    setTokens(null); render(); throw new Error('Session expired');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
function setTokens(t) { tokens = t; store.set('gl_tokens', t ? JSON.stringify(t) : null); }

function setMode(m) { mode = m; $('tabLogin').classList.toggle('on', m === 'login'); $('tabReg').classList.toggle('on', m === 'reg'); $('famRow').hidden = m !== 'reg'; $('authSubmit').textContent = m === 'login' ? 'Sign in' : 'Create account'; $('password').autocomplete = m === 'login' ? 'current-password' : 'new-password'; $('authMsg').textContent = ''; }
$('tabLogin').onclick = () => setMode('login'); $('tabReg').onclick = () => setMode('reg');
$('authForm').onsubmit = async (e) => {
  e.preventDefault(); $('authMsg').textContent = ''; $('authSubmit').disabled = true;
  try {
    const body = { email: $('email').value, password: $('password').value };
    if (mode === 'reg') body.familyName = $('famName').value;
    setTokens(await api('POST', mode === 'login' ? '/auth/login' : '/auth/register', body));
    $('password').value = ''; render();
  } catch (err) { $('authMsg').textContent = err.message; } finally { $('authSubmit').disabled = false; }
};
$('logoutBtn').onclick = async () => { try { await api('POST', '/auth/logout', { refreshToken: tokens.refreshToken }); } catch {} setTokens(null); render(); };
$('themeBtn').onclick = () => { const r = document.documentElement; const n = (r.dataset.theme || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark'; r.dataset.theme = n; store.set('gl_theme', n); };
if (store.get('gl_theme')) document.documentElement.dataset.theme = store.get('gl_theme');

$('pairBtn').onclick = async () => { try { const r = await api('POST', '/pairing-codes'); $('pairCode').textContent = r.code; $('pairBox').hidden = false; } catch (e) { toast(e.message); } };

async function loadDash() {
  const me = await api('GET', '/me'); $('famTitle').textContent = me.family.name;
  const { devices } = await api('GET', '/devices'); const box = $('devices'); box.replaceChildren();
  if (!devices.length) box.append(el('p', { textContent: 'No devices yet. Click “Add a device”.' }));
  for (const d of devices) {
    const card = el('div', { className: 'card dev' + (d.revokedAt ? ' rev' : '') },
      el('strong', { textContent: d.name }),
      el('div', { className: 'meta', textContent: `${d.platform} · ${d.revokedAt ? 'access revoked' : 'last seen ' + fmt(d.lastSeen)}${d.battery != null ? ' · ' + d.battery + '%' : ''}` }));
    if (!d.revokedAt) {
      const acts = el('div', { className: 'acts' },
        el('button', { textContent: 'Details', onclick: () => showDetail(d) }),
        el('button', { textContent: 'Lock', onclick: async () => { try { await api('POST', `/devices/${d.id}/commands`, { type: 'lock' }); toast('Lock requested'); } catch (e) { toast(e.message); } } }),
        el('button', { className: 'danger', textContent: 'Revoke', onclick: async () => { if (confirm(`Remove ${d.name} from your family?`)) { await api('DELETE', `/devices/${d.id}`); loadDash(); } } }));
      card.append(acts);
    }
    box.append(card);
  }
  const { geofences } = await api('GET', '/geofences'); const gl = $('gfList'); gl.replaceChildren();
  for (const g of geofences) gl.append(el('li', { textContent: `${g.name} — ${g.lat}, ${g.lng} (${g.radius} m) ` }, el('button', { className: 'ghost danger', textContent: 'Delete', onclick: async () => { await api('DELETE', `/geofences/${g.id}`); loadDash(); } })));
  const { events } = await api('GET', '/audit'); const al = $('audit'); al.replaceChildren();
  for (const ev of events.slice(0, 30)) al.append(el('li', { textContent: `${fmt(ev.ts)} — ${ev.action.replaceAll('_', ' ')} (${ev.actor})` }));
  if (selected) { const d = devices.find((x) => x.id === selected.id); if (d && !d.revokedAt) showDetail(d); else $('detail').hidden = true; }
}
async function showDetail(d) {
  selected = d; $('detail').hidden = false; $('detailTitle').textContent = d.name;
  const [{ locations }, { usage }] = await Promise.all([api('GET', `/devices/${d.id}/locations`), api('GET', `/devices/${d.id}/usage`)]);
  $('locs').replaceChildren(...(locations.length ? locations.slice(0, 10).map((l) => el('li', { textContent: `${fmt(l.ts)} — ${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}` })) : [el('li', { textContent: 'No locations yet' })]));
  $('usage').replaceChildren(...(usage.length ? usage.slice(0, 15).map((u) => el('li', { textContent: `${u.day} ${u.package}: ${Math.round(u.seconds / 60)} min` })) : [el('li', { textContent: 'No usage yet' })]));
}
$('gfForm').onsubmit = async (e) => { e.preventDefault(); try { await api('POST', '/geofences', { name: $('gfName').value, lat: +$('gfLat').value, lng: +$('gfLng').value, radius: +$('gfRad').value }); e.target.reset(); loadDash(); } catch (er) { toast(er.message); } };

function render() {
  const authed = !!tokens; $('landing').hidden = authed; $('dash').hidden = !authed; $('logoutBtn').hidden = !authed;
  if (authed) loadDash().catch((e) => toast(e.message));
}
render(); setInterval(() => { if (tokens) loadDash().catch(() => {}); }, 30000);
