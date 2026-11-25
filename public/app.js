{
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {get(k){try{return localStorage.getItem(k)}catch{return null}}, set(k,v){try{localStorage.setItem(k,v)}catch{}}};

let people = [], items = [], loaded = false, busy = 0;
let me = store.get('wishlist.me') || '';
let code = store.get('wishlist.code') || '';
let editing = null;
let saves = 0; // counts saves, so a refresh that started before one doesn't draw old lists over it
let askedWho = false;
let askingCode = false;

/* ---------- talking to the server ---------- */

class AuthError extends Error {}
async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Family-Code': code },
    body: body ? JSON.stringify(body) : undefined
  });
  let j = {};
  try { j = await r.json(); } catch {}
  if (r.status === 401) throw new AuthError(j.error || 'Passcode needed.');
  if (!r.ok) throw new Error(j.error || "That didn't save.");
  return j;
}

// garland baubles
{
  const cols = ['#c8102e','#f2c14e','#ffffff','#2f8f63'];
  let g = '';
  for (let i = 0; i < 16; i++) {
    const x = 37 + i * 75, t = (x % 300) / 300, y = 6 + 34 * Math.sin(Math.PI * t) * 0.5 + 2;
    g += `<line x1="${x}" y1="${y - 4}" x2="${x}" y2="${y + 4}" stroke="#2f6b4f" stroke-width="2"/><circle cx="${x}" cy="${y + 11}" r="7" fill="${cols[i % 4]}"/><circle cx="${x - 2}" cy="${y + 9}" r="2" fill="rgba(255,255,255,.6)"/>`;
  }
  $('baubles').innerHTML = g;
}

function safeUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  if (/^http:\/\//i.test(u)) u = 'https://' + u.slice(7);
  if (!/^[a-z]+:/i.test(u)) u = 'https://' + u;
  return /^https:\/\/[^\s]+$/i.test(u) ? u : '';
}
function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'link'; } }
function showErr(msg) { $('status').textContent = msg || ''; }

function apply(data) {
  people = data.people || []; items = data.items || []; loaded = true;
  render();
}

// Send a change to the server, then redraw with the fresh lists it returns.
async function write(method, path, body) {
  showErr(''); busy++; saves++; document.body.classList.add('busy');
  try {
    const r = await api(method, path, body);
    if (r && r.data) apply(r.data);
    return r;
  } catch (e) {
    if (e instanceof AuthError) { showErr("That change wasn't saved because the passcode is needed. Enter it, then try again."); askCode(true); }
    else { showErr(e.message + ' Please try again.'); refresh(); }
  } finally {
    busy--; if (!busy) document.body.classList.remove('busy');
  }
}

async function refresh() {
  const before = saves;
  try {
    const data = (await api('GET', '/api/data')).data;
    if (saves !== before) return; // a save finished meanwhile and already drew newer lists
    apply(data); askWho();
  }
  catch (e) {
    if (e instanceof AuthError) askCode(!!code);
    else if (!loaded) $('hint').textContent = "Couldn't reach the lists. Check your connection and reload the page.";
  }
}

/* ---------- passcode ---------- */

function askCode(wasWrong) {
  if (askingCode) return;
  askingCode = true;
  $('hint').textContent = '';
  $('codeMsg').textContent = wasWrong ? "That passcode didn't work. Check with whoever sent you the link." : 'Enter the family passcode to see the lists. You only need to do this once on this device.';
  const d = $('dlgCode');
  $('codeIn').value = '';
  d.returnValue = '';
  d.addEventListener('close', () => {
    askingCode = false;
    if (d.returnValue === 'ok') { code = $('codeIn').value.trim(); store.set('wishlist.code', code); refresh(); }
    else if (!loaded) $('hint').textContent = 'The lists are locked. Reload the page to enter the passcode.';
  }, { once: true });
  d.showModal();
}

/* ---------- drawing ---------- */

const sortBy = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);
const svgPen = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const svgBin = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';

function render() {
  const sel = $('meSel');
  if (me && loaded && !people.some(p => p.id === me)) { me = ''; store.set('wishlist.me', ''); }
  sel.innerHTML = '<option value="">Just browsing</option>' + people.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  sel.value = me;

  const grid = $('grid');
  if (!loaded) return;
  if (!people.length) {
    $('hint').textContent = '';
    grid.style.display = 'block';
    grid.innerHTML = `<div class="welcome"><h2>Let's get the lists going</h2><p>Start by adding each person in the family. Then everyone can add their own wishes.</p><button class="primary" type="button" data-act="add-person">Add the first person</button></div>`;
    return;
  }
  grid.style.display = '';
  const total = items.length;
  $('hint').textContent = `${people.length} ${people.length === 1 ? 'list' : 'lists'} · ${total} ${total === 1 ? 'wish' : 'wishes'}${me ? ' · your list is first' : ''}`;

  const ordered = [...people].sort((a, b) => (b.id === me) - (a.id === me) || a.name.localeCompare(b.name));
  grid.innerHTML = ordered.map(p => {
    const mine = p.id === me;
    const its = items.filter(i => i.personId === p.id).sort((a, b) => mine ? sortBy(a, b) : ((a.purchased ? 1 : 0) - (b.purchased ? 1 : 0)) || sortBy(a, b));
    const left = its.filter(i => !i.purchased).length;
    const count = its.length === 0 ? 'No wishes yet' : mine ? `${its.length} ${its.length === 1 ? 'wish' : 'wishes'}` : `${left} of ${its.length} still available`;
    const list = its.length ? `<ul>${its.map(i => itemHTML(i, mine)).join('')}</ul>` : `<div class="empty">${mine ? "Add a few things you'd love." : 'Nothing here yet. Give them a nudge!'}</div>`;
    return `<section class="card${mine ? ' mine' : ''}" data-person="${esc(p.id)}">
      <div class="chead"><div class="tag" aria-hidden="true">${esc((p.name || '?').trim().charAt(0).toUpperCase())}</div>
        <div><h2>${esc(p.name)}${mine ? ' (you)' : ''}</h2><div class="count">${count}</div></div>
        <div class="tools"><button class="icon" type="button" data-act="edit-person" title="Rename" aria-label="Rename ${esc(p.name)}">${svgPen}</button><button class="icon" type="button" data-act="del-person" title="Remove person" aria-label="Remove ${esc(p.name)}">${svgBin}</button></div>
      </div>
      ${mine ? "<div class=\"mynote\">This is your list, so we're keeping purchases a surprise.</div>" : ''}
      ${list}
      <div class="cfoot"><button class="add" type="button" data-act="add-item">+ Add a wish${mine ? '' : ' for ' + esc(p.name)}</button></div>
    </section>`;
  }).join('');
}

function itemHTML(i, mine) {
  const url = safeUrl(i.url);
  const taken = i.purchased && !mine;
  const title = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a>` : esc(i.title);
  const meta = [i.notes ? esc(i.notes) : '', url ? esc(host(url)) : ''].filter(Boolean).join(' · ');
  let act;
  if (mine) act = `<button class="link" type="button" data-act="edit-item">Edit</button><button class="link" type="button" data-act="del-item">Remove</button>`;
  else if (taken) act = `<span class="ribbon">★ Someone's got this</span><button class="link" type="button" data-act="unbuy">Undo</button>`;
  else act = `<button class="buy" type="button" data-act="buy">I bought this</button><button class="link" type="button" data-act="edit-item">Edit</button>`;
  return `<li class="item${taken ? ' taken' : ''}" data-item="${esc(i.id)}"><div class="it-title">${title}</div>${meta ? `<div class="it-meta">${meta}</div>` : ''}<div class="it-act">${act}</div></li>`;
}

/* ---------- dialogs ---------- */

function confirmBox(title, body, okText) {
  return new Promise(res => {
    const d = $('dlgConfirm');
    $('cTitle').textContent = title; $('cBody').textContent = body; $('cOk').textContent = okText;
    d.returnValue = '';
    d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true });
    d.showModal();
  });
}

function askWho() {
  if (askedWho || me || !people.length) return;
  askedWho = true;
  if (store.get('wishlist.asked') === '1') return;
  $('whoPicks').innerHTML = [...people].sort((a, b) => a.name.localeCompare(b.name)).map(p => `<button value="${esc(p.id)}">${esc(p.name)}</button>`).join('');
  const d = $('dlgWho');
  d.returnValue = '';
  d.addEventListener('close', () => { store.set('wishlist.asked', '1'); setMe(d.returnValue || ''); }, { once: true });
  d.showModal();
}
function setMe(id) { me = id; store.set('wishlist.me', id); render(); }
$('meSel').addEventListener('change', e => setMe(e.target.value));

function openPerson(p) {
  editing = { kind: 'person', id: p ? p.id : null };
  $('pTitle').textContent = p ? 'Rename' : 'Add a person';
  $('pName').value = p ? p.name : '';
  $('dlgPerson').returnValue = '';
  $('dlgPerson').showModal();
}
function openItem(personId, it) {
  const p = people.find(x => x.id === personId);
  editing = { kind: 'item', id: it ? it.id : null, personId };
  $('iTitle').textContent = it ? 'Edit wish' : (personId === me ? 'Add a wish' : `Add a wish for ${p ? p.name : ''}`);
  $('iName').value = it ? it.title : ''; $('iUrl').value = it ? it.url || '' : '';
  $('iNotes').value = it ? it.notes || '' : '';
  checkUrl();
  $('dlgItem').returnValue = '';
  $('dlgItem').showModal();
}

$('dlgPerson').addEventListener('close', async () => {
  if ($('dlgPerson').returnValue !== 'ok') return;
  const name = $('pName').value.trim(); if (!name) return;
  const e = editing;
  if (e.id) write('PATCH', `/api/people/${encodeURIComponent(e.id)}`, { name });
  else {
    const first = !me && !people.length;
    const r = await write('POST', '/api/people', { name });
    if (r && r.id && first) setMe(r.id);
  }
});
$('dlgItem').addEventListener('close', async () => {
  if ($('dlgItem').returnValue !== 'ok') return;
  const title = $('iName').value.trim(); if (!title) return;
  const url = safeUrl($('iUrl').value);
  const data = { title, url, notes: $('iNotes').value.trim() };
  const e = editing;
  if (e.id) write('PATCH', `/api/items/${encodeURIComponent(e.id)}`, data); else write('POST', '/api/items', { ...data, personId: e.personId });
});
// A link that isn't a web address stops Save with a message on the field, so nothing half-saves.
function checkUrl() {
  const raw = $('iUrl').value.trim();
  $('iUrl').setCustomValidity(raw && !safeUrl(raw) ? "That doesn't look like a web address. Fix it or leave it empty." : '');
}
$('iUrl').addEventListener('input', checkUrl);

$('addPerson').addEventListener('click', () => openPerson(null));
document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  const card = b.closest('[data-person]'), pid = card && card.dataset.person;
  const li = b.closest('[data-item]'), iid = li && li.dataset.item;
  const p = people.find(x => x.id === pid), it = items.find(x => x.id === iid);
  if (act === 'add-person') openPerson(null);
  else if (act === 'edit-person' && p) openPerson(p);
  else if (act === 'del-person' && p) {
    const n = items.filter(i => i.personId === p.id).length;
    if (await confirmBox(`Remove ${p.name}?`, `This deletes ${p.name}'s list${n ? ` and all ${n} ${n === 1 ? 'wish' : 'wishes'} on it` : ''} for everyone. It can't be undone.`, 'Remove'))
      write('DELETE', `/api/people/${encodeURIComponent(p.id)}`);
  }
  else if (act === 'add-item' && p) openItem(p.id, null);
  else if (act === 'edit-item' && it) openItem(it.personId, it);
  else if (act === 'del-item' && it) {
    if (await confirmBox('Remove this wish?', `"${it.title}" will be taken off your list.`, 'Remove')) write('DELETE', `/api/items/${encodeURIComponent(it.id)}`);
  }
  else if (act === 'buy' && it) {
    if (await confirmBox('Mark as bought?', `Everyone else will see "${it.title}" is taken. ${p ? p.name : 'They'} won't see it, and nobody will know it was you.`, 'Yes, I bought it')) {
      const r = await write('POST', `/api/items/${encodeURIComponent(it.id)}/purchased`, { value: true });
      if (r && r.already) showErr(`Heads up: someone else already marked "${it.title}" as bought.`);
    }
  }
  else if (act === 'unbuy' && it) {
    if (await confirmBox('Undo this purchase mark?', 'Only do this if you were the one who marked it, for example if you returned it.', 'Undo'))
      write('POST', `/api/items/${encodeURIComponent(it.id)}/purchased`, { value: false });
  }
});

render();
refresh();
// Pick up other people's changes every 15 seconds while the page is open and visible.
setInterval(() => { if (!busy && !document.hidden && !document.querySelector('dialog[open]')) refresh(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy && !document.querySelector('dialog[open]')) refresh(); });
}
