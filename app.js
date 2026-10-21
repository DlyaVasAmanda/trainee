'use strict';
/* =========================================================
   Тренировки — PWA, данные в IndexedDB (только на устройстве)
   ========================================================= */

/* ---------- Хранилище ---------- */
const DB_NAME = 'workout-tracker';
const DB_VERSION = 2; // v1: exercises, workouts; v2: + templates, meta
const STORES = ['exercises', 'workouts', 'templates', 'meta'];
let db;

const openDB = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB_NAME, DB_VERSION);
  r.onupgradeneeded = () => {
    const d = r.result;
    if (!d.objectStoreNames.contains('exercises')) d.createObjectStore('exercises', { keyPath: 'id' });
    if (!d.objectStoreNames.contains('workouts')) d.createObjectStore('workouts', { keyPath: 'id' });
    if (!d.objectStoreNames.contains('templates')) d.createObjectStore('templates', { keyPath: 'id' });
    if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
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
const getOne = (s, k) => run(s, 'readonly', st => st.get(k));
const put = (s, v) => run(s, 'readwrite', st => st.put(v));
const del = (s, id) => run(s, 'readwrite', st => st.delete(id));
const clearStore = s => run(s, 'readwrite', st => st.clear());

/* ---------- Справочники ---------- */
const TYPES = { strength: 'Со штангой/гантелями', bodyweight: 'Свой вес', cardio: 'Кардио' };
const TYPE_SHORT = { strength: 'вес', bodyweight: 'свой вес', cardio: 'кардио' };
const GROUPS = {
  chest: 'Грудь', triceps: 'Трицепс', back: 'Спина', biceps: 'Бицепс',
  legs: 'Ноги', shoulders: 'Плечи', abs: 'Пресс', cardio: 'Кардио', other: 'Другое',
};
const gc = g => `var(--g-${GROUPS[g] ? g : 'other'})`;

// [название, тип, группа] — базовый сплит + кардио
const SEED_EX = [
  ['Жим лёжа', 'strength', 'chest'], ['Жим гантелей на наклонной', 'strength', 'chest'],
  ['Разводка гантелей', 'strength', 'chest'], ['Кроссовер', 'strength', 'chest'],
  ['Отжимания на брусьях', 'bodyweight', 'chest'], ['Отжимания', 'bodyweight', 'chest'],
  ['Французский жим', 'strength', 'triceps'], ['Разгибания на блоке', 'strength', 'triceps'],
  ['Жим узким хватом', 'strength', 'triceps'], ['Обратные отжимания от скамьи', 'bodyweight', 'triceps'],
  ['Подтягивания', 'bodyweight', 'back'], ['Тяга штанги в наклоне', 'strength', 'back'],
  ['Тяга верхнего блока', 'strength', 'back'], ['Тяга гантели одной рукой', 'strength', 'back'],
  ['Тяга горизонтального блока', 'strength', 'back'], ['Становая тяга', 'strength', 'back'],
  ['Подъём штанги на бицепс', 'strength', 'biceps'], ['Молотки', 'strength', 'biceps'],
  ['Подъём гантелей на наклонной', 'strength', 'biceps'], ['Концентрированный подъём', 'strength', 'biceps'],
  ['Приседания со штангой', 'strength', 'legs'], ['Жим ногами', 'strength', 'legs'],
  ['Румынская тяга', 'strength', 'legs'], ['Выпады с гантелями', 'strength', 'legs'],
  ['Сгибания ног в тренажёре', 'strength', 'legs'], ['Подъём на носки', 'strength', 'legs'],
  ['Жим стоя', 'strength', 'shoulders'], ['Жим гантелей сидя', 'strength', 'shoulders'],
  ['Махи в стороны', 'strength', 'shoulders'], ['Махи в наклоне', 'strength', 'shoulders'],
  ['Тяга к подбородку', 'strength', 'shoulders'],
  ['Пресс', 'bodyweight', 'abs'], ['Подъём ног в висе', 'bodyweight', 'abs'],
  ['Бег', 'cardio', 'cardio'], ['Велосипед', 'cardio', 'cardio'], ['Ходьба', 'cardio', 'cardio'],
  ['Плавание', 'cardio', 'cardio'], ['Эллипс', 'cardio', 'cardio'],
];
const SEED_GROUP = Object.fromEntries(SEED_EX.map(([n, , g]) => [n, g]));

// Классический сплит на 3 дня: [название, [[упражнение, подходы, повторы]], день недели (0 = Пн)]
const SEED_TPL = [
  ['Грудь + трицепс', [['Жим лёжа', 4, 8], ['Жим гантелей на наклонной', 3, 10], ['Разводка гантелей', 3, 12],
    ['Отжимания на брусьях', 3, 10], ['Французский жим', 3, 10], ['Разгибания на блоке', 3, 12]], 0],
  ['Спина + бицепс', [['Подтягивания', 4, 8], ['Тяга штанги в наклоне', 4, 8], ['Тяга верхнего блока', 3, 10],
    ['Тяга гантели одной рукой', 3, 10], ['Подъём штанги на бицепс', 3, 10], ['Молотки', 3, 12]], 2],
  ['Ноги + плечи', [['Приседания со штангой', 4, 8], ['Жим ногами', 3, 12], ['Румынская тяга', 3, 10],
    ['Подъём на носки', 4, 15], ['Жим стоя', 4, 8], ['Махи в стороны', 3, 15], ['Махи в наклоне', 3, 15]], 4],
];

const DOW = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DOW_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

/* ---------- Состояние ---------- */
const S = {
  exercises: [], workouts: [], templates: [], plan: { key: 'plan', days: Array(7).fill(null) },
  tab: 'today', selDay: null, adding: false, editTpl: null, progressEx: null, spin: true,
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2));
const exById = id => S.exercises.find(e => e.id === id);
const tplById = id => S.templates.find(t => t.id === id);
const active = () => S.workouts.find(w => !w.finished);
const finished = () => S.workouts.filter(w => w.finished).sort((a, b) => b.start - a.start);
const sortEx = () => S.exercises.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

async function load() {
  S.exercises = await getAll('exercises');
  S.workouts = await getAll('workouts');
  S.templates = await getAll('templates');
  S.plan = (await getOne('meta', 'plan')) || { key: 'plan', days: Array(7).fill(null) };
  const seed = (await getOne('meta', 'seedV')) || { key: 'seedV', v: 0 };
  if (seed.v < 2) await migrate();
  sortEx();
  S.templates.sort((a, b) => (a.created || 0) - (b.created || 0) || a.name.localeCompare(b.name, 'ru'));
}

// v1 → v2: группы мышц у старых упражнений, новые упражнения сплита, шаблоны и план недели
async function migrate() {
  const names = new Set(S.exercises.map(e => e.name));
  for (const e of S.exercises) {
    if (!e.group) { e.group = SEED_GROUP[e.name] || (e.type === 'cardio' ? 'cardio' : 'other'); await put('exercises', e); }
  }
  for (const [name, type, group] of SEED_EX) {
    if (names.has(name)) continue;
    const e = { id: uid(), name, type, group };
    S.exercises.push(e); await put('exercises', e);
  }
  if (!S.templates.length) {
    const byName = n => S.exercises.find(e => e.name === n);
    const days = Array(7).fill(null);
    for (const [k, [name, items, day]] of SEED_TPL.entries()) {
      const t = { id: uid(), created: Date.now() + k, name, items: items.filter(([n]) => byName(n)).map(([n, sets, reps]) => ({ exId: byName(n).id, sets, reps })) };
      S.templates.push(t); await put('templates', t);
      days[day] = t.id;
    }
    S.plan = { key: 'plan', days }; await put('meta', S.plan);
  }
  await put('meta', { key: 'seedV', v: 2 });
}

/* ---------- Даты ---------- */
const dowOf = t => (new Date(t).getDay() + 6) % 7;
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d; };
const weekStart = () => { const d = startOfDay(Date.now()); d.setDate(d.getDate() - dowOf(d)); return d; };
const dayDate = i => { const d = weekStart(); d.setDate(d.getDate() + i); return d; };
const sameDay = (a, b) => startOfDay(a).getTime() === startOfDay(b).getTime();
const longDate = t => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
const shortDate = t => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const mins = w => Math.max(1, Math.round(((w.end || Date.now()) - w.start) / 60000));

/* ---------- Утилиты ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const fmtN = n => (Math.round(n * 10) / 10).toString().replace('.', ',');
const plural = (n, one, few, many) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many; };
const fmtSet = (type, s) =>
  type === 'strength' ? `${fmtN(s.w)} кг × ${s.r}` :
  type === 'bodyweight' ? `${s.r} повт.` + (s.w ? ` +${fmtN(s.w)} кг` : '') :
  `${fmtN(s.km)} км, ${fmtN(s.min)} мин` + (s.km && s.min ? `, ${fmtN(s.min / s.km)} мин/км` : '');
const fmtTarget = (type, it) => type === 'cardio' ? `${it.reps} мин` : `${it.sets}×${it.reps}`;
const lastFor = exId => {
  for (const w of finished()) { const e = w.entries.find(e => e.exId === exId); if (e && e.sets.length) return e; }
  return null;
};
const volume = w => w.entries.reduce((a, e) => exById(e.exId)?.type === 'strength' ? a + e.sets.reduce((b, s) => b + s.w * s.r, 0) : a, 0);
const setCount = w => w.entries.reduce((a, e) => a + e.sets.length, 0);

// Группы с весами (по числу упражнений) → conic-gradient блина
function groupWeights(exIds) {
  const m = new Map();
  for (const id of exIds) { const g = exById(id)?.group || 'other'; m.set(g, (m.get(g) || 0) + 1); }
  return [...m.entries()];
}
function plateStyle(weights) {
  const total = weights.reduce((a, [, n]) => a + n, 0);
  if (!total) return '';
  let acc = 0;
  const seg = weights.map(([g, n]) => { const a = acc / total * 100; acc += n; return `${gc(g)} ${a.toFixed(2)}% ${(acc / total * 100).toFixed(2)}%`; });
  return `background:conic-gradient(${seg.join(',')})`;
}
const plate = (weights, cls = '', mark = '') => weights.length
  ? `<div class="plate ${cls}" style="${plateStyle(weights)}">${mark ? `<span class="mark">${mark}</span>` : ''}</div>`
  : `<div class="plate rest ${cls}">${mark ? `<span class="mark">${mark}</span>` : ''}</div>`;
const tplWeights = t => groupWeights(t.items.map(i => i.exId));
const wWeights = w => groupWeights(w.entries.map(e => e.exId));

const ICON = {
  today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.5" cy="6.5" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="17.5" r="1" fill="currentColor"/></svg>',
  progress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 17l5.5-5.5 4 4 7.5-8"/><path d="M15.5 7.5h5v5"/></svg>',
  ex: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

/* ---------- Действия: тренировка ---------- */
const saveW = w => put('workouts', w);
async function startWorkout(tplId) {
  if (active()) return;
  const t = tplId ? tplById(tplId) : null;
  const w = {
    id: uid(), start: Date.now(), finished: false, templateId: t ? t.id : null, title: t ? t.name : 'Свободная тренировка',
    entries: t ? t.items.filter(i => exById(i.exId)).map(i => ({ exId: i.exId, sets: [], target: { sets: i.sets, reps: i.reps } })) : [],
  };
  S.workouts.push(w); await saveW(w); S.adding = !t; render(true);
}
async function finishWorkout() {
  const w = active(); if (!w) return;
  w.entries = w.entries.filter(e => e.sets.length);
  if (!w.entries.length) {
    if (!confirm('Нет ни одного подхода — тренировка не сохранится. Завершить?')) return;
    await del('workouts', w.id); S.workouts = S.workouts.filter(x => x !== w);
  } else { w.finished = true; w.end = Date.now(); await saveW(w); }
  S.adding = false; S.selDay = null; render(true);
}
async function discardWorkout() {
  const w = active(); if (!w || !confirm('Отменить тренировку? Записанные подходы удалятся.')) return;
  await del('workouts', w.id); S.workouts = S.workouts.filter(x => x !== w); S.adding = false; render(true);
}
async function addEntry(exId) {
  const w = active(); if (!w || !exId) return;
  if (!w.entries.some(e => e.exId === exId)) w.entries.push({ exId, sets: [] });
  S.adding = false; await saveW(w); render();
}
async function addSet(exId, card) {
  const w = active(), ex = exById(exId), e = w.entries.find(e => e.exId === exId);
  const v = n => num(card.querySelector(`[name=${n}]`)?.value);
  let s;
  if (ex.type === 'strength') { const wt = v('w'), r = v('r'); if (wt == null || !r) return shake(card); s = { w: wt, r }; }
  else if (ex.type === 'bodyweight') { const r = v('r'); if (!r) return shake(card); s = { r, w: v('w') || 0 }; }
  else { const km = v('km'), min = v('min'); if (km == null || !min) return shake(card); s = { km, min }; }
  e.sets.push(s); await saveW(w); render();
}
const shake = el => { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); };
async function delSet(exId, i) { const w = active(); w.entries.find(e => e.exId === exId).sets.splice(i, 1); await saveW(w); render(); }
async function delEntry(exId) { const w = active(); w.entries = w.entries.filter(e => e.exId !== exId); await saveW(w); render(); }
async function delWorkout(id) {
  if (!confirm('Удалить тренировку из истории?')) return;
  await del('workouts', id); S.workouts = S.workouts.filter(w => w.id !== id); render();
}

/* ---------- Действия: план и шаблоны ---------- */
async function setPlanDay(day, tplId) { S.plan.days[day] = tplId || null; await put('meta', S.plan); render(); }
async function newTemplate() {
  const t = { id: uid(), created: Date.now(), name: 'Новый шаблон', items: [] };
  S.templates.push(t); await put('templates', t); S.editTpl = t.id; render();
  document.querySelector('[data-tpl-name]')?.select();
}
async function deleteTemplate(id) {
  const t = tplById(id);
  if (!confirm(`Удалить шаблон «${t.name}»? Он пропадёт из плана недели.`)) return;
  await del('templates', id); S.templates = S.templates.filter(x => x.id !== id);
  S.plan.days = S.plan.days.map(d => d === id ? null : d); await put('meta', S.plan);
  S.editTpl = null; render();
}
async function tplAddEx(id, exId) {
  const t = tplById(id); if (!exId) return;
  const cardio = exById(exId)?.type === 'cardio';
  t.items.push({ exId, sets: cardio ? 1 : 3, reps: cardio ? 30 : 10 }); await put('templates', t); render();
}
async function tplRemoveItem(id, i) { const t = tplById(id); t.items.splice(i, 1); await put('templates', t); render(); }
async function tplMoveItem(id, i, d) {
  const t = tplById(id), j = i + d; if (j < 0 || j >= t.items.length) return;
  [t.items[i], t.items[j]] = [t.items[j], t.items[i]]; await put('templates', t); render();
}

/* ---------- Действия: упражнения ---------- */
async function addExercise(form) {
  const name = form.querySelector('[name=name]').value.trim();
  if (!name) return shake(form);
  if (S.exercises.some(e => e.name.toLowerCase() === name.toLowerCase())) { alert('Такое упражнение уже есть'); return; }
  const e = { id: uid(), name, type: form.querySelector('[name=type]').value, group: form.querySelector('[name=group]').value };
  await put('exercises', e); S.exercises.push(e); sortEx(); render();
}
async function delExercise(id) {
  const used = S.workouts.some(w => w.entries.some(e => e.exId === id));
  const ex = exById(id);
  if (!confirm(used ? `«${ex.name}» есть в истории. Удалить? В истории оно станет «удалено».` : `Удалить «${ex.name}»?`)) return;
  await del('exercises', id); S.exercises = S.exercises.filter(e => e.id !== id);
  for (const t of S.templates) if (t.items.some(i => i.exId === id)) { t.items = t.items.filter(i => i.exId !== id); await put('templates', t); }
  render();
}

/* ---------- Экспорт / импорт ---------- */
function exportJSON() {
  const data = { v: 2, exportedAt: new Date().toISOString(), exercises: S.exercises, workouts: S.workouts, templates: S.templates, plan: S.plan };
  download(`trainee-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
}
function exportCSV() {
  const rows = [['date', 'workout', 'exercise', 'group', 'type', 'set', 'weight_kg', 'reps', 'distance_km', 'minutes']];
  for (const w of finished().reverse()) for (const e of w.entries) {
    const ex = exById(e.exId);
    e.sets.forEach((s, i) => rows.push([new Date(w.start).toISOString().slice(0, 10), w.title || '', ex ? ex.name : 'удалено',
      ex ? GROUPS[ex.group] || '' : '', ex ? ex.type : '', i + 1, s.w ?? '', s.r ?? '', s.km ?? '', s.min ?? '']));
  }
  download('trainee.csv', '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
async function importJSON(file) {
  let d;
  try { d = JSON.parse(await file.text()); if (!Array.isArray(d.exercises) || !Array.isArray(d.workouts)) throw 0; }
  catch { alert('Файл не похож на резервную копию трекера (нужен JSON из «Экспорт JSON»).'); return; }
  if (!confirm('Импорт заменит все текущие данные. Продолжить?')) return;
  for (const s of STORES) await clearStore(s);
  for (const e of d.exercises) await put('exercises', e);
  for (const w of d.workouts) await put('workouts', w);
  for (const t of d.templates || []) await put('templates', t);
  if (d.plan) await put('meta', { ...d.plan, key: 'plan' });
  await put('meta', { key: 'seedV', v: d.v >= 2 ? 2 : 1 }); // старый формат → догоним миграцией
  await load(); render(true);
}

/* =========================================================
   Экраны
   ========================================================= */
function exOptions(excludeIds = []) {
  return Object.keys(GROUPS).map(g => {
    const list = S.exercises.filter(e => e.group === g && !excludeIds.includes(e.id));
    return list.length ? `<optgroup label="${GROUPS[g]}">${list.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</optgroup>` : '';
  }).join('');
}

/* --- Сегодня --- */
function weekStrip(sel) {
  const today = dowOf(Date.now());
  const done = finished();
  return `<div class="week" role="tablist" aria-label="Неделя">${DOW.map((d, i) => {
    const date = dayDate(i);
    const t = tplById(S.plan.days[i]);
    const dw = done.filter(w => sameDay(w.start, date));
    const weights = t ? tplWeights(t) : dw.length ? wWeights(dw[0]) : [];
    const cls = ['day', i === sel && 'sel', i === today && 'today', i < today && 'past', dw.length && 'done'].filter(Boolean).join(' ');
    return `<button class="${cls}" data-day="${i}" role="tab" aria-selected="${i === sel}" aria-label="${DOW_FULL[i]}${t ? ', ' + esc(t.name) : ', отдых'}${dw.length ? ', выполнено' : ''}">
      <span class="d">${d}</span>${plate(weights, '', dw.length ? '✓' : '')}<span class="n">${date.getDate()}</span></button>`;
  }).join('')}</div>`;
}

function viewToday() {
  const w = active();
  if (w) return viewActive(w);
  const today = dowOf(Date.now());
  const sel = S.selDay ?? today;
  const date = dayDate(sel);
  const t = tplById(S.plan.days[sel]);
  const dw = finished().filter(x => sameDay(x.start, date));
  const label = sel === today ? 'Сегодня' : DOW_FULL[sel];
  const spin = S.spin ? 'spin' : '';

  let body;
  if (t) {
    const weights = tplWeights(t);
    body = `<div class="hero">${plate(weights, 'big ' + spin)}
        <div><div class="mute small">${label}, ${longDate(date)}</div><h2>${esc(t.name)}</h2>
        <div class="chips">${weights.map(([g]) => `<span class="chip"><span class="dot" style="--c:${gc(g)}"></span>${GROUPS[g]}</span>`).join('')}</div></div></div>
      <div class="plan-rows">${t.items.map(it => { const ex = exById(it.exId); return ex ? `<div class="plan-row">
        <span class="dot" style="--c:${gc(ex.group)}"></span><span>${esc(ex.name)}</span><span class="target">${fmtTarget(ex.type, it)}</span></div>` : ''; }).join('')}
        ${t.items.length ? '' : '<p class="mute small">В шаблоне нет упражнений. Добавь их на вкладке «План».</p>'}</div>
      <div class="stack" style="margin-top:18px">
        <button class="btn primary big block" data-a="start" data-id="${t.id}">${sel === today ? 'Начать тренировку' : 'Начать сейчас'}</button>
      </div>`;
  } else {
    body = `<div class="hero">${plate([], 'big ' + spin)}
        <div><div class="mute small">${label}, ${longDate(date)}</div><h2>День отдыха</h2>
        <p class="mute small">Восстановление — тоже часть плана. Можно поменять день на вкладке «План».</p></div></div>`;
  }
  if (dw.length) body += dw.map(x => `<div class="done-note"><span class="dot" style="--c:var(--g-shoulders)"></span>
      Выполнено: ${esc(x.title || 'тренировка')}, ${setCount(x)} ${plural(setCount(x), 'подход', 'подхода', 'подходов')}, ${mins(x)} мин</div>`).join('');

  return `<header class="head"><div><h1>${DOW_FULL[today]}</h1><div class="sub">${longDate(Date.now())}</div></div></header>
    ${weekStrip(sel)}
    <section class="sheet">${body}</section>
    <button class="btn ghost block" style="margin-top:8px" data-a="start">Свободная тренировка</button>`;
}

/* --- Активная тренировка --- */
function viewActive(w) {
  const taken = w.entries.map(e => e.exId);
  return `<header class="head"><div><h1>${esc(w.title || 'Тренировка')}</h1>
      <div class="sub live">Идёт <span id="elapsed">${mins(w)} мин</span></div></div></header>
    <div class="stack">${w.entries.map(entryCard).join('')}</div>
    <div style="margin-top:10px">${S.adding
      ? `<div class="sheet" style="padding:14px"><div class="add-row"><select id="addSel" aria-label="Упражнение"><option value="">Выбери упражнение</option>${exOptions(taken)}</select>
          <button class="btn primary" style="border-radius:var(--r-sm);height:46px" data-a="addEntryOk">Добавить</button></div>
          <button class="btn ghost sm" style="margin-top:6px" data-a="addEntryCancel">Отмена</button></div>`
      : `<button class="btn block" data-a="addEntry">Добавить упражнение</button>`}</div>
    <div class="stack" style="margin-top:22px">
      <button class="btn primary big block" data-a="finish">Завершить тренировку</button>
      <button class="btn ghost danger block" data-a="discard">Отменить</button>
    </div>`;
}
function entryCard(e) {
  const ex = exById(e.exId); if (!ex) return '';
  const prev = lastFor(e.exId);
  const seed = e.sets.at(-1) || prev?.sets[0] || {};
  const val = v => v != null && v !== 0 ? `value="${v}"` : '';
  const inputs = ex.type === 'strength'
    ? `<input name="w" inputmode="decimal" placeholder="кг" aria-label="Вес, кг" ${val(seed.w)}><input name="r" inputmode="numeric" placeholder="повторы" aria-label="Повторы" ${val(seed.r ?? e.target?.reps)}>`
    : ex.type === 'bodyweight'
    ? `<input name="r" inputmode="numeric" placeholder="повторы" aria-label="Повторы" ${val(seed.r ?? e.target?.reps)}><input name="w" inputmode="decimal" placeholder="+кг" aria-label="Доп. вес, кг" ${val(seed.w)}>`
    : `<input name="km" inputmode="decimal" placeholder="км" aria-label="Дистанция, км" ${val(seed.km)}><input name="min" inputmode="decimal" placeholder="мин" aria-label="Время, мин" ${val(seed.min ?? e.target?.reps)}>`;
  const complete = e.target && ex.type !== 'cardio' ? e.sets.length >= e.target.sets : e.target && e.sets.length > 0;
  const meta = [e.target && `Цель: ${fmtTarget(ex.type, e.target)}`, prev && `Прошлый раз: ${prev.sets.map(s => fmtSet(ex.type, s)).join(' / ')}`]
    .filter(Boolean).map(esc).join('<br>');
  return `<div class="entry ${complete ? 'complete' : ''}" data-ex="${e.exId}" style="--c:${gc(ex.group)}">
    <div class="entry-head"><b style="flex:1">${esc(ex.name)}</b><button class="icon-btn" data-a="delEntry" aria-label="Убрать упражнение">${ICON.x}</button></div>
    ${meta ? `<div class="meta">${meta}</div>` : ''}
    ${e.sets.length ? `<div class="sets">${e.sets.map((s, i) => `<div class="set-row"><span class="i">${i + 1}</span><span class="v">${fmtSet(ex.type, s)}</span>
      <button class="icon-btn" data-a="delSet" data-i="${i}" aria-label="Удалить подход">${ICON.x}</button></div>`).join('')}</div>` : ''}
    <div class="set-input">${inputs}<button class="btn primary" data-a="addSet" aria-label="Записать подход">+</button></div>
  </div>`;
}

/* --- План --- */
function viewPlan() {
  const today = dowOf(Date.now());
  const tplOpts = sel => `<option value="">Отдых</option>` + S.templates.map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  const sets = S.plan.days.reduce((a, id) => a + (tplById(id)?.items.reduce((b, i) => b + i.sets, 0) || 0), 0);
  const trainDays = S.plan.days.filter(id => tplById(id)).length;
  return `<header class="head"><div><h1>План недели</h1>
      <div class="sub">${trainDays} ${plural(trainDays, 'тренировка', 'тренировки', 'тренировок')}, ${sets} ${plural(sets, 'подход', 'подхода', 'подходов')} по плану</div></div></header>
    <div class="list">${DOW_FULL.map((d, i) => {
      const t = tplById(S.plan.days[i]);
      return `<div class="item">${plate(t ? tplWeights(t) : [])}
        <div class="grow"><div style="font-weight:${i === today ? 700 : 500}">${d}${i === today ? ' <span class="tag">сегодня</span>' : ''}</div></div>
        <select class="plan-select" data-plan-day="${i}" aria-label="Тренировка на ${d}">${tplOpts(S.plan.days[i])}</select></div>`;
    }).join('')}</div>

    <div class="section"><div class="section-head"><h2>Шаблоны</h2><button class="btn sm" data-a="tplNew">Новый шаблон</button></div>
    <div class="stack">${S.templates.length ? S.templates.map(tplCard).join('') : '<div class="empty">Шаблонов нет. Создай первый — например, «Грудь + трицепс».</div>'}</div></div>`;
}
function tplCard(t) {
  const open = S.editTpl === t.id;
  const head = `<button class="item" style="width:100%;background:none;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer" data-a="tplToggle" data-id="${t.id}" aria-expanded="${open}">
      ${plate(tplWeights(t))}<div class="grow"><div style="font-weight:600">${esc(t.name)}</div>
      <div class="mute small">${t.items.length} ${plural(t.items.length, 'упражнение', 'упражнения', 'упражнений')}</div></div>
      <span class="mute small">${open ? 'Свернуть' : 'Изменить'}</span></button>`;
  if (!open) return `<div class="list">${head}</div>`;
  return `<div class="list">${head}<div style="padding:4px 16px 16px">
    <input data-tpl-name="${t.id}" value="${esc(t.name)}" aria-label="Название шаблона" style="margin:8px 0 6px;font-weight:600">
    ${t.items.map((it, i) => { const ex = exById(it.exId); if (!ex) return ''; const c = ex.type === 'cardio'; return `<div class="tpl-item">
      <span class="dot" style="--c:${gc(ex.group)}"></span>
      <button class="name" data-a="tplUp" data-id="${t.id}" data-i="${i}" title="Поднять выше">${esc(ex.name)}</button>
      <div class="ctl">${c ? '<span></span><span class="x small">мин</span>' : `<input data-tpl="${t.id}" data-i="${i}" data-k="sets" inputmode="numeric" value="${it.sets}" aria-label="Подходы"><span class="x">×</span>`}
      <input data-tpl="${t.id}" data-i="${i}" data-k="reps" inputmode="numeric" value="${it.reps}" aria-label="${c ? 'Минуты' : 'Повторы'}">
      <button class="icon-btn" style="width:32px;height:32px" data-a="tplRm" data-id="${t.id}" data-i="${i}" aria-label="Убрать">${ICON.x}</button></div></div>`; }).join('')}
    <p class="mute small" style="margin-top:6px">Подходы × повторы, для кардио — минуты. Нажми на название, чтобы поднять упражнение выше.</p>
    <div class="add-row"><select data-tpl-add="${t.id}" aria-label="Добавить упражнение"><option value="">Добавить упражнение</option>${exOptions(t.items.map(i => i.exId))}</select>
      <button class="btn" style="border-radius:var(--r-sm);height:46px" data-a="tplAdd" data-id="${t.id}">Добавить</button></div>
    <button class="btn ghost danger sm" style="margin-top:12px" data-a="tplDel" data-id="${t.id}">Удалить шаблон</button>
  </div></div>`;
}

/* --- История --- */
function streakWeeks(list) {
  const wk = t => { const d = startOfDay(t); d.setDate(d.getDate() - dowOf(d)); return d.getTime(); };
  const set = new Set(list.map(w => wk(w.start)));
  const d = new Date(wk(Date.now())); let n = 0;
  if (!set.has(d.getTime())) d.setDate(d.getDate() - 7); // текущая неделя ещё может быть пустой
  while (set.has(d.getTime())) { n++; d.setDate(d.getDate() - 7); }
  return n;
}
function viewHistory() {
  const list = finished();
  const week = list.filter(w => w.start >= weekStart().getTime()).length;
  const streak = streakWeeks(list);
  return `<header class="head"><h1>История</h1></header>
    <div class="stats">
      <div class="stat"><span class="num">${list.length}</span><span>всего</span></div>
      <div class="stat"><span class="num">${week}</span><span>на этой неделе</span></div>
      <div class="stat"><span class="num">${streak}</span><span>${plural(streak, 'неделя', 'недели', 'недель')} подряд</span></div></div>
    <div class="stack" style="margin-top:12px">${list.length ? list.map(workoutCard).join('')
      : '<div class="empty">Здесь появятся завершённые тренировки.<br><button class="btn primary" data-tab="today">Перейти к сегодняшней</button></div>'}</div>`;
}
function workoutCard(w) {
  const vol = volume(w);
  return `<div class="list"><div class="item">${plate(wWeights(w))}
      <div class="grow"><div style="font-weight:600">${esc(w.title || 'Тренировка')}</div>
      <div class="mute small">${shortDate(w.start)}, ${mins(w)} мин${vol ? `, объём ${Math.round(vol).toLocaleString('ru-RU')} кг` : ''}</div></div>
      <button class="icon-btn" data-a="delWorkout" data-id="${w.id}" aria-label="Удалить тренировку">${ICON.x}</button></div>
    ${w.entries.map(e => { const ex = exById(e.exId); return `<div class="item" style="align-items:flex-start;min-height:0;padding:10px 16px">
      <span class="dot" style="--c:${gc(ex?.group)};margin-top:7px"></span><div class="grow"><div>${ex ? esc(ex.name) : 'удалено'}</div>
      <div class="mute small">${e.sets.map(s => fmtSet(ex ? ex.type : 'strength', s)).join(' / ')}</div></div></div>`; }).join('')}</div>`;
}

/* --- Прогресс --- */
function seriesFor(ex) {
  const pts = [];
  for (const w of finished().reverse()) {
    const e = w.entries.find(e => e.exId === ex.id); if (!e || !e.sets.length) continue;
    const y = ex.type === 'strength' ? Math.max(...e.sets.map(s => s.r === 1 ? s.w : s.w * (1 + s.r / 30))) // 1ПМ по Эпли
      : ex.type === 'bodyweight' ? Math.max(...e.sets.map(s => s.r))
      : e.sets.reduce((a, s) => a + s.km, 0);
    pts.push({ t: w.start, y });
  }
  return pts;
}
function chart(pts, color) {
  if (pts.length < 2) return '<div class="empty">Нужно минимум две тренировки с этим упражнением.</div>';
  const W = 600, H = 220, px = 34, py = 24;
  const ys = pts.map(p => p.y), min = Math.min(...ys), max = Math.max(...ys), span = max - min || 1;
  const X = i => px + i * (W - 2 * px) / (pts.length - 1);
  const Y = y => H - py - (y - min) / span * (H - 2 * py);
  const line = pts.map((q, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(q.y).toFixed(1)}`).join(' ');
  const area = `${line} L${X(pts.length - 1).toFixed(1)},${H - py} L${px},${H - py} Z`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="График прогресса">
    <path d="${area}" fill="${color}" opacity=".12"/>
    <line x1="${px}" y1="${H - py}" x2="${W - px}" y2="${H - py}" stroke="var(--line)"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map((q, i) => `<circle cx="${X(i)}" cy="${Y(q.y)}" r="4.5" fill="var(--surface)" stroke="${color}" stroke-width="2.5"/>`).join('')}
    <text x="${X(0)}" y="${Y(pts[0].y) - 12}" style="fill:var(--ink);font-weight:600">${fmtN(pts[0].y)}</text>
    <text x="${X(pts.length - 1)}" y="${Y(pts.at(-1).y) - 12}" text-anchor="end" style="fill:var(--ink);font-weight:600">${fmtN(pts.at(-1).y)}</text>
    <text x="${px}" y="${H - 4}">${shortDate(pts[0].t)}</text><text x="${W - px}" y="${H - 4}" text-anchor="end">${shortDate(pts.at(-1).t)}</text></svg>`;
}
function viewProgress() {
  const since = Date.now() - 7 * 864e5;
  const counts = new Map();
  for (const w of finished()) if (w.start >= since) for (const e of w.entries) {
    const g = exById(e.exId)?.group || 'other'; counts.set(g, (counts.get(g) || 0) + e.sets.length);
  }
  const bars = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const maxC = Math.max(1, ...bars.map(b => b[1]));
  const withData = S.exercises.filter(e => seriesFor(e).length);
  if (withData.length && !withData.some(e => e.id === S.progressEx)) S.progressEx = withData[0].id;
  const ex = exById(S.progressEx);
  const unit = !ex ? '' : ex.type === 'strength' ? 'Оценка 1ПМ по формуле Эпли, кг' : ex.type === 'bodyweight' ? 'Максимум повторов за подход' : 'Километров за тренировку';
  return `<header class="head"><h1>Прогресс</h1></header>
    <section class="sheet"><h3>Подходы по группам за 7 дней</h3>
      <div style="margin-top:10px">${bars.length ? bars.map(([g, n]) => `<div class="bar-row"><span>${GROUPS[g]}</span>
        <div class="bar" style="--c:${gc(g)};width:${(n / maxC * 100).toFixed(1)}%"></div><span class="num" style="font-size:17px">${n}</span></div>`).join('')
        : '<p class="mute small">За последние 7 дней тренировок не было.</p>'}</div></section>
    <section class="sheet" style="margin-top:12px"><h3>Упражнение</h3>
      ${withData.length ? `<select id="progSel" style="margin:10px 0" aria-label="Упражнение">${withData.map(e => `<option value="${e.id}" ${e.id === S.progressEx ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
        ${chart(seriesFor(ex), gc(ex.group))}<p class="mute small">${unit}</p>`
        : '<p class="mute small" style="margin-top:8px">Заверши хотя бы одну тренировку, и здесь появится график.</p>'}</section>`;
}

/* --- Упражнения --- */
function viewExercises() {
  return `<header class="head"><h1>Упражнения</h1></header>
    <form class="sheet" data-form="addEx" style="padding:14px"><div class="stack">
      <input name="name" placeholder="Название нового упражнения" aria-label="Название">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <select name="group" aria-label="Группа мышц">${Object.entries(GROUPS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <select name="type" aria-label="Тип">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <button class="btn primary" type="submit">Добавить упражнение</button></div></form>
    ${Object.keys(GROUPS).map(g => {
      const list = S.exercises.filter(e => (e.group || 'other') === g);
      return list.length ? `<div class="section" style="margin-top:22px"><div class="section-head" style="justify-content:flex-start;gap:10px">
        <span class="dot" style="--c:${gc(g)};width:14px;height:14px"></span><h3>${GROUPS[g]}</h3><span class="mute small">${list.length}</span></div>
        <div class="list">${list.map(e => `<div class="item" style="min-height:50px;padding:8px 8px 8px 16px"><span class="grow">${esc(e.name)}</span>
          <span class="tag">${TYPE_SHORT[e.type]}</span><button class="icon-btn" data-a="delEx" data-id="${e.id}" aria-label="Удалить ${esc(e.name)}">${ICON.x}</button></div>`).join('')}</div></div>` : '';
    }).join('')}
    <div class="section"><h3>Резервная копия</h3>
      <p class="mute small" style="margin:6px 0 10px">Данные хранятся только в этом браузере. Сохраняй JSON раз в неделю, чтобы не потерять историю.</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px"><button class="btn sm" data-a="expJSON">Экспорт JSON</button><button class="btn sm" data-a="expCSV">Экспорт CSV</button>
        <button class="btn sm" data-a="imp">Импорт JSON</button><input type="file" accept="application/json,.json" hidden id="impFile"></div></div>`;
}

/* =========================================================
   Рендер и события
   ========================================================= */
const TABS = [['today', 'Сегодня'], ['plan', 'План'], ['history', 'История'], ['progress', 'Прогресс'], ['ex', 'Упражнения']];
const VIEWS = { today: viewToday, plan: viewPlan, history: viewHistory, progress: viewProgress, ex: viewExercises };
function render(spin = false) {
  S.spin = spin;
  const y = window.scrollY;
  document.getElementById('app').innerHTML = VIEWS[S.tab]();
  const rec = !!active();
  document.getElementById('nav').innerHTML = TABS.map(([k, l]) =>
    `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''} ${k === 'today' && rec ? 'rec' : ''}" ${S.tab === k ? 'aria-current="page"' : ''}>${ICON[k]}${l}</button>`).join('');
  if (!spin) window.scrollTo(0, y);
}

document.addEventListener('click', ev => {
  const tab = ev.target.closest('[data-tab]');
  if (tab) { S.tab = tab.dataset.tab; render(S.tab === 'today'); window.scrollTo(0, 0); return; }
  const day = ev.target.closest('[data-day]');
  if (day) { S.selDay = +day.dataset.day; render(true); return; }
  const b = ev.target.closest('[data-a]'); if (!b) return;
  const card = b.closest('[data-ex]'); const exId = card && card.dataset.ex;
  const id = b.dataset.id, i = +b.dataset.i;
  ({
    start: () => startWorkout(id),
    finish: finishWorkout,
    discard: discardWorkout,
    addEntry: () => { S.adding = true; render(); document.getElementById('addSel')?.focus(); },
    addEntryCancel: () => { S.adding = false; render(); },
    addEntryOk: () => addEntry(document.getElementById('addSel').value),
    addSet: () => addSet(exId, card),
    delSet: () => delSet(exId, i),
    delEntry: () => delEntry(exId),
    delWorkout: () => delWorkout(id),
    tplNew: newTemplate,
    tplToggle: () => { S.editTpl = S.editTpl === id ? null : id; render(); },
    tplDel: () => deleteTemplate(id),
    tplAdd: () => tplAddEx(id, document.querySelector(`[data-tpl-add="${id}"]`).value),
    tplRm: () => tplRemoveItem(id, i),
    tplUp: () => tplMoveItem(id, i, -1),
    delEx: () => delExercise(id),
    expJSON: exportJSON,
    expCSV: exportCSV,
    imp: () => document.getElementById('impFile').click(),
  })[b.dataset.a]?.();
});

// Enter в поле подхода = «+»
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Enter') return;
  const card = ev.target.closest('.set-input') && ev.target.closest('[data-ex]');
  if (card) { ev.preventDefault(); addSet(card.dataset.ex, card); }
});
document.addEventListener('submit', ev => {
  const f = ev.target.closest('[data-form=addEx]');
  if (f) { ev.preventDefault(); addExercise(f); }
});
document.addEventListener('change', async ev => {
  const el = ev.target;
  if (el.id === 'progSel') { S.progressEx = el.value; render(); }
  else if (el.id === 'impFile' && el.files[0]) importJSON(el.files[0]);
  else if (el.dataset.planDay != null) setPlanDay(+el.dataset.planDay, el.value);
  else if (el.dataset.tplName) {
    const t = tplById(el.dataset.tplName); t.name = el.value.trim() || 'Без названия'; await put('templates', t);
  } else if (el.dataset.tpl) {
    // Без перерисовки: иначе потеряется фокус на следующем поле
    const t = tplById(el.dataset.tpl), n = Math.max(1, Math.round(num(el.value) || 1));
    t.items[+el.dataset.i][el.dataset.k] = n; el.value = n; await put('templates', t);
  }
});

// Обновление таймера активной тренировки
setInterval(() => { const el = document.getElementById('elapsed'), w = active(); if (el && w) el.textContent = mins(w) + ' мин'; }, 15000);

(async () => {
  try { db = await openDB(); await load(); }
  catch (err) { document.getElementById('app').innerHTML = `<div class="empty">Не удалось открыть хранилище браузера (${esc(err && err.message || err)}). Проверь, что не включён приватный режим.</div>`; return; }
  render(true);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
