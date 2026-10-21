'use strict';
/* ====== Хранилище (IndexedDB) ====== */
let db;
const openDB = () => new Promise((res, rej) => {
  const r = indexedDB.open('workout-tracker', 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore('exercises', { keyPath: 'id' });
    r.result.createObjectStore('workouts', { keyPath: 'id' });
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const run = (store, mode, fn) => new Promise((res, rej) => {
  const t = db.transaction(store, mode);
  const req = fn(t.objectStore(store));
  t.oncomplete = () => res(req ? req.result : undefined);
  t.onerror = () => rej(t.error);
});
const getAll = s => run(s, 'readonly', st => st.getAll());
const put = (s, v) => run(s, 'readwrite', st => st.put(v));
const del = (s, id) => run(s, 'readwrite', st => st.delete(id));
const clearStore = s => run(s, 'readwrite', st => st.clear());

/* ====== Модель ====== */
const TYPES = { strength: 'Силовое', bodyweight: 'Свой вес', cardio: 'Кардио' };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2));
const SEED = [
  ['Жим лёжа', 'strength'], ['Приседания со штангой', 'strength'], ['Становая тяга', 'strength'],
  ['Жим стоя', 'strength'], ['Тяга штанги в наклоне', 'strength'],
  ['Подтягивания', 'bodyweight'], ['Отжимания', 'bodyweight'], ['Отжимания на брусьях', 'bodyweight'], ['Пресс', 'bodyweight'],
  ['Бег', 'cardio'], ['Велосипед', 'cardio'], ['Ходьба', 'cardio'], ['Плавание', 'cardio'],
].map(([name, type]) => ({ id: uid(), name, type }));

let S = { exercises: [], workouts: [], tab: 'train', progressEx: null, adding: false };
const active = () => S.workouts.find(w => !w.finished);
const exById = id => S.exercises.find(e => e.id === id);
const finished = () => S.workouts.filter(w => w.finished).sort((a, b) => b.start - a.start);

async function load() {
  S.exercises = await getAll('exercises');
  if (!S.exercises.length) {
    for (const e of SEED) await put('exercises', e);
    S.exercises = SEED.slice();
  }
  S.exercises.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  S.workouts = await getAll('workouts');
}

/* ====== Утилиты ====== */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const fmtDate = t => new Date(t).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtSet = (type, s) =>
  type === 'strength' ? `${s.w} кг × ${s.r}` :
  type === 'bodyweight' ? `${s.r} повт.` + (s.w ? ` (+${s.w} кг)` : '') :
  `${s.km} км · ${s.min} мин` + (s.km && s.min ? ` · ${(s.min / s.km).toFixed(1)} мин/км` : '');
const lastFor = exId => {
  for (const w of finished()) {
    const e = w.entries.find(e => e.exId === exId);
    if (e && e.sets.length) return e;
  }
  return null;
};
const volume = w => w.entries.reduce((a, e) => a + e.sets.reduce((b, s) => b + (exById(e.exId)?.type === 'strength' ? s.w * s.r : 0), 0), 0);

/* ====== Действия ====== */
async function save(w) { await put('workouts', w); }
async function startWorkout() {
  const w = { id: uid(), start: Date.now(), finished: false, entries: [] };
  S.workouts.push(w); await save(w); render();
}
async function finishWorkout() {
  const w = active(); if (!w) return;
  w.entries = w.entries.filter(e => e.sets.length);
  if (!w.entries.length) { await del('workouts', w.id); S.workouts = S.workouts.filter(x => x !== w); }
  else { w.finished = true; w.end = Date.now(); await save(w); }
  render();
}
async function addEntry(exId) {
  const w = active(); if (!w || !exId) return;
  if (!w.entries.some(e => e.exId === exId)) w.entries.push({ exId, sets: [] });
  S.adding = false; await save(w); render();
}
async function addSet(exId, card) {
  const w = active(); const ex = exById(exId); const e = w.entries.find(e => e.exId === exId);
  const v = n => num(card.querySelector(`[name=${n}]`)?.value);
  let s;
  if (ex.type === 'strength') { const wt = v('w'), r = v('r'); if (wt == null || !r) return flash(card); s = { w: wt, r }; }
  else if (ex.type === 'bodyweight') { const r = v('r'); if (!r) return flash(card); s = { r, w: v('w') || 0 }; }
  else { const km = v('km'), min = v('min'); if (km == null || min == null) return flash(card); s = { km, min }; }
  e.sets.push(s); await save(w); render();
}
const flash = card => { card.style.borderColor = 'var(--danger)'; setTimeout(() => card.style.borderColor = '', 600); };
async function delSet(exId, i) {
  const w = active(); const e = w.entries.find(e => e.exId === exId);
  e.sets.splice(i, 1); await save(w); render();
}
async function delEntry(exId) {
  const w = active(); w.entries = w.entries.filter(e => e.exId !== exId); await save(w); render();
}
async function delWorkout(id) {
  if (!confirm('Удалить тренировку?')) return;
  await del('workouts', id); S.workouts = S.workouts.filter(w => w.id !== id); render();
}
async function addExercise(form) {
  const name = form.querySelector('[name=name]').value.trim();
  const type = form.querySelector('[name=type]').value;
  if (!name) return;
  const e = { id: uid(), name, type };
  await put('exercises', e); S.exercises.push(e);
  S.exercises.sort((a, b) => a.name.localeCompare(b.name, 'ru')); render();
}
async function delExercise(id) {
  const used = S.workouts.some(w => w.entries.some(e => e.exId === id));
  if (used && !confirm('Упражнение есть в истории. Удалить всё равно? В истории оно будет отображаться как «удалено».')) return;
  await del('exercises', id); S.exercises = S.exercises.filter(e => e.id !== id); render();
}

/* ====== Экспорт / импорт ====== */
function exportJSON() {
  const data = JSON.stringify({ v: 1, exportedAt: new Date().toISOString(), exercises: S.exercises, workouts: S.workouts }, null, 2);
  download(`workouts-${new Date().toISOString().slice(0, 10)}.json`, data, 'application/json');
}
function exportCSV() {
  const rows = [['date', 'exercise', 'type', 'set', 'weight_kg', 'reps', 'distance_km', 'minutes']];
  for (const w of finished().reverse()) for (const e of w.entries) {
    const ex = exById(e.exId);
    e.sets.forEach((s, i) => rows.push([new Date(w.start).toISOString().slice(0, 10), ex ? ex.name : 'удалено', ex ? ex.type : '', i + 1, s.w ?? '', s.r ?? '', s.km ?? '', s.min ?? '']));
  }
  download('workouts.csv', rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
async function importJSON(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.exercises) || !Array.isArray(d.workouts)) throw new Error('формат');
    if (!confirm('Импорт заменит все текущие данные. Продолжить?')) return;
    await clearStore('exercises'); await clearStore('workouts');
    for (const e of d.exercises) await put('exercises', e);
    for (const w of d.workouts) await put('workouts', w);
    await load(); render();
  } catch (err) { alert('Не удалось импортировать: неверный файл'); }
}

/* ====== Представления ====== */
function viewTrain() {
  const w = active();
  if (!w) {
    const last = finished()[0];
    return `<h1>Тренировка</h1>
      <button class="primary block" data-a="start" style="padding:16px;font-size:18px">Начать тренировку</button>
      ${last ? `<h2>Последняя</h2>${workoutCard(last, false)}` : '<div class="empty">Пока нет тренировок.<br>Нажми «Начать», выбери упражнения и записывай подходы.</div>'}`;
  }
  const options = S.exercises.filter(e => !w.entries.some(x => x.exId === e.id))
    .map(e => `<option value="${e.id}">${esc(e.name)} · ${TYPES[e.type]}</option>`).join('');
  return `<div class="row spread"><h1>Идёт тренировка</h1><span class="mute">${new Date(w.start).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span></div>
    ${w.entries.map(entryCard).join('')}
    ${S.adding
      ? `<div class="card"><select id="addSel"><option value="">Выбери упражнение…</option>${options}</select>
         <div class="row" style="margin-top:8px"><button class="primary" data-a="addEntryOk">Добавить</button><button data-a="addEntryCancel">Отмена</button></div></div>`
      : `<button class="block" data-a="addEntry">+ Упражнение</button>`}
    <div style="height:12px"></div>
    <button class="primary block" data-a="finish">Завершить тренировку</button>`;
}
function entryCard(e) {
  const ex = exById(e.exId); if (!ex) return '';
  const prev = lastFor(e.exId);
  const inputs = ex.type === 'strength'
    ? `<input name="w" inputmode="decimal" placeholder="кг"><input name="r" inputmode="numeric" placeholder="повт.">`
    : ex.type === 'bodyweight'
    ? `<input name="r" inputmode="numeric" placeholder="повт."><input name="w" inputmode="decimal" placeholder="+кг (необяз.)">`
    : `<input name="km" inputmode="decimal" placeholder="км"><input name="min" inputmode="decimal" placeholder="мин">`;
  return `<div class="card" data-ex="${e.exId}">
    <div class="row spread"><b>${esc(ex.name)}</b><button class="small danger" data-a="delEntry">✕</button></div>
    ${prev ? `<div class="mute">Прошлый раз: ${prev.sets.map(s => fmtSet(ex.type, s)).join('; ')}</div>` : ''}
    ${e.sets.map((s, i) => `<div class="set"><span>${i + 1}. ${fmtSet(ex.type, s)}</span><button class="small danger" data-a="delSet" data-i="${i}">✕</button></div>`).join('')}
    <div class="row" style="margin-top:8px">${inputs}<button class="primary" data-a="addSet">+</button></div>
  </div>`;
}
function workoutCard(w, deletable = true) {
  const dur = w.end ? Math.round((w.end - w.start) / 60000) : 0;
  const vol = volume(w);
  return `<div class="card">
    <div class="row spread"><b>${fmtDate(w.start)}</b>
      <span class="mute">${dur ? dur + ' мин' : ''}${vol ? ' · ' + Math.round(vol) + ' кг объём' : ''}</span></div>
    ${w.entries.map(e => { const ex = exById(e.exId); return `<div class="set" style="display:block"><b style="font-size:15px">${ex ? esc(ex.name) : 'удалено'}</b>
      <div class="mute">${e.sets.map(s => fmtSet(ex ? ex.type : 'strength', s)).join(' · ')}</div></div>`; }).join('')}
    ${deletable ? `<div style="margin-top:8px"><button class="small danger" data-a="delWorkout" data-id="${w.id}">Удалить</button></div>` : ''}
  </div>`;
}
function viewHistory() {
  const list = finished();
  const weekAgo = Date.now() - 7 * 864e5;
  const week = list.filter(w => w.start > weekAgo).length;
  return `<h1>История</h1>
    <div class="card row"><div class="stat"><b>${list.length}</b><span class="mute">всего</span></div>
      <div class="stat"><b>${week}</b><span class="mute">за 7 дней</span></div>
      <div class="stat"><b>${streakWeeks(list)}</b><span class="mute">нед. подряд</span></div></div>
    ${list.length ? list.map(w => workoutCard(w)).join('') : '<div class="empty">Завершённых тренировок пока нет.</div>'}`;
}
function streakWeeks(list) {
  const wk = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const set = new Set(list.map(w => wk(w.start)));
  let cur = wk(Date.now()), n = 0;
  if (!set.has(cur)) cur -= 7 * 864e5; // текущая неделя ещё может быть пустой
  while (set.has(cur)) { n++; cur -= 7 * 864e5; }
  return n;
}
function seriesFor(ex) {
  const pts = [];
  for (const w of finished().slice().reverse()) {
    const e = w.entries.find(e => e.exId === ex.id); if (!e || !e.sets.length) continue;
    let y;
    if (ex.type === 'strength') y = Math.max(...e.sets.map(s => s.w * (1 + s.r / 30))); // оценка 1ПМ по Эпли
    else if (ex.type === 'bodyweight') y = Math.max(...e.sets.map(s => s.r));
    else y = e.sets.reduce((a, s) => a + s.km, 0);
    pts.push({ t: w.start, y });
  }
  return pts;
}
function chart(pts) {
  if (pts.length < 2) return '<div class="empty">Нужно минимум 2 тренировки с этим упражнением.</div>';
  const W = 600, H = 220, p = 30;
  const ys = pts.map(p => p.y), min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
  const X = i => p + i * (W - 2 * p) / (pts.length - 1);
  const Y = y => H - p - (y - min) / span * (H - 2 * p);
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(q.y).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="График прогресса">
    <line x1="${p}" y1="${H - p}" x2="${W - p}" y2="${H - p}" stroke="#262a33"/>
    <path d="${d}" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linejoin="round"/>
    ${pts.map((q, i) => `<circle cx="${X(i)}" cy="${Y(q.y)}" r="3.5" fill="#4ade80"/>`).join('')}
    <text x="${p}" y="${p - 10}">${max.toFixed(1)}</text><text x="${p}" y="${H - 8}">${min.toFixed(1)}</text>
    <text x="${W - p}" y="${H - 8}" text-anchor="end">${new Date(pts.at(-1).t).toLocaleDateString('ru-RU')}</text>
    <text x="${p + 40}" y="${H - 8}">${new Date(pts[0].t).toLocaleDateString('ru-RU')}</text></svg>`;
}
function viewProgress() {
  const withData = S.exercises.filter(e => seriesFor(e).length);
  if (!withData.length) return '<h1>Прогресс</h1><div class="empty">Данных пока нет. Заверши хотя бы одну тренировку.</div>';
  if (!S.progressEx || !withData.some(e => e.id === S.progressEx)) S.progressEx = withData[0].id;
  const ex = exById(S.progressEx);
  const unit = ex.type === 'strength' ? 'оценка 1ПМ (формула Эпли), кг' : ex.type === 'bodyweight' ? 'макс. повторов за подход' : 'км за тренировку';
  return `<h1>Прогресс</h1>
    <select id="progSel">${withData.map(e => `<option value="${e.id}" ${e.id === S.progressEx ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
    <div class="card" style="margin-top:10px">${chart(seriesFor(ex))}<div class="mute">${unit}</div></div>`;
}
function viewExercises() {
  return `<h1>Упражнения</h1>
    <form class="card" data-form="addEx"><div class="row wrap">
      <input name="name" placeholder="Название" style="flex:2 1 160px" required>
      <select name="type" style="flex:1 1 110px">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <button class="primary" type="submit">Добавить</button></div></form>
    ${S.exercises.map(e => `<div class="card row spread"><span>${esc(e.name)} <span class="tag">${TYPES[e.type]}</span></span>
      <button class="small danger" data-a="delEx" data-id="${e.id}">✕</button></div>`).join('')}
    <h2>Данные</h2>
    <div class="card"><p class="mute" style="margin-top:0">Данные хранятся только в этом браузере. Делай экспорт — это резервная копия.</p>
      <div class="row wrap"><button data-a="expJSON">Экспорт JSON</button><button data-a="expCSV">Экспорт CSV</button>
      <label><button type="button" onclick="this.nextElementSibling.click()">Импорт JSON</button><input type="file" accept="application/json" hidden id="impFile"></label></div></div>`;
}

/* ====== Рендер и события ====== */
const TABS = [['train', '🏋️', 'Тренировка'], ['history', '📅', 'История'], ['progress', '📈', 'Прогресс'], ['ex', '⚙️', 'Упражнения']];
function render() {
  const views = { train: viewTrain, history: viewHistory, progress: viewProgress, ex: viewExercises };
  const y = window.scrollY;
  document.getElementById('app').innerHTML = views[S.tab]();
  document.getElementById('nav').innerHTML = TABS.map(([k, i, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}"><div style="font-size:20px">${i}</div>${l}</button>`).join('');
  window.scrollTo(0, y);
}
document.addEventListener('click', async ev => {
  const tab = ev.target.closest('[data-tab]');
  if (tab) { S.tab = tab.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const b = ev.target.closest('[data-a]'); if (!b) return;
  const card = b.closest('[data-ex]'); const exId = card && card.dataset.ex;
  switch (b.dataset.a) {
    case 'start': return startWorkout();
    case 'finish': return finishWorkout();
    case 'addEntry': S.adding = true; return render();
    case 'addEntryCancel': S.adding = false; return render();
    case 'addEntryOk': return addEntry(document.getElementById('addSel').value);
    case 'addSet': return addSet(exId, card);
    case 'delSet': return delSet(exId, +b.dataset.i);
    case 'delEntry': return delEntry(exId);
    case 'delWorkout': return delWorkout(b.dataset.id);
    case 'delEx': return delExercise(b.dataset.id);
    case 'expJSON': return exportJSON();
    case 'expCSV': return exportCSV();
  }
});
document.addEventListener('submit', ev => {
  const f = ev.target.closest('[data-form=addEx]');
  if (f) { ev.preventDefault(); addExercise(f); }
});
document.addEventListener('change', ev => {
  if (ev.target.id === 'progSel') { S.progressEx = ev.target.value; render(); }
  if (ev.target.id === 'impFile' && ev.target.files[0]) importJSON(ev.target.files[0]);
});

(async () => {
  db = await openDB();
  await load();
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
