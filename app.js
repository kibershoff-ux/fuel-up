/* Fuel Up: a friendly food + protein tracker. All data stays on this device. */
(() => {
'use strict';

// ---------- storage ----------
const KEY = 'bt.v1';
const DEFAULT = () => ({
  v: 1,
  settings: { name: 'Brylie', ageY: null, heightCm: null, weightKg: null, soccerDays: 4,
    kcalLo: 1800, kcalHi: 2000, proteinG: 80, sugarG: 25, waterGoal: 8,
    showWeight: false, parentPin: '', usdaKey: '', units: 'us', lastBackup: 0, setupDone: false },
  foods: {}, entries: [], days: {}, weights: []
});
let S;
function load() {
  try { S = JSON.parse(localStorage.getItem(KEY)) || DEFAULT(); } catch (e) { S = DEFAULT(); }
  const d = DEFAULT();
  S.settings = Object.assign(d.settings, S.settings || {});
  for (const k of ['foods', 'days']) S[k] = S[k] || {};
  for (const k of ['entries', 'weights']) S[k] = S[k] || [];
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('Could not save. Phone storage may be full.'); }
}
load();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r0 = n => Math.round(n || 0);
const r1 = n => Math.round((n || 0) * 10) / 10;
const fmt = n => r0(n).toLocaleString();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
const MEALS = [['breakfast', 'Breakfast', '🌅'], ['lunch', 'Lunch', '☀️'], ['dinner', 'Dinner', '🌙'], ['snack', 'Snacks', '🍎']];
const mealName = m => (MEALS.find(x => x[0] === m) || MEALS[3])[1];
function mealNow() {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h >= 11 && h < 14) return 'lunch';
  if (h >= 17 && h < 20) return 'dinner';
  return 'snack';
}
const pick = a => a[Math.floor(Math.random() * a.length)];
const SWEET_RE = /\b(soda|cola|pop|candy|cookie|cake|cupcake|donut|doughnut|brownie|ice cream|gummy|gummies|chocolate bar|frosting|syrup|lemonade|energy drink|sweet tea|pastry|pie|skittles|starburst|m&m|oreo|twinkie|fruit snack|juice drink|sprite|pepsi|coke|fanta|dr pepper|mountain dew)\b/i;

// ---------- built-in foods ----------
const bid = name => 'b_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
for (const [name, serving, kcal, protein, addedSugar, sweet, emoji, meal] of window.BUILTIN_FOODS) {
  const id = bid(name);
  const prev = S.foods[id] || {};
  S.foods[id] = Object.assign({ uses: 0, lastUsed: 0, fav: false }, prev,
    { id, name, serving, kcal, protein, addedSugar, sweet, emoji, meal, src: 'builtin' });
}

// ---------- targets ----------
function computeTargets(s) {
  const age = Math.min(18, Math.max(9, s.ageY || 13));
  const kg = s.weightKg, m = (s.heightCm || 0) / 100;
  if (!kg || !m) return null;
  const days = s.soccerDays || 0;
  const pa = days >= 6 ? 1.56 : days >= 3 ? 1.31 : 1.16;   // IOM activity levels; game days get an extra boost via the toggle
  const eer = 135.3 - 30.8 * age + pa * (10 * kg + 934 * m) + 25;
  let centre = eer - 250;                              // gentle: about 0.5 lb/week at most
  centre = Math.max(centre, 1600, eer * 0.85);       // never too low for a growing athlete
  centre = Math.round(centre / 50) * 50;
  let protein = Math.round(Math.min(100, Math.max(70, kg * 1.3)) / 5) * 5;
  return { eer: Math.round(eer), kcalLo: centre - 100, kcalHi: centre + 100, proteinG: protein };
}

// ---------- totals ----------
const GAME_BONUS = 200;
function dayEntries(k) { return S.entries.filter(e => e.date === k); }
function totals(k) {
  const t = { kcal: 0, protein: 0, sugar: 0, snacks: 0, treats: 0, n: 0 };
  for (const e of dayEntries(k)) {
    t.kcal += e.kcal * e.qty; t.protein += e.protein * e.qty; t.sugar += (e.addedSugar || 0) * e.qty;
    if (e.meal === 'snack') t.snacks++;
    if (e.sweet) t.treats++;
    t.n++;
  }
  return t;
}
function zone(k) {
  const g = (S.days[k] || {}).gameDay ? GAME_BONUS : 0;
  return { lo: S.settings.kcalLo + g, hi: S.settings.kcalHi + g };
}
function streak() {
  let k = dayKey(), n = 0;
  if (!dayEntries(k).length) k = addDays(k, -1);
  while (dayEntries(k).length) { n++; k = addDays(k, -1); }
  return n;
}

// ---------- UI shell ----------
let view = 'today', viewDay = dayKey(), addTab = 'quick', addMeal = null;
const app = $('#app');
$('#nav').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  go(b.dataset.v);
});
function go(v, opts = {}) {
  view = v; if (v === 'add') { addMeal = opts.meal || null; addTab = opts.tab || addTab; }
  stopScan();
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  render(); window.scrollTo(0, 0);
}
function render() {
  $('#hello').textContent = `Hi ${S.settings.name || 'there'}! ⚽`;
  const st = streak();
  const sb = $('#streakBadge');
  sb.classList.toggle('hidden', st < 2); sb.textContent = `🔥 ${st} days`;
  ({ today: renderToday, add: renderAdd, week: renderWeek, me: renderMe })[view]();
}

// ---------- rings ----------
function ring(frac, color, inner) {
  const R = 52, C = 2 * Math.PI * R, f = Math.max(0, Math.min(1, frac));
  return `<svg viewBox="0 0 130 130" aria-hidden="true">
    <circle cx="65" cy="65" r="${R}" fill="none" stroke="var(--line)" stroke-width="13"/>
    <circle cx="65" cy="65" r="${R}" fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round"
      stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - f)}" transform="rotate(-90 65 65)" style="transition:stroke-dashoffset .5s"/>
    <text x="65" y="62" text-anchor="middle" font-size="24" font-weight="800" fill="var(--ink)">${inner[0]}</text>
    <text x="65" y="84" text-anchor="middle" font-size="11" fill="var(--muted)">${inner[1]}</text></svg>`;
}

function coachLine(k, t, z) {
  const s = S.settings, isToday = k === dayKey(), h = new Date().getHours();
  if (!t.n) return isToday ? pick(['New day, fresh start! 🌞 What did you have for breakfast?', 'Ready to fuel up? Tap ＋ to log your first food.']) : 'Nothing logged this day. That’s okay!';
  const pLeft = s.proteinG - t.protein;
  if (isToday && h >= 18 && t.kcal < 1200) return 'Don’t forget to fuel up! Growing athletes need plenty of energy. 💪';
  if (t.protein >= s.proteinG && t.kcal >= z.lo && t.kcal <= z.hi) return 'Protein goal AND in the fuel zone. Amazing day! 🌟';
  if (t.protein >= s.proteinG) return 'Protein goal reached! Your muscles say thanks. 💪';
  if (pLeft <= 20) return `Protein power: ${r0(t.protein)}/${s.proteinG} g. A Greek yogurt or string cheese would do it!`;
  if (t.kcal >= z.lo && t.kcal <= z.hi) return 'You’re in the fuel zone! 🎯';
  return pick(['Nice fuel-up! Keep logging. 📝', 'Great job tracking today!', `Protein so far: ${r0(t.protein)} g. Eggs, chicken, milk and yogurt are protein heroes!`]);
}

// ---------- TODAY ----------
function renderToday() {
  const k = viewDay, t = totals(k), z = zone(k), s = S.settings, isToday = k === dayKey();
  const d = parseDay(k);
  const label = isToday ? 'Today' : k === addDays(dayKey(), -1) ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const inZone = t.kcal >= z.lo;
  const fuelSub = inZone ? 'zone reached ✓' : `${fmt(z.lo)}–${fmt(z.hi)} zone`;
  const day = S.days[k] || {};
  const water = day.water || 0;
  let html = `
  <div class="daynav"><button id="prevDay" aria-label="Previous day">‹</button><span class="d">${label}</span>
    <button id="nextDay" aria-label="Next day" ${isToday ? 'style="visibility:hidden"' : ''}>›</button></div>
  <div class="card">
    <div class="rings">
      <div class="ring">${ring(t.kcal / z.hi, 'var(--teal)', [fmt(t.kcal), fuelSub])}<div class="lbl">⚡ Fuel</div></div>
      <div class="ring">${ring(t.protein / s.proteinG, 'var(--purple)', [r0(t.protein) + ' g', 'goal ' + s.proteinG + ' g'])}<div class="lbl">💪 Protein</div></div>
    </div>
    <div class="row wrap" style="margin-top:12px;justify-content:center">
      <span class="chip c-sun">🍎 Snacks: ${t.snacks}</span>
      <span class="chip c-pink">🍭 Added sugar ≈${r0(t.sugar)} g <span class="muted small">/ ${s.sugarG}</span></span>
    </div>
  </div>
  <div class="msg">${esc(coachLine(k, t, z))}</div>
  <div class="card toggle"><div><b>⚽ Game or practice day</b><div class="small muted">Adds ${GAME_BONUS} to your fuel zone</div></div>
    <button class="switch ${day.gameDay ? 'on' : ''}" id="gameDay" role="switch" aria-checked="${!!day.gameDay}" aria-label="Game day"></button></div>`;
  for (const [m, name, em] of MEALS) {
    const es = dayEntries(k).filter(e => e.meal === m).sort((a, b) => a.ts - b.ts);
    const mk = es.reduce((a, e) => a + e.kcal * e.qty, 0);
    html += `<div class="card meal"><h3><span>${em} ${name}</span><span class="muted small">${es.length ? fmt(mk) + ' cal' : ''}</span></h3>`;
    for (const e of es) {
      html += `<button class="entry" data-eid="${e.id}"><span class="em">${e.emoji || '🍽️'}</span>
        <span class="nm"><b>${esc(e.name)}</b><span class="small muted">${e.qty !== 1 ? e.qty + ' × ' : ''}${esc(e.serving || '')}</span></span>
        ${e.sweet ? '<span class="tag">🍭 treat</span>' : ''}
        <span class="kc">${fmt(e.kcal * e.qty)} cal<br><span class="muted">${r0(e.protein * e.qty)} g pro</span></span></button>`;
    }
    html += `<button class="addmeal" data-meal="${m}">＋ Add to ${name.toLowerCase()}</button></div>`;
  }
  html += `<div class="card"><div class="row between"><b>💧 Water</b><span class="small muted">${water}/${s.waterGoal} bottles or cups</span></div>
    <div class="water" style="margin-top:6px">${Array.from({ length: Math.max(s.waterGoal, water + 1) }, (_, i) => `<button data-w="${i + 1}" class="${i < water ? 'on' : ''}" aria-label="${i + 1} water">💧</button>`).join('')}</div></div>`;
  if (s.lastBackup < Date.now() - 14 * 864e5 && S.entries.length > 20)
    html += `<div class="card small">💾 It’s been a while since your last backup. <button class="addmeal" id="goBackup">Back up now</button></div>`;
  app.innerHTML = html;
  $('#prevDay').onclick = () => { viewDay = addDays(viewDay, -1); render(); };
  $('#nextDay').onclick = () => { viewDay = addDays(viewDay, 1); render(); };
  $('#gameDay').onclick = () => { S.days[k] = Object.assign({}, S.days[k], { gameDay: !day.gameDay }); save(); render(); };
  app.querySelectorAll('[data-eid]').forEach(b => b.onclick = () => editEntry(b.dataset.eid));
  app.querySelectorAll('[data-meal]').forEach(b => b.onclick = () => go('add', { meal: b.dataset.meal }));
  app.querySelectorAll('[data-w]').forEach(b => b.onclick = () => {
    const n = +b.dataset.w; S.days[k] = Object.assign({}, S.days[k], { water: water === n ? n - 1 : n }); save(); render();
  });
  const gb = $('#goBackup'); if (gb) gb.onclick = () => go('me');
}

// ---------- logging ----------
let lastToast;
function logFood(food, qty = 1, meal = null, date = null) {
  const f = S.foods[food.id] ? S.foods[food.id] : (S.foods[food.id] = Object.assign({ uses: 0, lastUsed: 0, fav: false }, food));
  f.uses = (f.uses || 0) + 1; f.lastUsed = Date.now();
  const e = { id: uid(), date: date || (view === 'add' ? viewDay : dayKey()), ts: Date.now(), foodId: f.id, name: f.name, emoji: f.emoji,
    serving: f.serving, meal: meal || addMeal || f.mealPref || mealNow(), qty, kcal: f.kcal, protein: f.protein, addedSugar: f.addedSugar || 0, sweet: !!f.sweet };
  S.entries.push(e); save();
  const msg = e.sweet ? pick(['Treats fit too. Logged! 👍', 'Logged! Thanks for being honest. 🙌'])
    : e.protein * qty >= 10 ? pick(['Protein power! 💪 Added!', 'Nice fuel-up! Added!']) : pick(['Added! 👍', 'Got it! ✅', 'Nice fuel-up!']);
  toast(`${msg} <span class="muted small">${mealName(e.meal)}</span>`, [['Undo', () => { S.entries = S.entries.filter(x => x.id !== e.id); save(); render(); }], ['Change', () => editEntry(e.id)]]);
  render();
  return e;
}
function toast(html, actions = [], ms = 4500) {
  if (lastToast) lastToast.remove();
  const t = document.createElement('div'); t.className = 'toast';
  t.innerHTML = `<span>${html}</span>`;
  for (const [label, fn] of actions) {
    const b = document.createElement('button'); b.textContent = label;
    b.onclick = () => { t.remove(); fn(); }; t.appendChild(b);
  }
  document.body.appendChild(t); lastToast = t;
  setTimeout(() => t.remove(), ms);
}
function sheet(html, onMount) {
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog">${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg) close(); });
  function close() { bg.remove(); }
  document.body.appendChild(bg);
  onMount && onMount(bg.firstChild, close);
  return close;
}
function stepperHtml(q) {
  return `<div class="stepper"><button data-s="-1" aria-label="less">−</button><span class="q" id="q">${q}</span><button data-s="1" aria-label="more">＋</button></div>
  <div class="center small muted">servings</div>`;
}
const fracLabel = q => q;
function nutrHtml(f, q) {
  return `<div class="nutr"><div><b>${fmt(f.kcal * q)}</b><span class="small muted">calories</span></div>
    <div><b>${r0(f.protein * q)} g</b><span class="small muted">protein</span></div>
    <div><b>≈${r0((f.addedSugar || 0) * q)} g</b><span class="small muted">added sugar</span></div></div>`;
}
function mealSeg(m) { return `<div class="seg" id="mealSeg">${MEALS.map(([k, n, em]) => `<button data-m="${k}" class="${k === m ? 'on' : ''}">${em} ${n.replace('Snacks', 'Snack')}</button>`).join('')}</div>`; }

function editEntry(id) {
  const e = S.entries.find(x => x.id === id); if (!e) return;
  let q = e.qty, m = e.meal;
  const f = S.foods[e.foodId];
  sheet(`<h2 style="margin-top:0">${e.emoji || '🍽️'} ${esc(e.name)}</h2><div class="muted small">${esc(e.serving || '')} per serving</div>
    ${stepperHtml(q)}<div id="nu">${nutrHtml(e, q)}</div>
    <label class="f">Meal</label>${mealSeg(m)}
    <div class="row" style="margin-top:16px"><button class="btn ghost" id="fav">${f && f.fav ? '★ Favorite' : '☆ Make favorite'}</button>
    <button class="btn ghost" id="del">🗑️ Remove</button></div>
    <button class="btn block" id="ok" style="margin-top:10px">Save</button>`, (el, close) => {
    el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { q = Math.max(0.5, q + 0.5 * b.dataset.s); $('#q', el).textContent = q; $('#nu', el).innerHTML = nutrHtml(e, q); });
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { m = b.dataset.m; el.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b)); });
    $('#fav', el).onclick = () => { if (f) { f.fav = !f.fav; save(); $('#fav', el).textContent = f.fav ? '★ Favorite' : '☆ Make favorite'; } };
    $('#del', el).onclick = () => { S.entries = S.entries.filter(x => x.id !== id); save(); close(); render(); toast('Removed.', [['Undo', () => { S.entries.push(e); save(); render(); }]]); };
    $('#ok', el).onclick = () => { e.qty = q; e.meal = m; save(); close(); render(); };
  });
}

// Confirm sheet for foods from search/scan (or long-press on a tile)
function foodSheet(food, opts = {}) {
  let q = 1, m = addMeal || food.meal || mealNow();
  let g = food.per100 ? (food.servingG || 100) : null;
  const cur = () => food.per100 ? Object.assign({}, food, scaleTo(food, g)) : food;
  sheet(`<h2 style="margin-top:0">${food.emoji || '🍽️'} ${esc(food.name)}</h2>
    <div class="muted small">${esc(food.brand || '')} ${food.src === 'usda' ? '· USDA' : food.src === 'off' ? '· Open Food Facts' : ''}</div>
    ${food.per100 ? `<label class="f">How much? (grams)</label><input id="grams" type="number" inputmode="decimal" value="${g}">
      ${food.servingG && food.servingLabel ? `<div class="small muted" style="margin-top:4px">1 serving = ${esc(food.servingLabel)}</div>` : ''}`
      : `<div class="muted small">${esc(food.serving || '')} per serving</div>${stepperHtml(q)}`}
    <div id="nu">${nutrHtml(cur(), q)}</div>
    <div class="toggle" style="margin:8px 0"><span>🍭 Sweet treat?</span><button class="switch ${food.sweet ? 'on' : ''}" id="sw" role="switch"></button></div>
    <label class="f">Meal</label>${mealSeg(m)}
    <button class="btn block" id="ok" style="margin-top:14px">Add it ✅</button>
    <button class="btn ghost block" id="favAdd" style="margin-top:8px">★ Add + save as favorite</button>`, (el, close) => {
    const upd = () => { $('#nu', el).innerHTML = nutrHtml(cur(), q); };
    el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { q = Math.max(0.5, q + 0.5 * b.dataset.s); $('#q', el).textContent = q; upd(); });
    const gi = $('#grams', el); if (gi) gi.oninput = () => { g = Math.max(0, +gi.value || 0); upd(); };
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { m = b.dataset.m; el.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b)); });
    $('#sw', el).onclick = () => { food.sweet = !food.sweet; $('#sw', el).classList.toggle('on', food.sweet); };
    const add = fav => {
      let f = cur();
      if (food.per100) f = Object.assign({}, f, { id: food.id + '_' + r0(g) + 'g', serving: r0(g) + ' g', per100: false });
      delete f.per100;
      if (fav) f.fav = true;
      if (S.foods[f.id]) Object.assign(S.foods[f.id], { sweet: f.sweet, fav: S.foods[f.id].fav || !!fav });
      f.mealPref = undefined;
      close(); logFood(f, q, m);
    };
    $('#ok', el).onclick = () => add(false);
    $('#favAdd', el).onclick = () => add(true);
  });
}
function scaleTo(food, g) {
  const k = g / 100;
  return { kcal: food.kcal100 * k, protein: food.protein100 * k, addedSugar: food.added100 * k };
}

// ---------- ADD ----------
function renderAdd() {
  const forMeal = addMeal ? ` to ${mealName(addMeal).toLowerCase()}` : '';
  app.innerHTML = `<h2 style="margin-top:4px">Add food${forMeal} ${viewDay !== dayKey() ? `<span class="small muted">(${parseDay(viewDay).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})</span>` : ''}</h2>
  <div class="tabs" id="tabs">${[['quick', '⚡ Quick'], ['search', '🔎 Search'], ['scan', '📷 Scan'], ['custom', '✏️ Make']].map(([k, n]) => `<button data-t="${k}" class="${addTab === k ? 'on' : ''}">${n}</button>`).join('')}</div>
  <div id="tabBody"></div>`;
  $('#tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; stopScan(); addTab = b.dataset.t; renderAdd(); };
  ({ quick: tabQuick, search: tabSearch, scan: tabScan, custom: tabCustom })[addTab]($('#tabBody'));
}
function tile(f) {
  return `<button class="tile" data-fid="${esc(f.id)}">${f.fav ? '<span class="star">★</span>' : ''}<span class="em">${f.emoji || '🍽️'}</span>
    <span class="n">${esc(f.name)}</span><span class="k">${fmt(f.kcal)} cal · ${r0(f.protein)} g pro</span></button>`;
}
function bindTiles(el) {
  el.querySelectorAll('[data-fid]').forEach(b => {
    let timer, long = false;
    const start = () => { long = false; timer = setTimeout(() => { long = true; foodSheet(Object.assign({}, S.foods[b.dataset.fid])); }, 500); };
    const cancel = () => clearTimeout(timer);
    b.addEventListener('touchstart', start, { passive: true }); b.addEventListener('touchend', cancel); b.addEventListener('touchmove', cancel, { passive: true });
    b.addEventListener('contextmenu', e => { e.preventDefault(); cancel(); if (!long) foodSheet(Object.assign({}, S.foods[b.dataset.fid])); long = true; });
    b.onclick = () => { if (long) { long = false; return; } logFood(S.foods[b.dataset.fid]); };
  });
}
function tabQuick(el) {
  const all = Object.values(S.foods);
  const favs = all.filter(f => f.fav).sort((a, b) => a.name.localeCompare(b.name));
  const recent = all.filter(f => f.lastUsed && !f.fav).sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 9);
  const builtins = window.BUILTIN_FOODS.map(b => S.foods[bid(b[0])]);
  el.innerHTML = `<p class="small muted" style="margin:4px 0">Tap to add 1 serving. Press and hold to pick an amount.</p>
    <input id="qf" type="search" placeholder="Filter my foods…" autocomplete="off">
    <div id="qlist"></div>`;
  const draw = () => {
    const q = $('#qf', el).value.trim().toLowerCase();
    let html = '';
    if (q) {
      const m = all.filter(f => f.name.toLowerCase().includes(q)).sort((a, b) => (b.uses || 0) - (a.uses || 0)).slice(0, 30);
      html = m.length ? `<div class="grid" style="margin-top:10px">${m.map(tile).join('')}</div>` :
        `<p class="muted">Not in your foods yet. <button class="addmeal" id="toSearch">Search the food database for “${esc(q)}”</button></p>`;
    } else {
      if (favs.length) html += `<h2>★ Favorites</h2><div class="grid">${favs.map(tile).join('')}</div>`;
      if (recent.length) html += `<h2>🕘 Recent</h2><div class="grid">${recent.map(tile).join('')}</div>`;
      const groups = [['💪 Protein power', 0, 16], ['⚡ Energy', 16, 28], ['🍎 Fruits & veggies', 28, 36], ['⚽ Game day', 36, 41], ['🍭 Sometimes foods', 41, 99]];
      for (const [name, a, b] of groups) html += `<h2>${name}</h2><div class="grid">${builtins.slice(a, b).map(tile).join('')}</div>`;
    }
    $('#qlist', el).innerHTML = html;
    bindTiles(el);
    const ts = $('#toSearch', el); if (ts) ts.onclick = () => { searchQ = q; addTab = 'search'; renderAdd(); };
  };
  $('#qf', el).oninput = draw; draw();
}

// ---------- online food search ----------
let searchQ = '';
const cache = new Map();
function usdaKey() { return S.settings.usdaKey || 'DEMO_KEY'; }
function nutr(list, ids) {
  for (const id of ids) { const n = list.find(x => (x.nutrientId || (x.nutrient && x.nutrient.id)) === id); if (n) return n.value ?? n.amount ?? 0; }
  return null;
}
function guessSweet(name, sugar100, added100) {
  if (SWEET_RE.test(name)) return true;
  if (added100 != null) return added100 >= 15;
  return sugar100 >= 25 && !/\b(fruit|raisin|date|apple|banana|grape|berr|mango|milk|yogurt)\b/i.test(name);
}
function titleCase(s) { return s.length > 3 && s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : s; }
async function searchUSDA(q) {
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(usdaKey())}&query=${encodeURIComponent(q)}&pageSize=25&dataType=Survey%20(FNDDS)&dataType=Foundation&dataType=SR%20Legacy&dataType=Branded`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('usda ' + r.status);
  const j = await r.json();
  return (j.foods || []).map(fd => {
    const N = fd.foodNutrients || [];
    const kcal = nutr(N, [1008, 2047, 2048]), protein = nutr(N, [1003]) || 0, sugar = nutr(N, [2000, 1063]) || 0, added = nutr(N, [1235]);
    if (kcal == null) return null;
    const name = titleCase(fd.description || 'Food');
    const sweet = guessSweet(name, sugar, added);
    const added100 = added != null ? added : (sweet ? sugar : 0);
    let servingG = null, servingLabel = '';
    if (fd.servingSize && /^(g|grm|ml|mlt)$/i.test(fd.servingSizeUnit || '')) { servingG = fd.servingSize; servingLabel = (fd.householdServingFullText ? fd.householdServingFullText + ' · ' : '') + r0(fd.servingSize) + ' ' + (fd.servingSizeUnit || 'g').toLowerCase().replace('grm', 'g').replace('mlt', 'ml'); }
    else if (fd.foodMeasures && fd.foodMeasures.length) { const ms = fd.foodMeasures.filter(x => x.gramWeight).sort((a, b) => (a.rank || 99) - (b.rank || 99)); const fm = ms.find(x => !/not specified/i.test(x.disseminationText || '')) || ms[0]; if (fm) { servingG = fm.gramWeight; servingLabel = (fm.disseminationText || fm.measureUnitName || '') + ' · ' + r0(fm.gramWeight) + ' g'; } }
    return { id: 'usda_' + fd.fdcId, name, brand: titleCase(fd.brandName || fd.brandOwner || ''), src: 'usda', barcode: fd.gtinUpc || '',
      per100: true, kcal100: kcal, protein100: protein, added100, servingG: servingG ? r0(servingG) : null, servingLabel, sweet, emoji: sweet ? '🍭' : '🍽️' };
  }).filter(Boolean);
}
function fromOFF(p, code) {
  const n = p.nutriments || {};
  const kcal100 = n['energy-kcal_100g'] ?? (n['energy_100g'] != null ? n['energy_100g'] / 4.184 : null);
  if (kcal100 == null) return null;
  const sugar100 = n.sugars_100g || 0, addedRaw = n['added-sugars_100g'];
  const name = p.product_name || p.generic_name || 'Product';
  const sweet = guessSweet(name, sugar100, addedRaw);
  const servingG = p.serving_quantity ? +p.serving_quantity : null;
  return { id: 'off_' + (code || p.code), name, brand: (p.brands || '').split(',')[0], src: 'off', barcode: code || p.code,
    per100: true, kcal100, protein100: n.proteins_100g || 0, added100: addedRaw != null ? addedRaw : (sweet ? sugar100 : 0),
    servingG: servingG ? r0(servingG) : null, servingLabel: p.serving_size || '', sweet, emoji: sweet ? '🍭' : '🛒' };
}
const OFF_FIELDS = 'code,product_name,generic_name,brands,serving_size,serving_quantity,nutriments';
async function searchOFF(q) {
  const r = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=${OFF_FIELDS}`);
  if (!r.ok) throw new Error('off ' + r.status);
  const j = await r.json();
  return (j.products || []).map(p => fromOFF(p)).filter(Boolean);
}
async function lookupBarcode(code) {
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
    if (r.ok) { const j = await r.json(); if (j.status === 1 && j.product) { const f = fromOFF(j.product, code); if (f) return f; } }
  } catch (e) {}
  try {
    const res = await searchUSDA(code);
    const strip = s => String(s || '').replace(/^0+/, '');
    const hit = res.find(f => strip(f.barcode) === strip(code));
    if (hit) return hit;
  } catch (e) {}
  return null;
}
function resultRow(f, i) {
  const base = f.servingG ? scaleTo(f, f.servingG) : scaleTo(f, 100);
  return `<button class="item" data-i="${i}"><span style="font-size:22px">${f.emoji}</span><span class="nm"><b>${esc(f.name)}</b>
    <span class="small muted">${esc(f.brand ? f.brand + ' · ' : '')}${fmt(base.kcal)} cal · ${r0(base.protein)} g protein per ${f.servingG ? esc(f.servingLabel || f.servingG + ' g') : '100 g'}</span></span>${f.sweet ? '<span class="tag">🍭</span>' : ''}</button>`;
}
function tabSearch(el) {
  el.innerHTML = `<form id="sf" class="row"><input id="sq" type="search" placeholder="e.g. chicken burrito, Chobani…" value="${esc(searchQ)}" autocomplete="off"><button class="btn">Go</button></form>
    <div id="sr" class="card list" style="padding:4px 12px"><p class="muted small">Search thousands of foods from the USDA and Open Food Facts databases.</p></div>`;
  const run = async () => {
    const q = $('#sq', el).value.trim(); searchQ = q; if (q.length < 2) return;
    const out = $('#sr', el);
    if (!navigator.onLine) { out.innerHTML = `<p class="muted">You’re offline. Use ⚡ Quick to pick from your saved foods.</p>`; return; }
    out.innerHTML = `<p><span class="spin"></span> Searching…</p>`;
    let res = cache.get(q);
    if (!res) {
      res = [];
      try { res = await searchUSDA(q); } catch (e) { console.warn(e); }
      
      if (res.length) cache.set(q, res);
    }
    if (!res.length) { out.innerHTML = `<p class="muted">No luck finding “${esc(q)}”. Try fewer words, or use ✏️ Make to add it yourself.</p>`; return; }
    out.innerHTML = res.slice(0, 30).map(resultRow).join('');
    out.querySelectorAll('[data-i]').forEach(b => b.onclick = () => foodSheet(Object.assign({}, res[+b.dataset.i])));
  };
  $('#sf', el).onsubmit = e => { e.preventDefault(); $('#sq', el).blur(); run(); };
  if (searchQ) run(); else setTimeout(() => $('#sq', el).focus(), 50);
}

// ---------- barcode scanning ----------
let scanStop = null;
function stopScan() { if (scanStop) { try { scanStop(); } catch (e) {} scanStop = null; } }
function tabScan(el) {
  el.innerHTML = `<div class="card"><div id="cam" class="center"><button class="btn block" id="startCam">📷 Start camera</button>
      <p class="small muted">Point at the barcode on the package.</p></div></div>
    <div class="card"><label class="f" for="bc">Or type the barcode numbers</label>
      <form id="bf" class="row"><input id="bc" inputmode="numeric" pattern="[0-9]*" placeholder="e.g. 041570054529"><button class="btn">Look up</button></form></div>
    <div id="scanOut"></div>`;
  $('#bf', el).onsubmit = e => { e.preventDefault(); const c = $('#bc', el).value.replace(/\D/g, ''); if (c.length >= 6) found(c); };
  $('#startCam', el).onclick = () => startCamera($('#cam', el), found);
  async function found(code) {
    stopScan();
    $('#cam', el).innerHTML = `<button class="btn block" id="startCam">📷 Scan another</button>`;
    $('#startCam', el).onclick = () => startCamera($('#cam', el), found);
    const out = $('#scanOut', el);
    const known = Object.values(S.foods).find(f => f.barcode === code && !f.per100);
    if (known) { out.innerHTML = ''; foodSheet(Object.assign({}, known)); return; }
    out.innerHTML = `<div class="card"><span class="spin"></span> Looking up ${esc(code)}…</div>`;
    const f = await lookupBarcode(code);
    if (f) { out.innerHTML = ''; foodSheet(f); return; }
    out.innerHTML = `<div class="card">🤔 We couldn’t find barcode <b>${esc(code)}</b>. You can make it yourself from the label (it’ll be saved for next time).
      <button class="btn block" id="mk" style="margin-top:10px">✏️ Make this food</button></div>`;
    $('#mk', out).onclick = () => { pendingBarcode = code; addTab = 'custom'; renderAdd(); };
  }
}
async function startCamera(box, onCode) {
  stopScan();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { box.innerHTML = '<p class="muted">Camera isn’t available here. Type the numbers below instead.</p>'; return; }
  const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
  let native = false;
  if ('BarcodeDetector' in window) { try { const sup = await BarcodeDetector.getSupportedFormats(); native = formats.some(f => sup.includes(f)); } catch (e) {} }
  if (native) {
    box.innerHTML = `<video id="vid" playsinline muted></video><button class="btn ghost block" id="stopCam" style="margin-top:8px">Stop</button>`;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
    catch (e) { box.innerHTML = '<p class="muted">Camera permission was blocked. Type the numbers below instead.</p>'; return; }
    const v = $('#vid', box); v.srcObject = stream; await v.play().catch(() => {});
    const det = new BarcodeDetector({ formats });
    let live = true;
    scanStop = () => { live = false; stream.getTracks().forEach(t => t.stop()); };
    $('#stopCam', box).onclick = () => { stopScan(); box.innerHTML = `<button class="btn block" id="sc2">📷 Start camera</button>`; $('#sc2', box).onclick = () => startCamera(box, onCode); };
    const tick = async () => {
      if (!live) return;
      try { const codes = await det.detect(v); if (codes.length) { navigator.vibrate && navigator.vibrate(80); onCode(codes[0].rawValue); return; } } catch (e) {}
      setTimeout(tick, 200);
    };
    tick();
    return;
  }
  // Fallback (iPhone etc.): load html5-qrcode library on demand
  box.innerHTML = `<div id="scanReader"></div><p class="small muted"><span class="spin"></span> Starting camera…</p>`;
  try {
    if (!window.Html5Qrcode) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const F = window.Html5QrcodeSupportedFormats;
    const h = new Html5Qrcode('scanReader', { formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E], verbose: false });
    let done = false;
    scanStop = () => { done = true; h.stop().catch(() => {}); };
    await h.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 140 } }, text => { if (done) return; done = true; navigator.vibrate && navigator.vibrate(80); h.stop().catch(() => {}).finally(() => onCode(text)); });
    box.querySelector('p').remove();
  } catch (e) {
    console.warn(e);
    box.innerHTML = '<p class="muted">Couldn’t start the camera (check camera permission). You can type the numbers below.</p>';
  }
}

// ---------- custom food ----------
let pendingBarcode = '';
function tabCustom(el) {
  el.innerHTML = `<div class="card"><p class="small muted" style="margin-top:0">Copy the numbers from the Nutrition Facts label for <b>one serving</b>.</p>
    <label class="f">Food name</label><input id="cn" placeholder="e.g. Grandma’s lasagna">
    <label class="f">Serving</label><input id="cs" placeholder="e.g. 1 piece, 1 cup">
    <div class="row"><div style="flex:1"><label class="f">Calories</label><input id="ck" type="number" inputmode="decimal"></div>
      <div style="flex:1"><label class="f">Protein (g)</label><input id="cp" type="number" inputmode="decimal"></div></div>
    <label class="f">Added sugars (g) <span class="muted small">optional</span></label><input id="ca" type="number" inputmode="decimal" placeholder="0">
    <div class="toggle" style="margin:14px 0"><span>🍭 Sweet treat?</span><button class="switch" id="csw" role="switch"></button></div>
    ${pendingBarcode ? `<p class="small muted">Barcode ${esc(pendingBarcode)} will be remembered.</p>` : ''}
    <button class="btn block" id="csave">Save + add it ✅</button></div>`;
  let sweet = false;
  $('#csw', el).onclick = () => { sweet = !sweet; $('#csw', el).classList.toggle('on', sweet); };
  $('#csave', el).onclick = () => {
    const name = $('#cn', el).value.trim(), kcal = +$('#ck', el).value;
    if (!name || !(kcal >= 0) || $('#ck', el).value === '') { toast('Add a name and calories first 🙂'); return; }
    const f = { id: 'c_' + uid(), name, serving: $('#cs', el).value.trim() || '1 serving', kcal, protein: +$('#cp', el).value || 0,
      addedSugar: +$('#ca', el).value || 0, sweet, emoji: sweet ? '🍭' : '🍽️', src: 'custom', barcode: pendingBarcode, fav: false, uses: 0, lastUsed: 0 };
    pendingBarcode = '';
    S.foods[f.id] = f; save(); logFood(f);
  };
}

// ---------- WEEK ----------
function renderWeek() {
  const s = S.settings, today = dayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const T = days.map(k => ({ k, t: totals(k), z: zone(k), w: (S.days[k] || {}).water || 0 }));
  const maxP = Math.max(s.proteinG, ...T.map(x => x.t.protein));
  const proteinDays = T.filter(x => x.t.protein >= s.proteinG).length;
  const loggedDays = T.filter(x => x.t.n).length;
  const zoneDays = T.filter(x => x.t.n && x.t.kcal >= x.z.lo - 150 && x.t.kcal <= x.z.hi + 150).length;
  const lowSugar = T.filter(x => x.t.n && x.t.sugar <= s.sugarG).length;
  const waterDays = T.filter(x => x.w >= s.waterGoal).length;
  const allMeals = T.filter(x => ['breakfast', 'lunch', 'dinner'].every(m => dayEntries(x.k).some(e => e.meal === m))).length;
  const wins = [];
  if (loggedDays) wins.push(['📝', `Logged food ${loggedDays} of 7 days`]);
  if (streak() >= 2) wins.push(['🔥', `${streak()}-day logging streak!`]);
  if (proteinDays) wins.push(['💪', `Protein goal hit ${proteinDays} day${proteinDays > 1 ? 's' : ''}!`]);
  if (zoneDays) wins.push(['🎯', `In the fuel zone ${zoneDays} day${zoneDays > 1 ? 's' : ''}`]);
  if (allMeals) wins.push(['🍽️', `Logged breakfast, lunch and dinner ${allMeals} day${allMeals > 1 ? 's' : ''}`]);
  if (lowSugar) wins.push(['🍓', `Kept added sugar in check ${lowSugar} day${lowSugar > 1 ? 's' : ''}`]);
  if (waterDays) wins.push(['💧', `Water goal ${waterDays} day${waterDays > 1 ? 's' : ''}`]);
  const avg = loggedDays ? T.filter(x => x.t.n).reduce((a, x) => a + x.t.protein, 0) / loggedDays : 0;
  app.innerHTML = `<h2 style="margin-top:4px">This week</h2>
  <div class="card"><b>💪 Protein each day</b> <span class="small muted">(goal ${s.proteinG} g)</span>
    <div class="bars">${T.map(x => `<div class="bar"><span class="small">${x.t.protein ? r0(x.t.protein) : ''}</span>
      <div class="b ${x.t.protein >= s.proteinG ? 'hit' : ''}" style="height:${Math.round(x.t.protein / maxP * 100)}%"></div>
      <span>${parseDay(x.k).toLocaleDateString(undefined, { weekday: 'narrow' })}</span></div>`).join('')}</div>
    ${loggedDays ? `<p class="small muted" style="margin-bottom:0">Average on logged days: ${r0(avg)} g</p>` : ''}</div>
  <div class="card"><b>🏆 Wins</b>${wins.length ? wins.map(([e, t]) => `<div class="win"><span class="em">${e}</span><span>${t}</span></div>`).join('')
    : '<p class="muted">Log a few days and your wins will show up here!</p>'}</div>
  <div class="card"><b>📋 Day by day</b><div class="list">${T.slice().reverse().map(x => `<button class="item" data-k="${x.k}"><span class="nm"><b>${parseDay(x.k).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</b>
    <span class="small muted">${x.t.n ? `${fmt(x.t.kcal)} cal · ${r0(x.t.protein)} g protein · ${x.t.snacks} snacks` : 'Nothing logged'}</span></span><span>›</span></button>`).join('')}</div></div>
  <p class="small muted center">Every day you log is a win. Food is fuel for soccer! ⚽</p>`;
  app.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { viewDay = b.dataset.k; go('today'); });
}

// ---------- ME ----------
let parentOpen = false;
function renderMe() {
  const s = S.settings;
  app.innerHTML = `<h2 style="margin-top:4px">Me</h2>
  <div class="card"><label class="f" style="margin-top:0">My name</label><input id="nm" value="${esc(s.name)}">
    <div class="small muted" style="margin-top:10px">Fuel zone: <b>${fmt(s.kcalLo)}–${fmt(s.kcalHi)}</b> calories · Protein goal: <b>${s.proteinG} g</b> · Added sugar guide: ≈${s.sugarG} g · Water: ${s.waterGoal}</div></div>
  <div class="card"><b>📲 Put it on your home screen</b>
    <p class="small" style="margin-bottom:0"><b>Android (Chrome):</b> tap ⋮ then <i>Add to Home screen</i> or <i>Install app</i>.<br>
    <b>iPhone (Safari):</b> tap Share ⬆️ then <i>Add to Home Screen</i>.</p>
    <button class="btn block hidden" id="install" style="margin-top:10px">Install Fuel Up</button></div>
  <div class="card"><b>💾 Backup</b><p class="small muted">Your food log lives only on this phone. Save a backup file now and then (for example to Google Drive).</p>
    <div class="row"><button class="btn ghost" id="exp">Save backup</button><button class="btn ghost" id="imp">Restore</button></div>
    <input type="file" id="impf" accept="application/json,.json" class="hidden">
    <p class="small muted" style="margin-bottom:0">${s.lastBackup ? 'Last backup: ' + new Date(s.lastBackup).toLocaleDateString() : 'No backup yet.'}</p></div>
  <div class="card"><b>🔒 Grown-up settings</b><p class="small muted">Targets, weight check-ins and food database key.</p>
    <button class="btn purple block" id="parent">Open grown-up settings</button></div>
  <div class="card small muted">Fuel Up is a tool to build healthy habits. Food is fuel, and every body is different. Targets are a starting point; check them with a pediatrician or dietitian.</div>`;
  $('#nm').onchange = e => { s.name = e.target.value.trim() || 'there'; save(); render(); };
  if (deferredInstall) { const b = $('#install'); b.classList.remove('hidden'); b.onclick = async () => { deferredInstall.prompt(); deferredInstall = null; b.classList.add('hidden'); }; }
  $('#exp').onclick = exportData;
  $('#imp').onclick = () => $('#impf').click();
  $('#impf').onchange = e => { const f = e.target.files[0]; if (f) importData(f); };
  $('#parent').onclick = () => parentOpen ? parentSheet() : pinGate();
}
function pinGate() {
  const s = S.settings;
  const creating = !s.parentPin;
  sheet(`<h2 style="margin-top:0">🔒 Grown-up settings</h2>
    <label class="f">${creating ? 'Create a 4-digit PIN' : 'Enter PIN'}</label>
    <input id="pin" type="password" inputmode="numeric" maxlength="8" autocomplete="off">
    <button class="btn purple block" id="go" style="margin-top:12px">${creating ? 'Set PIN' : 'Open'}</button>`, (el, close) => {
    const i = $('#pin', el); setTimeout(() => i.focus(), 50);
    $('#go', el).onclick = () => {
      if (creating) { if (i.value.length < 4) { toast('Use at least 4 digits'); return; } s.parentPin = i.value; save(); }
      else if (i.value !== s.parentPin) { toast('That PIN didn’t match'); return; }
      parentOpen = true; close(); parentSheet();
    };
  });
}
function parentSheet() {
  const s = S.settings;
  const lb = s.weightKg ? r1(s.weightKg * 2.20462) : '';
  const ft = s.heightCm ? Math.floor(s.heightCm / 2.54 / 12) : '', inch = s.heightCm ? r0(s.heightCm / 2.54 - ft * 12) : '';
  sheet(`<h2 style="margin-top:0">Grown-up settings</h2>
    <p class="small muted">Targets are figured from the standard energy needs for growing girls, with only a small, gentle reduction (about ½ lb a week at most) and a floor so she always has enough fuel to grow and play. Please check them with her pediatrician.</p>
    <div class="row"><div style="flex:1"><label class="f">Age</label><input id="age" type="number" inputmode="numeric" value="${s.ageY || ''}"></div>
      <div style="flex:1"><label class="f">Weight (lb)</label><input id="lb" type="number" inputmode="decimal" value="${lb}"></div></div>
    <div class="row"><div style="flex:1"><label class="f">Height (ft)</label><input id="ft" type="number" inputmode="numeric" value="${ft}"></div>
      <div style="flex:1"><label class="f">(in)</label><input id="in" type="number" inputmode="numeric" value="${inch}"></div></div>
    <label class="f">Soccer / practice days per week</label><input id="sd" type="number" inputmode="numeric" min="0" max="7" value="${s.soccerDays}">
    <button class="btn ghost block" id="calc" style="margin-top:12px">Calculate targets</button>
    <div id="calcOut" class="small" style="margin-top:8px"></div>
    <div class="row"><div style="flex:1"><label class="f">Fuel zone low</label><input id="lo" type="number" value="${s.kcalLo}"></div>
      <div style="flex:1"><label class="f">Fuel zone high</label><input id="hi" type="number" value="${s.kcalHi}"></div></div>
    <div class="row"><div style="flex:1"><label class="f">Protein goal (g)</label><input id="pg" type="number" value="${s.proteinG}"></div>
      <div style="flex:1"><label class="f">Added sugar guide (g)</label><input id="sg" type="number" value="${s.sugarG}"></div></div>
    <label class="f">Water goal (cups/bottles)</label><input id="wg" type="number" value="${s.waterGoal}">
    <div class="toggle" style="margin:16px 0 4px"><span>⚖️ Weekly weight check-in (only shown here)</span><button class="switch ${s.showWeight ? 'on' : ''}" id="sw"></button></div>
    <div id="wbox" class="${s.showWeight ? '' : 'hidden'}">
      <div class="row"><input id="wnew" type="number" inputmode="decimal" placeholder="Weight in lb"><button class="btn sm" id="wadd">Save</button></div>
      <div class="small muted" id="wlist" style="margin-top:6px">${S.weights.slice(-8).reverse().map(w => `${w.date}: ${r1(w.kg * 2.20462)} lb`).join('<br>') || 'No check-ins yet. Once a week at most is plenty.'}</div></div>
    <label class="f">USDA food database key <span class="muted small">optional</span></label><input id="uk" value="${esc(s.usdaKey)}" placeholder="DEMO_KEY (limited searches per hour)">
    <p class="small muted">Get a free key in a minute at <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noopener">fdc.nal.usda.gov/api-key-signup</a> for unlimited everyday searching.</p>
    <button class="btn purple block" id="ok" style="margin-top:8px">Save settings</button>
    <button class="btn ghost block" id="lock" style="margin-top:8px">Lock</button>`, (el, close) => {
    const num = id => +$(id, el).value || null;
    $('#calc', el).onclick = () => {
      const kg = num('#lb') ? num('#lb') / 2.20462 : null, cm = ((num('#ft') || 0) * 12 + (num('#in') || 0)) * 2.54;
      const t = computeTargets({ ageY: num('#age'), weightKg: kg, heightCm: cm, soccerDays: num('#sd') || 0 });
      if (!t) { $('#calcOut', el).textContent = 'Enter age, weight and height first.'; return; }
      $('#lo', el).value = t.kcalLo; $('#hi', el).value = t.kcalHi; $('#pg', el).value = t.proteinG;
      $('#calcOut', el).innerHTML = `Estimated daily energy needs: about <b>${fmt(t.eer)}</b> calories. Suggested fuel zone <b>${fmt(t.kcalLo)}–${fmt(t.kcalHi)}</b> (game days add ${GAME_BONUS}), protein <b>${t.proteinG} g</b>. Tap Save to use these.`;
    };
    $('#sw', el).onclick = () => { s.showWeight = !s.showWeight; $('#sw', el).classList.toggle('on', s.showWeight); $('#wbox', el).classList.toggle('hidden', !s.showWeight); save(); };
    $('#wadd', el).onclick = () => { const v = +$('#wnew', el).value; if (!v) return; S.weights.push({ date: dayKey(), kg: v / 2.20462 }); save(); $('#wnew', el).value = '';
      $('#wlist', el).innerHTML = S.weights.slice(-8).reverse().map(w => `${w.date}: ${r1(w.kg * 2.20462)} lb`).join('<br>'); };
    $('#lock', el).onclick = () => { parentOpen = false; close(); };
    $('#ok', el).onclick = () => {
      const lo = num('#lo'), hi = num('#hi');
      if (lo && lo < 1400) { toast('For a growing athlete, keep the fuel zone at 1,400 or more.'); return; }
      Object.assign(s, { ageY: num('#age'), soccerDays: num('#sd') || 0, kcalLo: lo || s.kcalLo, kcalHi: Math.max(hi || s.kcalHi, (lo || s.kcalLo) + 50),
        proteinG: num('#pg') || s.proteinG, sugarG: num('#sg') || s.sugarG, waterGoal: Math.min(16, num('#wg') || s.waterGoal), usdaKey: $('#uk', el).value.trim(), setupDone: true });
      if (num('#lb')) s.weightKg = num('#lb') / 2.20462;
      const cm = ((num('#ft') || 0) * 12 + (num('#in') || 0)) * 2.54; if (cm > 100) s.heightCm = cm;
      save(); close(); toast('Settings saved ✅'); render();
    };
  });
}
function exportData() {
  S.settings.lastBackup = Date.now(); save();
  const blob = new Blob([JSON.stringify(S)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fuelup-backup-${dayKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup saved to your downloads 💾'); render();
}
function importData(file) {
  const rd = new FileReader();
  rd.onload = () => {
    let d; try { d = JSON.parse(rd.result); } catch (e) { toast('That file isn’t a Fuel Up backup.'); return; }
    if (!d || d.v !== 1 || !Array.isArray(d.entries)) { toast('That file isn’t a Fuel Up backup.'); return; }
    sheet(`<h2 style="margin-top:0">Restore backup</h2><p>${d.entries.length} food logs in this file.</p>
      <button class="btn block" id="merge">Add to what’s here</button><button class="btn ghost block" id="rep" style="margin-top:8px">Replace everything</button>`, (el, close) => {
      $('#merge', el).onclick = () => { const ids = new Set(S.entries.map(e => e.id)); S.entries.push(...d.entries.filter(e => !ids.has(e.id)));
        Object.assign(S.foods, Object.fromEntries(Object.entries(d.foods || {}).filter(([k]) => !S.foods[k]))); S.days = Object.assign({}, d.days, S.days); save(); close(); toast('Restored ✅'); render(); };
      $('#rep', el).onclick = () => { localStorage.setItem(KEY, JSON.stringify(d)); load(); close(); toast('Restored ✅'); render(); };
    });
  };
  rd.readAsText(file);
}

// ---------- PWA ----------
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (view === 'me') render(); });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
// Roll over to the new day if the app was left open past midnight
let lastDay = dayKey();
document.addEventListener('visibilitychange', () => { if (!document.hidden && dayKey() !== lastDay) { if (viewDay === lastDay) viewDay = dayKey(); lastDay = dayKey(); render(); } });

render();
window.__fuel = { S, computeTargets, totals, dayKey };
})();
