{
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store = {get(k){try{return localStorage.getItem(k)}catch{return null}}, set(k,v){try{localStorage.setItem(k,v)}catch{}}};

let people = [], items = [], loaded = false, busy = 0;
let me = store.get('wishlist.me') || '';
// A personal link (/?link=<secret>) signs this device in as one person, and works only once, so a forwarded copy can't.
// It stands in for the passcode too. The page's script uses it up, not loading the page, so a chat app's link preview can't.
let linkToken = new URLSearchParams(location.search).get('link') || '';
let linkNote = '';
function dropLink() { linkToken = ''; history.replaceState(null, '', location.pathname + location.hash); }
let code = store.get('wishlist.code') || '';
let editing = null;
let saves = 0; // counts saves, so a refresh that started before one doesn't draw old lists over it
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
  if (!r.ok) throw Object.assign(new Error(j.error || "That didn't save."), { status: r.status });
  return j;
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

// people is null when the lists couldn't load because this device has no passcode yet. Says whether it signed in.
async function useLink(people) {
  // A device that already knows who it is leaves the link alone, so it still works for the person it was meant for.
  const current = people && people.find(p => p.id === me);
  if (current) { dropLink(); showErr(`This device is already signed in as ${current.name}, so the personal link wasn't used. Not ${current.name}? Tap "Switch" at the top.`); return false; }
  const t = linkToken; linkToken = ''; // cleared first, so two overlapping refreshes can't both use it
  try {
    const r = await api('POST', `/api/links/${encodeURIComponent(t)}`);
    me = r.personId; store.set('wishlist.me', me);
    if (r.code) { code = r.code; store.set('wishlist.code', code); }
    dropLink();
    return true;
  } catch (e) {
    if (e.status === 410) { dropLink(); linkNote = "That personal link was already used, so it can't sign anyone in. Tap your name below, or ask for a new link."; }
    else { linkNote = "Couldn't check your personal link just now. Reload the page to try again, or tap your name below."; } // the link stays in the address bar for the reload
    return false;
  }
}

async function refresh() {
  const before = saves;
  try {
    const data = (await api('GET', '/api/data')).data;
    if (saves !== before) return; // a save finished meanwhile and already drew newer lists
    if (linkToken) await useLink(data.people);
    apply(data);
  }
  catch (e) {
    if (e instanceof AuthError) {
      if (linkToken && await useLink(null)) return refresh(); // the link brought the passcode with it
      askCode(!!code);
    }
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
const svgLink = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';

const nameOf = id => (people.find(p => p.id === id) || {}).name;

function render() {
  if (!loaded) return;
  if (me && !nameOf(me)) { me = ''; store.set('wishlist.me', ''); }
  $('meBar').hidden = !me;
  if (me) { $('meName').textContent = nameOf(me); $('meChange').textContent = `Not ${nameOf(me)}? Switch`; }
  else askWho();

  const grid = $('grid');
  if (!people.length) { $('hint').textContent = ''; grid.innerHTML = ''; return; }
  const total = items.length;
  $('hint').textContent = `${people.length} ${people.length === 1 ? 'list' : 'lists'} · ${total} ${total === 1 ? 'wish' : 'wishes'}${me ? ' · your list is first' : ''}`;

  const keep = focusKey();
  const ordered = [...people].sort((a, b) => (b.id === me) - (a.id === me) || a.name.localeCompare(b.name));
  grid.innerHTML = ordered.map(p => {
    const mine = p.id === me;
    const its = items.filter(i => i.personId === p.id).sort((a, b) => mine ? sortBy(a, b) : ((a.purchased ? 1 : 0) - (b.purchased ? 1 : 0)) || sortBy(a, b));
    const left = its.filter(i => !i.purchased).length;
    const count = its.length === 0 ? 'No wishes yet' : mine ? `${its.length} ${its.length === 1 ? 'wish' : 'wishes'}` : `${left} of ${its.length} still available`;
    const list = its.length ? `<ul>${its.map(i => itemHTML(i, mine)).join('')}</ul>` : `<div class="empty">${mine ? "Add a few things you'd love." : 'Nothing here yet. Give them a nudge!'}</div>`;
    return `<section class="card${mine ? ' mine' : ''}" data-person="${esc(p.id)}">
      <div class="chead"><div class="who"><h2>${esc(p.name)}${mine ? ' (you)' : ''}</h2><span class="count">${count}</span></div>
        <div class="tools"><button class="icon" type="button" data-act="link-person" title="Personal link for ${esc(p.name)}" aria-label="Personal link for ${esc(p.name)}">${svgLink}</button><button class="icon" type="button" data-act="edit-person" title="Rename ${esc(p.name)}" aria-label="Rename ${esc(p.name)}">${svgPen}</button><button class="icon" type="button" data-act="del-person" title="Remove ${esc(p.name)}" aria-label="Remove ${esc(p.name)}">${svgBin}</button></div>
      </div>
      ${mine ? "<div class=\"mynote\">This is your list, so we're keeping purchases a surprise.</div>" : ''}
      ${list}
      <div class="cfoot"><button class="add" type="button" data-act="add-item">+ Add a wish${mine ? '' : ' for ' + esc(p.name)}</button></div>
    </section>`;
  }).join('') + '<button class="add-card" type="button" data-act="add-person">+ Add a person</button>';
  refocus(keep);
}

// Redrawing replaces the buttons, so put keyboard focus back on the same button (or the nearest one left).
function focusKey() {
  const f = document.activeElement;
  if (!f || !$('grid').contains(f)) return null;
  const li = f.closest('[data-item]'), card = f.closest('[data-person]');
  return { act: f.dataset.act, item: li && li.dataset.item, person: card && card.dataset.person };
}
function refocus(k) {
  if (!k) return;
  const box = (k.item && document.querySelector(`[data-item="${CSS.escape(k.item)}"]`)) || (k.person && document.querySelector(`[data-person="${CSS.escape(k.person)}"]`));
  const el = box && (box.querySelector(`[data-act="${k.act}"]`) || box.querySelector('a, button'));
  if (el) el.focus();
}

function itemHTML(i, mine) {
  const url = safeUrl(i.url);
  const taken = i.purchased && !mine;
  const title = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a>` : esc(i.title);
  const meta = [i.notes ? esc(i.notes) : '', url ? esc(host(url)) : ''].filter(Boolean).join(' · ');
  let act;
  const edit = `<button class="icon" type="button" data-act="edit-item" title="Edit" aria-label="Edit ${esc(i.title)}">${svgPen}</button>`;
  if (mine) act = edit + `<button class="icon" type="button" data-act="del-item" title="Remove" aria-label="Remove ${esc(i.title)}">${svgBin}</button>`;
  else if (taken) act = `<span class="ribbon">★ Someone's got this</span><button class="link" type="button" data-act="unbuy">Undo</button>`;
  else act = `<button class="buy" type="button" data-act="buy">I bought this</button>` + edit;
  return `<li class="item${taken ? ' taken' : ''}" data-item="${esc(i.id)}"><div class="it-body"><div class="it-title">${title}</div>${meta ? `<div class="it-meta">${meta}</div>` : ''}</div><div class="it-act">${act}</div></li>`;
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

/* ---------- who are you? ---------- */

// Covers the whole screen until this device knows who it is. Every choice is confirmed, so a slip of the finger can't sign you in as someone else.
let chosen = null; // { id } for someone on the list, { name } for someone new
function askWho() {
  const d = $('dlgWho');
  if (d.open) return;
  $('whoPicks').innerHTML = [...people].sort((a, b) => a.name.localeCompare(b.name)).map(p => `<button type="button" data-pick="${esc(p.id)}">${esc(p.name)}</button>`).join('');
  $('whoPicks').hidden = !people.length;
  $('joinLabel').textContent = people.length ? 'Not on the list? Write your name' : 'Write your name to start the family lists';
  $('whoBack').hidden = !me;
  $('whoBack').textContent = `Go back, I'm ${nameOf(me)}`;
  $('joinName').value = '';
  $('whoNote').textContent = linkNote; linkNote = '';
  d.showModal();
  whoStep(false);
}
// Focus goes to the title, not a button, so no name looks already picked and a held-down Enter can't press "Yes".
function whoStep(sure) { $('whoPick').hidden = sure; $('whoSure').hidden = !sure; $(sure ? 'sTitle' : 'wTitle').focus(); }
function confirmWho(c) {
  chosen = c;
  const p = c.id && people.find(x => x.id === c.id);
  $('sTitle').textContent = p ? `You're ${p.name}?` : `Join as ${c.name}?`;
  $('sBody').textContent = p ? `From now on this device will show the lists as ${p.name}, and hide what's been bought for ${p.name}.` : `We'll start a new list for ${c.name}. If you're already on the list, go back and tap your name instead.`;
  whoStep(true);
}
$('whoPicks').addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) confirmWho({ id: b.dataset.pick }); });
$('fJoin').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('joinName').value.trim(); if (!name) return;
  const same = people.find(p => p.name.trim().toLowerCase() === name.toLowerCase());
  confirmWho(same ? { id: same.id } : { name });
});
$('sNo').addEventListener('click', () => whoStep(false));
$('whoBack').addEventListener('click', () => $('dlgWho').close());
$('sYes').addEventListener('click', async () => {
  const yes = $('sYes');
  if (yes.disabled) return; // a second tap or Enter while saving would add the person twice
  yes.disabled = true;
  let id = chosen.id;
  if (!id) { const r = await write('POST', '/api/people', { name: chosen.name }); id = r && r.id; }
  yes.disabled = false;
  if (!id) { $('whoNote').textContent = $('status').textContent; return whoStep(false); } // the page's own message is hidden behind this screen
  $('dlgWho').close();
  setMe(id);
});
// Escape can't skip it. If the browser closes it anyway, open it again.
$('dlgWho').addEventListener('cancel', e => { if (!me) e.preventDefault(); });
$('dlgWho').addEventListener('close', () => { if (!me) setTimeout(askWho); });
$('meChange').addEventListener('click', askWho);
function setMe(id) { me = id; store.set('wishlist.me', id); render(); }

// The personal link for someone: send it to them and their device knows who they are straight away.
async function openLink(p) {
  const r = await write('POST', `/api/people/${encodeURIComponent(p.id)}/link`);
  if (!r) return;
  $('lTitle').textContent = `${p.name}'s personal link`;
  $('lBody').textContent = `Send this to ${p.name} only. It works once: the first phone or tablet to open it is signed in as ${p.name}, and then the link stops working. They won't need the family passcode.`;
  $('lUrl').value = `${location.origin}/?link=${encodeURIComponent(r.link)}`;
  $('lCopy').textContent = 'Copy link';
  $('dlgLink').showModal();
}
$('lCopy').addEventListener('click', () => {
  navigator.clipboard.writeText($('lUrl').value).then(() => { $('lCopy').textContent = 'Copied!'; }, () => { $('lUrl').select(); $('lCopy').textContent = 'Select it and copy'; });
});

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
  else write('POST', '/api/people', { name });
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
// Cancel in the forms is a plain button, so pressing Enter (or Go on a phone keyboard) saves instead of cancelling.
for (const b of document.querySelectorAll('dialog button[type=button][value=cancel]')) b.addEventListener('click', () => b.closest('dialog').close('cancel'));

document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  const card = b.closest('[data-person]'), pid = card && card.dataset.person;
  const li = b.closest('[data-item]'), iid = li && li.dataset.item;
  const p = people.find(x => x.id === pid), it = items.find(x => x.id === iid);
  if (act === 'add-person') openPerson(null);
  else if (act === 'edit-person' && p) openPerson(p);
  else if (act === 'link-person' && p) openLink(p);
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

refresh();
// Pick up other people's changes every 15 seconds while the page is open and visible.
setInterval(() => { if (!busy && !document.hidden && !document.querySelector('dialog[open]')) refresh(); }, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !busy && !document.querySelector('dialog[open]')) refresh(); });
}
