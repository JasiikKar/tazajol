(() => {
'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CATS = ['road', 'light', 'trash', 'play', 'build', 'other'];
const GLYPH = { new: '!', in_progress: '…', fixed: '✓' };
const DEBUG = /[?&]debug/.test(location.search);
const S = { lang: localStorage.tj_lang || 'ru', tab: 'report', reports: [], sel: null, detail: null, dup: null, pending: null, msg: '', flash: '', filter: 'all',
  token: localStorage.tj_token || '', notes: [], areas: [], offline: false, queueN: 0, draft: { cat: 'road', desc: '', photo: null, lat: null, lng: null, place: '' } };
const T = (k) => (I18N[S.lang] && I18N[S.lang][k]) || I18N.en[k] || k;
let uid = localStorage.tj_uid;
if (!uid) { uid = crypto.randomUUID ? crypto.randomUUID() : 'u' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.tj_uid = uid; }

/* ---------- API client ---------- */
async function api(path, opts = {}) {
  if (S.offline) throw { network: true };
  const headers = Object.assign({ 'X-User-Id': uid }, opts.headers || {});
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  let res;
  try { res = await fetch('/api' + path, Object.assign({}, opts, { headers })); } catch (e) { throw { network: true }; }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, body };
  return body;
}

/* ---------- Outbox pattern (IndexedDB): reports kept on the phone while offline ---------- */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('tazajol', 1); r.onupgradeneeded = () => r.result.createObjectStore('outbox', { keyPath: 'ref' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function ob(mode, fn) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('outbox', mode); const rq = fn(tx.objectStore('outbox')); tx.oncomplete = () => res(rq && rq.result); tx.onerror = () => rej(tx.error); }); }
const obAdd = (it) => ob('readwrite', (s) => s.put(it));
const obAll = () => ob('readonly', (s) => s.getAll());
const obDel = (ref) => ob('readwrite', (s) => s.delete(ref));
async function updateQueue() { try { S.queueN = (await obAll()).length; } catch (e) { S.queueN = 0; } }
function sendReport(it) {
  const f = new FormData();
  f.append('category', it.category); f.append('description', it.description || ''); f.append('lat', it.lat); f.append('lng', it.lng); f.append('ref', it.ref);
  if (it.force) f.append('force', '1');
  if (it.photo) f.append('photo', it.photo, 'photo.jpg');
  return api('/reports', { method: 'POST', body: f });
}
let flushing = false;
async function flush() {
  if (S.offline || navigator.onLine === false || flushing) return;
  flushing = true;
  try {
    for (const it of await obAll()) {
      try { await sendReport(it); await obDel(it.ref); S.flash = T('synced'); }
      catch (e) {
        if (e.network) break;
        if (e.status === 409 && e.body && e.body.code === 'DUPLICATE') { try { await api('/reports/' + e.body.duplicate.id + '/votes', { method: 'POST' }); } catch (_) {} await obDel(it.ref); S.flash = T('merged'); }
        else await obDel(it.ref);
      }
    }
  } finally { flushing = false; await updateQueue(); loadReports(); render(); }
}

/* ---------- Map (Leaflet + OpenStreetMap) ---------- */
const map = L.map('map', { zoomControl: false }).setView([43.45, 77.1], 9);
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
const layer = L.layerGroup().addTo(map);
let draftMarker = null, moveTimer = null;
map.on('moveend', () => { clearTimeout(moveTimer); moveTimer = setTimeout(loadReports, 300); });
map.on('click', (e) => { if (S.tab === 'report') setDraftLoc(e.latlng.lat, e.latlng.lng); });
if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize()).observe($('#mapwrap'));

const visible = () => S.reports.filter((r) => S.filter === 'all' || r.status === S.filter);
function drawMarkers() {
  layer.clearLayers();
  visible().forEach((r) => {
    const icon = L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="pin ${r.status}${r.id === S.sel ? ' sel' : ''}${r.hidden ? ' hid' : ''}">${GLYPH[r.status]}</div>` });
    L.marker([r.lat, r.lng], { icon, keyboard: false, bubblingMouseEvents: false }).on('click', () => select(r.id)).addTo(layer);
  });
}
async function loadReports() {
  try {
    const b = map.getBounds();
    S.reports = await api(`/reports?bbox=${[b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',')}`);
    drawMarkers(); render();
  } catch (e) { /* offline: keep what we have */ }
}
async function select(id) {
  S.sel = id; S.tab = 'list'; $('#sheet').classList.remove('min');
  const r = S.reports.find((x) => x.id === id); if (r) map.panTo([r.lat, r.lng]);
  try { S.detail = await api('/reports/' + id); } catch (e) { S.detail = r || null; }
  drawMarkers(); render();
}
function nearestArea(lat, lng) {
  let best = '', d = 1e9;
  S.areas.forEach((a) => { const x = a.lat - lat, y = (a.lng - lng) * Math.cos(lat * Math.PI / 180), dd = x * x + y * y; if (dd < d) { d = dd; best = a.name; } });
  return best;
}
function setDraftLoc(lat, lng) {
  Object.assign(S.draft, { lat, lng, place: nearestArea(lat, lng) });
  if (draftMarker) draftMarker.setLatLng([lat, lng]); else draftMarker = L.marker([lat, lng], { interactive: false }).addTo(map);
  S.dup = null; S.msg = ''; render();
}

/* ---------- Photo: shrink + re-encode in the browser (also removes EXIF/GPS metadata) ---------- */
async function compress(file) {
  const bmp = await createImageBitmap(file);
  let max = 900, q = 0.6, blob;
  for (let i = 0; i < 5; i++) {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    if (blob.size <= 150 * 1024) break; q = Math.max(0.35, q - 0.08); max -= 100;
  }
  return blob;
}

/* ---------- Actions ---------- */
function resetDraft() { S.draft = { cat: 'road', desc: '', photo: null, lat: null, lng: null, place: '' }; if (draftMarker) { map.removeLayer(draftMarker); draftMarker = null; } S.dup = null; S.pending = null; }
async function submit(force) {
  const d = S.draft;
  if (d.lat == null) { S.msg = T('nol'); render(); return; }
  const item = S.pending || { ref: crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now() + Math.random().toString(36).slice(2), category: d.cat, description: d.desc, lat: d.lat, lng: d.lng, photo: d.photo && d.photo.blob };
  if (force) item.force = true;
  try {
    const r = await sendReport(item);
    S.flash = T('ok'); S.sel = r.id; S.detail = r; map.setView([r.lat, r.lng], Math.max(map.getZoom(), 14)); resetDraft(); S.tab = 'list'; await loadReports();
  } catch (e) {
    if (e.network) { await obAdd(item); await updateQueue(); S.msg = T('queued'); resetDraft(); }
    else if (e.status === 409 && e.body && e.body.code === 'DUPLICATE') { S.pending = item; S.dup = e.body.duplicate; }
    else S.msg = T('err') + ': ' + ((e.body && e.body.code) === 'OUT_OF_REGION' ? T('region') : (e.body && e.body.code) || '');
  }
  render();
}
async function vote(id, fromDup) {
  try { const r = await api(`/reports/${id}/votes`, { method: 'POST' }); if (fromDup) { resetDraft(); S.flash = T('ok'); } S.detail = r.report; S.sel = id; S.tab = 'list'; await loadReports(); } catch (e) { S.msg = T('err'); }
  render();
}
async function setStatus(id, status) {
  if (!status) return;
  try { S.detail = await api(`/reports/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); await loadReports(); }
  catch (e) { S.flash = T('err') + ': ' + ((e.body && e.body.code) || ''); if (e.status === 403) { S.token = ''; localStorage.removeItem('tj_token'); } }
  render();
}
async function hideToggle(id, hide) {
  try { await api(`/reports/${id}/${hide ? 'hide' : 'unhide'}`, { method: 'POST' }); S.detail = await api('/reports/' + id).catch(() => null); if (!S.detail) S.sel = null; await loadReports(); } catch (e) {}
  render();
}
async function adminToggle() {
  if (S.token) { S.token = ''; localStorage.removeItem('tj_token'); await loadReports(); render(); return; }
  const pw = window.prompt(T('pw')); if (!pw) return;
  try { const r = await api('/auth/admin-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) }); S.token = r.token; localStorage.tj_token = r.token; await loadReports(); if (S.sel) S.detail = await api('/reports/' + S.sel).catch(() => null); }
  catch (e) { S.flash = T('badpw'); }
  render();
}
async function loadNotes() { try { S.notes = await api('/notifications'); } catch (e) {} render(); }
async function openNotes() { S.tab = 'notes'; $('#sheet').classList.remove('min'); render(); try { await api('/notifications/read', { method: 'POST' }); } catch (e) {} setTimeout(loadNotes, 800); }

/* ---------- Rendering ---------- */
const badge = (s) => `<span class="b ${s}">${esc(T(s))}</span>`;
const fmt = (d) => new Date(d).toLocaleDateString(S.lang === 'kk' ? 'kk-KZ' : S.lang === 'en' ? 'en-GB' : 'ru-RU');
function viewDetail() {
  const r = S.detail; if (!r) return `<div class="mu" style="padding:6px 0">${T('pick')}</div>`;
  const admin = !!S.token;
  return `<div class="card ${r.hidden ? 'hid' : ''}"><div class="row"><b>${esc(T(r.category))}</b><span class="mu">${esc(r.settlement || '')}</span>${badge(r.status)}${r.hidden ? `<span class="b hid">${T('hiddenb')}</span>` : ''}</div>
  ${r.photoUrl ? `<img class="ph" src="${esc(r.photoUrl)}" alt="">` : ''}<div>${esc(r.description)}</div>
  <div class="mu">${r.votes} ▲ · ${fmt(r.createdAt)}</div>
  <div class="row" style="margin-top:8px"><button class="y" data-act="vote" data-id="${r.id}" ${r.voted ? 'disabled' : ''}>${r.voted ? T('voted') : '▲ ' + T('vote')}</button>
  ${admin ? `<select data-act="status" data-id="${r.id}"><option value="">${esc(T(r.status))}</option>${(r.allowedNext || []).map((s) => `<option value="${s}">→ ${esc(T(s))}</option>`).join('')}</select><button data-act="${r.hidden ? 'unhide' : 'hide'}" data-id="${r.id}">${r.hidden ? T('restore') : T('hide')}</button>` : ''}</div>
  ${r.history ? `<div class="mu" style="margin-top:8px">${T('hist')}: ${r.history.map((h) => esc(T(h.to)) + ' (' + fmt(h.at) + ')').join(' → ')}</div>` : ''}</div>`;
}
function viewList() {
  const chips = ['all', 'new', 'in_progress', 'fixed'].map((k) => `<button class="chip ${S.filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${T(k)}</button>`).join('');
  const rows = [...visible()].sort((a, b) => b.votes - a.votes).map((r) => `<div class="card item ${r.hidden ? 'hid' : ''}" data-act="select" data-id="${r.id}"><div class="row"><b>${esc(T(r.category))}</b><span class="mu">${esc(r.settlement || '')}</span>${badge(r.status)}${r.hidden ? `<span class="b hid">${T('hiddenb')}</span>` : ''}</div><div class="mu">${esc(r.description)} · ${r.votes} ▲</div></div>`).join('');
  return viewDetail() + `<div class="chips">${chips}</div>` + (rows || `<div class="mu">${T('nodata')}</div>`);
}
function viewReport() {
  const d = S.draft;
  return `<div class="f"><div class="mu" style="margin-top:4px">${T('tapOrCenter')}${d.lat != null ? ` · ${esc(d.place)}` : ''}</div>
  <div class="row" style="margin:8px 0"><button class="p" data-act="center">${T('center')}</button><button data-act="gps">${T('loc')}</button></div>
  <label>${T('place')}</label><select data-bind="area"><option value="">—</option>${S.areas.map((a) => `<option ${a.name === d.place && d.lat != null ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
  <label>${T('cat')}</label><select data-bind="cat">${CATS.map((c) => `<option value="${c}" ${c === d.cat ? 'selected' : ''}>${esc(T(c))}</option>`).join('')}</select>
  <label>${T('desc')}</label><textarea rows="2" maxlength="500" data-bind="desc">${esc(d.desc)}</textarea>
  <label>${T('photo')}</label><input type="file" accept="image/*" data-bind="photo">${d.photo ? `<img class="ph" src="${d.photo.url}" alt="">` : ''}
  ${S.dup ? `<div class="warn">${T('same')}<br><b>${esc(T(S.dup.category))}</b> · ${esc(S.dup.description)} · ${S.dup.votes} ▲<div class="row" style="margin-top:8px"><button class="p" data-act="dupyes" data-id="${S.dup.id}">${T('yes')}</button><button data-act="dupno">${T('no')}</button></div></div>` : ''}
  <div class="mu" style="margin:8px 0">${esc(S.msg)}</div><button class="p" data-act="submit" style="width:100%">${T('submit')}</button></div>`;
}
function viewNotes() {
  return `<h3 style="margin:6px 0">${T('notes')}</h3>` + (S.notes.length ? S.notes.map((n) => `<div class="card item" data-act="select" data-id="${n.reportId}">#${n.reportId} ${esc(T(n.category))} — ${T('changed')} ${badge(n.newStatus)} <span class="mu">${fmt(n.createdAt)}</span></div>`).join('') : `<div class="mu">${T('nonotes')}</div>`);
}
function render() {
  document.documentElement.lang = S.lang; $('#lang').value = S.lang;
  $('#adminBtn').textContent = S.token ? T('logout') : T('admin');
  const unread = S.notes.filter((n) => !n.read).length; $('#bellN').hidden = !unread; $('#bellN').textContent = unread;
  $('#tabs').innerHTML = ['report', 'list'].map((k) => `<button class="${S.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${T(k)}</button>`).join('');
  $('#cross').hidden = S.tab !== 'report' || $('#sheet').classList.contains('min');
  const off = S.offline || navigator.onLine === false;
  $('#banner').innerHTML = (off ? `<div>${T('offlineNow')}</div>` : '') + (S.queueN ? `<div>${T('qn')}: ${S.queueN}</div>` : '') + (S.flash ? `<div>${esc(S.flash)}</div>` : '') +
    (DEBUG ? `<label style="margin:2px 0"><input type="checkbox" data-bind="offline" ${S.offline ? 'checked' : ''}> ${T('off')}</label>` : '');
  const keepScroll = $('#panel').scrollTop;
  $('#panel').innerHTML = S.tab === 'report' ? viewReport() : S.tab === 'notes' ? viewNotes() : viewList();
  $('#panel').scrollTop = keepScroll;
}

/* ---------- Events (delegation) ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const id = +el.dataset.id, a = el.dataset.act;
  if (a === 'tab') { S.tab = el.dataset.tab; S.msg = ''; S.flash = ''; $('#sheet').classList.remove('min'); render(); }
  else if (a === 'submit') submit(false);
  else if (a === 'dupno') submit(true);
  else if (a === 'dupyes') vote(id, true);
  else if (a === 'vote') vote(id);
  else if (a === 'hide') hideToggle(id, true);
  else if (a === 'unhide') hideToggle(id, false);
  else if (a === 'select') select(id);
  else if (a === 'filter') { S.filter = el.dataset.f; drawMarkers(); render(); }
  else if (a === 'center') { const c = map.getCenter(); setDraftLoc(c.lat, c.lng); }
  else if (a === 'gps') navigator.geolocation && navigator.geolocation.getCurrentPosition((p) => { setDraftLoc(p.coords.latitude, p.coords.longitude); map.setView([p.coords.latitude, p.coords.longitude], 16); }, () => {});
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.act === 'status') return setStatus(+el.dataset.id, el.value);
  const b = el.dataset.bind; if (!b) return;
  if (b === 'cat') { S.draft.cat = el.value; S.dup = null; S.pending = null; }
  else if (b === 'area') { const a = S.areas.find((x) => x.name === el.value); if (a) { map.setView([a.lat, a.lng], 14); setDraftLoc(a.lat, a.lng); } }
  else if (b === 'offline') { S.offline = el.checked; render(); if (!S.offline) { flush(); loadReports(); } }
  else if (b === 'photo' && el.files[0]) { try { const blob = await compress(el.files[0]); S.draft.photo = { blob, url: URL.createObjectURL(blob) }; render(); } catch (err) { S.msg = T('err'); render(); } }
});
document.addEventListener('input', (e) => { if (e.target.dataset.bind === 'desc') S.draft.desc = e.target.value; });
$('#lang').addEventListener('change', (e) => { S.lang = e.target.value; localStorage.tj_lang = S.lang; render(); });
$('#adminBtn').addEventListener('click', adminToggle);
$('#bell').addEventListener('click', openNotes);
$('#handle').addEventListener('click', () => { $('#sheet').classList.toggle('min'); render(); setTimeout(() => map.invalidateSize(), 50); });
window.addEventListener('online', () => { flush(); render(); });
window.addEventListener('offline', render);

/* ---------- Start ---------- */
(async () => {
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  try { S.areas = await api('/areas'); } catch (e) {}
  await updateQueue(); await loadReports(); loadNotes(); flush();
  setInterval(flush, 30000); setInterval(loadNotes, 60000);
})();
})();
