'use strict';
/* =========================================================
   Тренировки — PWA, данные в IndexedDB (только на устройстве)
   ========================================================= */

/* ---------- Хранилище ----------
   Каждому пользователю — своя база IndexedDB (гость: 'workout-tracker', аккаунт: 'trainee-<uid>').
   Данные пишутся сначала локально (работает офлайн), а изменения копятся в outbox
   и отправляются в облако, когда есть сеть. */
const GUEST_DB = 'workout-tracker';
const DB_VERSION = 3; // v1: exercises, workouts; v2: + templates, meta; v3: + outbox
const DATA_STORES = ['exercises', 'workouts', 'templates', 'meta'];
const SYNCED_META = new Set(['plan', 'program']); // остальные ключи meta — локальные (seedV, lastPull, …)
let db;

const dbNameFor = user => user ? 'trainee-' + user.id : GUEST_DB;
const openDB = name => new Promise((res, rej) => {
  const r = indexedDB.open(name, DB_VERSION);
  r.onupgradeneeded = () => {
    const d = r.result;
    for (const s of ['exercises', 'workouts', 'templates']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
    if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'key' });
  };
  r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); res(r.result); };
  r.onerror = () => rej(r.error);
  r.onblocked = () => rej(new Error('База открыта в другой вкладке — закрой её и обнови страницу'));
});
const run = (store, mode, fn, d = db) => new Promise((res, rej) => {
  const t = d.transaction(store, mode);
  const req = fn(t.objectStore(store));
  t.oncomplete = () => res(req ? req.result : undefined);
  t.onerror = () => rej(t.error);
});
const getAll = (s, d) => run(s, 'readonly', st => st.getAll(), d);
const getOne = (s, k, d) => run(s, 'readonly', st => st.get(k), d);
const put = (s, v, d) => run(s, 'readwrite', st => st.put(v), d);
const del = (s, id, d) => run(s, 'readwrite', st => st.delete(id), d);
const clearStore = (s, d) => run(s, 'readwrite', st => st.clear(), d);

// Запись данных пользователя: метка времени изменения + очередь на отправку.
// u = 1 у стартовых упражнений/шаблонов: любая правка с другого устройства их перекрывает.
const recId = (s, v) => s === 'meta' ? v.key : v.id;
const syncable = (s, id) => s !== 'meta' || SYNCED_META.has(id);
async function dataPut(s, v, u = Date.now()) {
  v._u = u; await put(s, v);
  if (CLOUD.user && syncable(s, recId(s, v))) { await put('outbox', { key: s + '|' + recId(s, v), kind: s, id: recId(s, v), _u: u, deleted: false }); scheduleSync(); }
}
async function dataDel(s, id) {
  await del(s, id);
  if (CLOUD.user && syncable(s, id)) { await put('outbox', { key: s + '|' + id, kind: s, id, _u: Date.now(), deleted: true }); scheduleSync(); }
}

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

/* ---------- Проверка данных ----------
   Всё, что приходит извне (облако, импорт JSON, старая база), приводится к строгой форме:
   id — только [A-Za-z0-9_-], числа — конечные и в разумных пределах, строки — обрезаны.
   Это закрывает XSS через данные и не даёт испорченной записи сломать приложение. */
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const vId = v => typeof v === 'string' && ID_RE.test(v) ? v : null;
const vNum = (v, min, max) => { const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN; return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null; };
const vInt = (v, min, max) => { const n = vNum(v, min, max); return n == null ? null : Math.round(n); };
const vStr = (v, max) => typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '';
const vArr = (v, max) => Array.isArray(v) ? v.slice(0, max) : [];
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function cleanSet(x) {
  if (!isObj(x)) return null;
  const s = {};
  for (const [k, [min, max, int]] of Object.entries({ w: [0, 2000, false], r: [0, 10000, true], km: [0, 1000, false], min: [0, 10000, false], rpe: [5, 10, false] })) {
    const n = int ? vInt(x[k], min, max) : vNum(x[k], min, max); if (n != null) s[k] = n;
  }
  return Object.keys(s).length ? s : null;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const vDate = v => typeof v === 'string' && DATE_RE.test(v) ? v : null;
// Схема подходов из программы: [{n, reps, kg?, note?}]
const cleanScheme = x => vArr(x, 10).map(g => {
  if (!isObj(g) || vInt(g.n, 1, 20) == null || vInt(g.reps, 1, 1000) == null) return null;
  const o = { n: vInt(g.n, 1, 20), reps: vInt(g.reps, 1, 1000) };
  const kg = vNum(g.kg, 0, 500); if (kg != null) o.kg = kg;
  const note = vStr(g.note, 120); if (note) o.note = note;
  return o;
}).filter(Boolean);
function cleanProgram(x) {
  if (!isObj(x) || !isObj(x.goal)) return null;
  const goal = { ex: vStr(x.goal.ex, 120), kg: vNum(x.goal.kg, 1, 500), date: vDate(x.goal.date) };
  if (!goal.ex || goal.kg == null || !goal.date) return null;
  const sessions = vArr(x.sessions, 200).map(se => {
    if (!isObj(se) || !vDate(se.date)) return null;
    const items = vArr(se.items, 15).map(it => isObj(it) && vStr(it.ex, 120).trim() ? {
      ex: vStr(it.ex, 120).trim(), group: GROUPS[it.group] ? it.group : null, type: TYPES[it.type] ? it.type : null, scheme: cleanScheme(it.scheme),
    } : null).filter(Boolean);
    const o = { id: se.date, date: se.date, type: vStr(se.type, 4), title: vStr(se.title, 120), note: vStr(se.note, 300), items };
    if (isObj(se.top) && vNum(se.top.kg, 0, 500) != null) o.top = { kg: vNum(se.top.kg, 0, 500), reps: vInt(se.top.reps, 1, 100) || 1 };
    return o;
  }).filter(Boolean).sort((a, b) => a.date < b.date ? -1 : 1);
  if (!sessions.length) return null;
  return {
    key: 'program', id: vStr(x.id, 80), title: vStr(x.title, 120) || 'Программа', goal, base1RM: vNum(x.base1RM, 1, 500) || goal.kg,
    plasma: vArr(x.plasma, 60).map(vDate).filter(Boolean),
    blocks: vArr(x.blocks, 12).map(b => isObj(b) && vDate(b.from) && vDate(b.to) ? { name: vStr(b.name, 60), from: b.from, to: b.to } : null).filter(Boolean),
    coachNote: isObj(x.coachNote) && vStr(x.coachNote.text, 1000) ? { date: vDate(x.coachNote.date), text: vStr(x.coachNote.text, 1000) } : null,
    rules: vArr(x.rules, 12).map(r => vStr(r, 300)).filter(Boolean),
    sessions, _u: vNum(x._u, 0, 9e15) || 0,
  };
}
const cleanTarget = x => isObj(x) && vInt(x.sets, 1, 100) != null && vInt(x.reps, 1, 10000) != null ? { sets: vInt(x.sets, 1, 100), reps: vInt(x.reps, 1, 10000) } : undefined;
const CLEAN = {
  exercises(x) {
    const id = isObj(x) && vId(x.id); if (!id) return null;
    const name = vStr(x.name, 120).trim() || 'Без названия', type = TYPES[x.type] ? x.type : 'strength';
    const group = GROUPS[x.group] ? x.group : SEED_GROUP[name] || (type === 'cardio' ? 'cardio' : 'other'); // старые записи без группы
    return { id, name, type, group, _u: vNum(x._u, 0, 9e15) || 0 };
  },
  workouts(x) {
    const id = isObj(x) && vId(x.id), start = isObj(x) && vNum(x.start, 0, 9e15); if (!id || start == null) return null;
    const entries = vArr(x.entries, 100).map(e => {
      const exId = isObj(e) && vId(e.exId); if (!exId) return null;
      const o = { exId, sets: vArr(e.sets, 200).map(cleanSet).filter(Boolean) };
      const t = cleanTarget(e.target); if (t) o.target = t;
      const sc = cleanScheme(e.scheme); if (sc.length) o.scheme = sc;
      return o;
    }).filter(Boolean);
    const end = vNum(x.end, 0, 9e15);
    return { id, start, ...(end != null ? { end } : {}), finished: x.finished === true, title: vStr(x.title, 120), templateId: vId(x.templateId), programDate: vDate(x.programDate), entries, _u: vNum(x._u, 0, 9e15) || 0 };
  },
  templates(x) {
    const id = isObj(x) && vId(x.id); if (!id) return null;
    const items = vArr(x.items, 100).map(i => isObj(i) && vId(i.exId) ? { exId: i.exId, sets: vInt(i.sets, 1, 100) || 1, reps: vInt(i.reps, 1, 10000) || 1 } : null).filter(Boolean);
    return { id, name: vStr(x.name, 120).trim() || 'Без названия', created: vNum(x.created, 0, 9e15) || 0, items, _u: vNum(x._u, 0, 9e15) || 0 };
  },
  meta(x) {
    if (isObj(x) && x.key === 'program') return cleanProgram(x);
    if (!isObj(x) || x.key !== 'plan') return null;
    const days = vArr(x.days, 7).map(vId); while (days.length < 7) days.push(null);
    return { key: 'plan', days, _u: vNum(x._u, 0, 9e15) || 0 };
  },
};
const cleanAll = (kind, list) => vArr(list, 100000).map(CLEAN[kind]).filter(Boolean);

async function reloadState() {
  S.exercises = cleanAll('exercises', await getAll('exercises'));
  S.workouts = cleanAll('workouts', await getAll('workouts'));
  S.templates = cleanAll('templates', await getAll('templates'));
  S.plan = CLEAN.meta(await getOne('meta', 'plan')) || { key: 'plan', days: Array(7).fill(null) };
  S.program = CLEAN.meta(await getOne('meta', 'program'));
  sortEx();
  S.templates.sort((a, b) => (a.created || 0) - (b.created || 0) || a.name.localeCompare(b.name, 'ru'));
}
async function load() {
  await reloadState();
  const seed = (await getOne('meta', 'seedV')) || { key: 'seedV', v: 0 };
  if (seed.v < 2) { await migrate(); await reloadState(); }
}

// Детерминированные id стартовых данных: на всех устройствах одного аккаунта они совпадают,
// поэтому при синхронизации не появляются дубликаты.
const hash = s => { let h = 0x811c9dc5; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
const seedExId = name => 'ex-' + hash(name);
const SEED_U = 1;

// v1 → v2 (и первый запуск): группы мышц, упражнения сплита, шаблоны и план недели
async function migrate() {
  const names = new Set(S.exercises.map(e => e.name));
  for (const e of S.exercises) {
    if (!e.group) { e.group = SEED_GROUP[e.name] || (e.type === 'cardio' ? 'cardio' : 'other'); await dataPut('exercises', e); }
  }
  for (const [name, type, group] of SEED_EX) {
    if (names.has(name)) continue;
    const e = { id: seedExId(name), name, type, group };
    S.exercises.push(e); await dataPut('exercises', e, SEED_U);
  }
  if (!S.templates.length) {
    const byName = n => S.exercises.find(e => e.name === n);
    const days = Array(7).fill(null);
    for (const [k, [name, items, day]] of SEED_TPL.entries()) {
      const t = { id: 'tpl-' + hash(name), created: k + 1, name, items: items.filter(([n]) => byName(n)).map(([n, sets, reps]) => ({ exId: byName(n).id, sets, reps })) };
      S.templates.push(t); await dataPut('templates', t, SEED_U);
      days[day] = t.id;
    }
    S.plan = { key: 'plan', days }; await dataPut('meta', S.plan, SEED_U);
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
const fmtSet = (type, s) => (
  type === 'strength' ? `${fmtN(s.w)} кг × ${s.r}` :
  type === 'bodyweight' ? `${s.r} повт.` + (s.w ? ` +${fmtN(s.w)} кг` : '') :
  `${fmtN(s.km)} км, ${fmtN(s.min)} мин` + (s.km && s.min ? `, ${fmtN(s.min / s.km)} мин/км` : '')) + (s.rpe ? ` @${fmtN(s.rpe)}` : '');
// «80×3, 3×6×67,5» — компактная запись схемы подходов
const schemeText = sc => sc.map(g => g.kg != null ? (g.n > 1 ? `${g.n}×${g.reps}×${fmtN(g.kg)}` : `${fmtN(g.kg)}×${g.reps}`) : `${g.n}×${g.reps}`).join(', ');
const schemeTotal = sc => sc.reduce((a, g) => a + g.n, 0);
// Какой группе схемы принадлежит k-й подход (с нуля)
const schemeGroupAt = (sc, k) => { let acc = 0; for (const g of sc) { acc += g.n; if (k < acc) return g; } return null; };
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
  goal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4.5h11.5l-2.2 3.8 2.2 3.8H5"/></svg>',
  drop: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 3c3.5 4.6 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6.4 6-11z" fill="var(--g-chest)" fill-opacity=".75"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.8 4-5.6 7.5-5.6s6.3 1.8 7.5 5.6"/></svg>',
};

/* ---------- Действия: тренировка ---------- */
const saveW = w => dataPut('workouts', w);
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
    await dataDel('workouts', w.id); S.workouts = S.workouts.filter(x => x !== w);
  } else { w.finished = true; w.end = Date.now(); await saveW(w); }
  S.adding = false; S.selDay = null; render(true);
}
async function discardWorkout() {
  const w = active(); if (!w || !confirm('Отменить тренировку? Записанные подходы удалятся.')) return;
  await dataDel('workouts', w.id); S.workouts = S.workouts.filter(x => x !== w); S.adding = false; render(true);
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
  const rpe = vNum(v('rpe'), 5, 10); if (rpe != null && ex.type !== 'cardio') s.rpe = rpe;
  e.sets.push(cleanSet(s)); await saveW(w); render();
}
const shake = el => { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); };
async function delSet(exId, i) { const w = active(); w.entries.find(e => e.exId === exId).sets.splice(i, 1); await saveW(w); render(); }
async function delEntry(exId) { const w = active(); w.entries = w.entries.filter(e => e.exId !== exId); await saveW(w); render(); }
async function delWorkout(id) {
  if (!confirm('Удалить тренировку из истории?')) return;
  await dataDel('workouts', id); S.workouts = S.workouts.filter(w => w.id !== id); render();
}

/* ---------- Действия: план и шаблоны ---------- */
async function setPlanDay(day, tplId) { S.plan.days[day] = tplId || null; await dataPut('meta', S.plan); render(); }
async function newTemplate() {
  const t = { id: uid(), created: Date.now(), name: 'Новый шаблон', items: [] };
  S.templates.push(t); await dataPut('templates', t); S.editTpl = t.id; render();
  document.querySelector('[data-tpl-name]')?.select();
}
async function deleteTemplate(id) {
  const t = tplById(id);
  if (!confirm(`Удалить шаблон «${t.name}»? Он пропадёт из плана недели.`)) return;
  await dataDel('templates', id); S.templates = S.templates.filter(x => x.id !== id);
  S.plan.days = S.plan.days.map(d => d === id ? null : d); await dataPut('meta', S.plan);
  S.editTpl = null; render();
}
async function tplAddEx(id, exId) {
  const t = tplById(id); if (!exId) return;
  const cardio = exById(exId)?.type === 'cardio';
  t.items.push({ exId, sets: cardio ? 1 : 3, reps: cardio ? 30 : 10 }); await dataPut('templates', t); render();
}
async function tplRemoveItem(id, i) { const t = tplById(id); t.items.splice(i, 1); await dataPut('templates', t); render(); }
async function tplMoveItem(id, i, d) {
  const t = tplById(id), j = i + d; if (j < 0 || j >= t.items.length) return;
  [t.items[i], t.items[j]] = [t.items[j], t.items[i]]; await dataPut('templates', t); render();
}

/* ---------- Действия: упражнения ---------- */
async function addExercise(form) {
  const name = form.querySelector('[name=name]').value.trim();
  if (!name) return shake(form);
  if (S.exercises.some(e => e.name.toLowerCase() === name.toLowerCase())) { alert('Такое упражнение уже есть'); return; }
  const e = { id: uid(), name, type: form.querySelector('[name=type]').value, group: form.querySelector('[name=group]').value };
  await dataPut('exercises', e); S.exercises.push(e); sortEx(); render();
}
async function delExercise(id) {
  const used = S.workouts.some(w => w.entries.some(e => e.exId === id));
  const ex = exById(id);
  if (!confirm(used ? `«${ex.name}» есть в истории. Удалить? В истории оно станет «удалено».` : `Удалить «${ex.name}»?`)) return;
  await dataDel('exercises', id); S.exercises = S.exercises.filter(e => e.id !== id);
  for (const t of S.templates) if (t.items.some(i => i.exId === id)) { t.items = t.items.filter(i => i.exId !== id); await dataPut('templates', t); }
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
  try { if (file.size > 20 * 1024 * 1024) throw 0; d = JSON.parse(await file.text()); if (!isObj(d) || !Array.isArray(d.exercises) || !Array.isArray(d.workouts)) throw 0; }
  catch { alert('Файл не похож на резервную копию трекера (нужен JSON из «Экспорт JSON»).'); return; }
  if (!confirm(CLOUD.user ? 'Импорт заменит все данные аккаунта на всех устройствах. Продолжить?' : 'Импорт заменит все текущие данные. Продолжить?')) return;
  const incoming = { exercises: cleanAll('exercises', d.exercises), workouts: cleanAll('workouts', d.workouts), templates: cleanAll('templates', d.templates) };
  for (const s of Object.keys(incoming)) {
    const keep = new Set(incoming[s].map(x => x.id));
    for (const old of await getAll(s)) if (!keep.has(old.id)) await dataDel(s, old.id); // удаление уходит и в облако
    for (const x of incoming[s]) await dataPut(s, x);
  }
  const plan = CLEAN.meta({ ...(isObj(d.plan) ? d.plan : {}), key: 'plan' }); if (plan) await dataPut('meta', plan);
  await put('meta', { key: 'seedV', v: d.v >= 2 ? 2 : 1 }); // старый формат → догоним миграцией
  await load(); render(true);
}

/* ---------- Программа тренера ---------- */
// Дата как ключ YYYY-MM-DD в местном времени (а не в UTC)
const dk = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const shortKey = k => fromKey(k).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const progSession = key => S.program ? S.program.sessions.find(x => x.date === key) || null : null;
const isPlasma = key => !!S.program && S.program.plasma.includes(key);
const exByName = n => S.exercises.find(e => e.name.toLowerCase() === n.toLowerCase());
const sessionWorkout = se => finished().find(w => w.programDate === se.id) || finished().find(w => !w.programDate && dk(w.start) === se.date) || null;
function sessionWeights(se) { // доля группы мышц = число подходов
  const m = new Map();
  for (const it of se.items) { const g = exByName(it.ex)?.group || it.group || 'other'; m.set(g, (m.get(g) || 0) + Math.max(1, schemeTotal(it.scheme))); }
  return [...m.entries()];
}
const sessionLabel = se => se.type === 'T' ? se.title : `${se.type}. ${se.title}`;
// Лучший подход упражнения цели в тренировке (по весу)
function topSet(w, exName) {
  const ex = exByName(exName); if (!w || !ex) return null;
  let best = null;
  for (const e of w.entries) if (e.exId === ex.id) for (const x of e.sets) if (x.w && (!best || x.w > best.w || (x.w === best.w && x.r > best.r))) best = x;
  return best;
}
const e1rm = x => x.r === 1 ? x.w : x.w * (1 + x.r / 30);
function currentMax(p) { // расчётный максимум за 5 недель по подходам до 10 повторов
  const ex = exByName(p.goal.ex); if (!ex) return null;
  const since = Date.now() - 35 * 864e5; let best = null;
  for (const w of finished()) if (w.start >= since) for (const e of w.entries) if (e.exId === ex.id)
    for (const x of e.sets) if (x.w && x.r && x.r <= 10) { const v = e1rm(x); if (!best || v > best.v) best = { v, x, date: w.start }; }
  return best;
}
async function ensureExercise(it) {
  let ex = exByName(it.ex);
  if (!ex) {
    ex = { id: uid(), name: it.ex, type: it.type || 'strength', group: it.group || SEED_GROUP[it.ex] || 'other' };
    await dataPut('exercises', ex); S.exercises.push(ex); sortEx();
  }
  return ex;
}
async function startProgramSession(key) {
  if (active()) return;
  const se = progSession(key); if (!se) return;
  const entries = [];
  for (const it of se.items) { const ex = await ensureExercise(it); if (!entries.some(e => e.exId === ex.id)) entries.push({ exId: ex.id, sets: [], scheme: it.scheme }); }
  const w = { id: uid(), start: Date.now(), finished: false, templateId: null, programDate: se.id, title: se.title, entries };
  S.workouts.push(w); await saveW(w); S.tab = 'today'; S.adding = false; render(true); window.scrollTo(0, 0);
}
async function activateProgram() {
  try {
    const res = await fetch('programs/bench-100-2026.json', { cache: 'no-cache' });
    const p = cleanProgram(await res.json()); if (!p) throw new Error('bad program');
    await dataPut('meta', p); S.program = p; render(true);
  } catch { alert('Не удалось загрузить программу. Проверь интернет и попробуй ещё раз.'); }
}
async function deactivateProgram() {
  if (!confirm('Отключить программу? История тренировок сохранится, а «Сегодня» снова будет брать план недели.')) return;
  await dataDel('meta', 'program'); S.program = null; render();
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
    const ps = S.program ? progSession(dk(date)) : null, pl = S.program && isPlasma(dk(date));
    const t = S.program ? null : tplById(S.plan.days[i]);
    const dw = done.filter(w => sameDay(w.start, date));
    const weights = ps ? sessionWeights(ps) : t ? tplWeights(t) : dw.length ? wWeights(dw[0]) : [];
    const name = ps ? sessionLabel(ps) : pl ? 'сдача плазмы' : t ? t.name : 'отдых';
    const cls = ['day', i === sel && 'sel', i === today && 'today', i < today && 'past', dw.length && 'done'].filter(Boolean).join(' ');
    return `<button class="${cls}" data-day="${i}" role="tab" aria-selected="${i === sel}" aria-label="${DOW_FULL[i]}, ${esc(name)}${dw.length ? ', выполнено' : ''}">
      <span class="d">${d}</span>${plate(weights, '', dw.length ? '✓' : pl ? ICON.drop : '')}<span class="n">${date.getDate()}</span></button>`;
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
  if (S.program) body = programHero(progSession(dk(date)), isPlasma(dk(date)), date, label, spin, sel === today);
  else if (t) {
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

  return `<header class="head"><div><h1>${DOW_FULL[today]}</h1><div class="sub">${longDate(Date.now())}</div></div>${avatarBtn()}</header>
    ${mergeOffer()}
    ${weekStrip(sel)}
    <section class="sheet">${body}</section>
    <button class="btn ghost block" style="margin-top:8px" data-a="start">Свободная тренировка</button>`;
}

function programHero(ps, pl, date, label, spin, isToday) {
  const when = `<div class="mute small">${label}, ${longDate(date)}</div>`;
  if (!ps && pl) return `<div class="hero">${plate([], 'big ' + spin, ICON.drop)}<div>${when}<h2>Сдача плазмы</h2>
    <p class="mute small">Силовой сегодня нет. Больше воды и белка. Завтра тренировка умеренная, RPE не выше 7.</p></div></div>`;
  if (!ps) return `<div class="hero">${plate([], 'big ' + spin)}<div>${when}<h2>День отдыха</h2>
    <p class="mute small">По программе отдых. Восстановление тоже работает на результат.</p></div></div>`;
  const weights = sessionWeights(ps);
  return `<div class="hero">${plate(weights, 'big ' + spin)}<div>${when}<h2>${esc(ps.title)}</h2>
      <div class="chips"><span class="chip">${ps.type === 'T' ? 'Тест' : 'День ' + esc(ps.type)}</span>${weights.slice(0, 3).map(([g]) => `<span class="chip"><span class="dot" style="--c:${gc(g)}"></span>${GROUPS[g]}</span>`).join('')}</div></div></div>
    ${ps.note ? `<p class="coach-line">${esc(ps.note)}</p>` : ''}
    <div class="plan-rows">${ps.items.map(it => { const ex = exByName(it.ex); return `<div class="plan-row">
      <span class="dot" style="--c:${gc(ex?.group || it.group)}"></span><span>${esc(it.ex)}</span><span class="target">${esc(schemeText(it.scheme))}</span></div>`; }).join('')}</div>
    <div class="stack" style="margin-top:18px"><button class="btn primary big block" data-a="progStart" data-id="${ps.date}">${isToday ? 'Начать тренировку' : 'Начать сейчас'}</button></div>`;
}

/* --- Цель --- */
function goalChart(p) {
  const tops = p.sessions.filter(se => se.top);
  if (tops.length < 2) return '';
  const W = 360, H = 196, l = 10, r = 346, y0 = 22, base = 160;
  const t0 = fromKey(tops[0].date).getTime(), t1 = fromKey(tops.at(-1).date).getTime();
  const X = k => l + (fromKey(k).getTime() - t0) / (t1 - t0 || 1) * (r - l);
  const facts = tops.map(se => ({ se, f: topSet(sessionWorkout(se), p.goal.ex) })).filter(o => o.f);
  const vals = tops.map(se => se.top.kg).concat(facts.map(o => o.f.w), [p.goal.kg]);
  const lo = Math.floor(Math.min(...vals) / 5) * 5 - 2.5, hi = Math.max(...vals) + 2.5;
  const Y = v => base - (v - lo) / (hi - lo) * (base - y0);
  const planPath = tops.map((se, i) => `${i ? 'L' : 'M'}${X(se.date).toFixed(1)},${Y(se.top.kg).toFixed(1)}`).join(' ');
  const factPath = facts.map((o, i) => `${i ? 'L' : 'M'}${X(o.se.date).toFixed(1)},${Y(o.f.w).toFixed(1)}`).join(' ');
  const lastF = facts.at(-1);
  return `<svg class="goal-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Верхний подход по субботам: план и факт">
    <line x1="${l}" x2="${r}" y1="${Y(p.goal.kg)}" y2="${Y(p.goal.kg)}" stroke="var(--mute)" stroke-dasharray="5 4" stroke-width="1"/>
    <text x="${l}" y="${Y(p.goal.kg) - 5}" class="lbl">цель ${fmtN(p.goal.kg)} кг</text>
    <path d="${planPath}" fill="none" stroke="var(--mute)" stroke-width="1.5" stroke-dasharray="2 4" opacity=".8"/>
    ${tops.map(se => `<circle cx="${X(se.date)}" cy="${Y(se.top.kg)}" r="2.5" fill="var(--mute)"><title>План ${shortKey(se.date)}: ${fmtN(se.top.kg)} × ${se.top.reps}</title></circle>`).join('')}
    ${facts.length ? `<path d="${factPath}" fill="none" stroke="var(--g-back)" stroke-width="2.5" stroke-linejoin="round"/>` : ''}
    ${facts.map(o => `<circle cx="${X(o.se.date)}" cy="${Y(o.f.w)}" r="4.5" fill="var(--g-back)"><title>Факт ${shortKey(o.se.date)}: ${fmtN(o.f.w)} × ${o.f.r}${o.f.rpe ? ' @' + fmtN(o.f.rpe) : ''}</title></circle>`).join('')}
    ${lastF ? `<text x="${Math.min(X(lastF.se.date), r - 40)}" y="${Y(lastF.f.w) - 9}" class="lbl strong">${fmtN(lastF.f.w)}×${lastF.f.r}</text>` : ''}
    <text x="${l}" y="${H - 18}" class="lbl">${shortKey(tops[0].date)}</text><text x="${r}" y="${H - 18}" class="lbl" text-anchor="end">${shortKey(tops.at(-1).date)}</text>
    <circle cx="${l + 4}" cy="${H - 4}" r="3.5" fill="var(--g-back)"/><text x="${l + 12}" y="${H - 1}" class="lbl">факт</text>
    <line x1="${l + 52}" x2="${l + 70}" y1="${H - 4}" y2="${H - 4}" stroke="var(--mute)" stroke-dasharray="2 4" stroke-width="1.5"/><text x="${l + 76}" y="${H - 1}" class="lbl">план</text>
  </svg>`;
}
function viewGoal() {
  const p = S.program;
  if (!p) return `<header class="head"><div><h1>Цель</h1><div class="sub">Программа тренера с весами на каждую тренировку</div></div>${avatarBtn()}</header>
    <section class="sheet"><div class="hero">${plate([['chest', 3], ['triceps', 1], ['back', 2], ['legs', 1]], 'big spin')}<div>
      <h2>Жим 100 кг к Новому году</h2><p class="mute small">9 недель, 3 блока, тест 27 декабря. Тренировки в Пн, Вт, Сб, Вс, сдачи плазмы по понедельникам учтены.</p></div></div>
      <button class="btn primary big block" style="margin-top:18px" data-a="progOn">Подключить программу</button></section>`;
  const today = dk(Date.now());
  const daysLeft = Math.round((fromKey(p.goal.date) - startOfDay(Date.now())) / 864e5);
  const best = currentMax(p), est = best ? best.v : p.base1RM;
  // Шкала от ~85% цели до цели: видно и старт, и текущую оценку, даже если она пока ниже старта
  const lo = Math.floor(Math.min(p.base1RM, est, p.goal.kg * 0.9) * 0.95 / 5) * 5, span = (p.goal.kg - lo) || 1;
  const pct = Math.max(0.02, Math.min(1, (est - lo) / span)), basePct = Math.max(0, Math.min(1, (p.base1RM - lo) / span));
  const next = p.sessions.find(se => se.date >= today && !sessionWorkout(se));
  const plasmaToday = isPlasma(today);
  const nextLabel = !next ? '' : next.date === today ? 'Сегодня' : next.date === dk(Date.now() + 864e5) ? 'Завтра' : DOW_FULL[dowOf(fromKey(next.date))];
  const rows = [...p.sessions.map(se => ({ k: se.date, se })), ...p.plasma.map(k => ({ k, plasma: true }))].sort((a, b) => a.k < b.k ? -1 : a.k > b.k ? 1 : a.plasma ? -1 : 1);
  const blocks = p.blocks.length ? p.blocks : [{ name: 'Программа', from: rows[0].k, to: rows.at(-1).k }];
  return `<header class="head"><div><h1>Цель</h1><div class="sub">${esc(p.title)}</div></div>${avatarBtn()}</header>
    <section class="sheet goal-hero">
      <div class="goal-top"><div><div class="goal-kg num">${fmtN(p.goal.kg)}<small> кг</small></div>
        <div class="mute small">${esc(p.goal.ex)}, тест ${longDate(fromKey(p.goal.date))}</div></div>
        <div class="days"><span class="num">${Math.max(0, daysLeft)}</span><span class="mute small">${plural(Math.max(0, daysLeft), 'день', 'дня', 'дней')}</span></div></div>
      <div class="track" role="img" aria-label="Расчётный максимум ${fmtN(Math.round(est * 2) / 2)} кг из ${fmtN(p.goal.kg)}, старт ${fmtN(p.base1RM)}"><div class="fill" style="width:${(pct * 100).toFixed(1)}%"></div><div class="tick" style="left:${(basePct * 100).toFixed(1)}%"></div></div>
      <div class="track-legend"><span>${fmtN(lo)}</span><b>сейчас ≈ ${fmtN(Math.round(est * 2) / 2)} кг</b><span>${fmtN(p.goal.kg)}</span></div>
      <p class="mute small">Метка на шкале — старт программы, ${fmtN(p.base1RM)} кг.</p>
      <p class="mute small" style="margin-top:6px">${best ? `Расчёт по подходу ${fmtSet('strength', best.x)} от ${shortKey(dk(best.date))} (формула Эпли).` : 'Пока это стартовая оценка. Она обновится после первых тяжёлых подходов.'}</p>
    </section>
    ${p.coachNote ? `<section class="coach"><div class="mute small">Тренер${p.coachNote.date ? ', ' + shortKey(p.coachNote.date) : ''}</div><p>${esc(p.coachNote.text)}</p></section>` : ''}
    ${plasmaToday ? `<section class="notice" style="margin:12px 0 0;box-shadow:inset 4px 0 0 var(--g-chest)"><p><b>Сегодня сдача плазмы.</b> Силовой нет, пей больше воды и ешь белок.</p></section>` : ''}
    ${next ? `<section class="sheet next"><div class="mute small">${nextLabel}, ${longDate(fromKey(next.date))}</div><h2>${esc(next.title)}</h2>
      <div class="plan-rows" style="margin-top:8px">${next.items.slice(0, 2).map(it => `<div class="plan-row"><span class="dot" style="--c:${gc(exByName(it.ex)?.group || it.group)}"></span><span>${esc(it.ex)}</span><span class="target">${esc(schemeText(it.scheme))}</span></div>`).join('')}
      ${next.items.length > 2 ? `<p class="mute small" style="margin-top:6px">и ещё ${next.items.length - 2} ${plural(next.items.length - 2, 'упражнение', 'упражнения', 'упражнений')}</p>` : ''}</div>
      ${active() ? '<p class="mute small" style="margin-top:12px">Сейчас идёт тренировка, её видно на вкладке «Сегодня».</p>' : plasmaToday && next.date !== today ? '' : `<button class="btn primary big block" style="margin-top:14px" data-a="progStart" data-id="${next.date}">${next.date === today ? 'Начать тренировку' : 'Начать сейчас'}</button>`}</section>` : ''}
    <section class="sheet" style="margin-top:12px"><h3>Верхний подход по субботам</h3>${goalChart(p)}</section>
    <div class="section"><h2>Расписание</h2>
    ${blocks.map(b => { const list = rows.filter(x => x.k >= b.from && x.k <= b.to); return list.length ? `<h3 class="block-h">${esc(b.name)} <span class="mute small">${shortKey(b.from)} – ${shortKey(b.to)}</span></h3>
      <div class="list">${list.map(x => schedRow(x, today, p)).join('')}</div>` : ''; }).join('')}</div>
    ${p.rules.length ? `<details class="sheet rules"><summary>Правила программы</summary><ul>${p.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul></details>` : ''}
    <button class="btn ghost danger block" style="margin-top:14px" data-a="progOff">Отключить программу</button>`;
}
function schedRow(x, today, p) {
  const d = fromKey(x.k), when = `<span class="sd"><b>${DOW[dowOf(d)]}</b> ${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}</span>`;
  if (x.plasma) return `<div class="item sched plasma">${when}<span class="grow mute">${ICON.drop} Сдача плазмы, без силовой</span></div>`;
  const se = x.se, w = sessionWorkout(se), f = w ? topSet(w, p.goal.ex) : null, open = S.openSession === se.date;
  const status = w ? `<span class="st ok">✓${f ? ' ' + fmtN(f.w) + '×' + f.r : ''}</span>` : se.date === today ? '<span class="st now">сегодня</span>' : se.date < today ? '<span class="st miss">пропущено</span>' : '';
  const main = se.items[0];
  return `<div class="sched-wrap ${se.date === today ? 'is-today' : ''}"><button class="item sched" data-a="progOpen" data-id="${se.date}" aria-expanded="${open}">${when}
      <span class="grow"><span class="badge">${se.type === 'T' ? 'Тест' : esc(se.type)}</span> ${main ? esc(schemeText(main.scheme)) : esc(se.title)}</span>${status}</button>
    ${open ? `<div class="sched-detail"><b>${esc(se.title)}</b>${se.note ? `<p class="mute small">${esc(se.note)}</p>` : ''}
      ${se.items.map(it => `<div class="plan-row"><span class="dot" style="--c:${gc(exByName(it.ex)?.group || it.group)}"></span><span>${esc(it.ex)}</span><span class="target">${esc(schemeText(it.scheme))}</span></div>`).join('')}
      ${w ? `<p class="mute small" style="margin-top:8px">Выполнено: ${setCount(w)} ${plural(setCount(w), 'подход', 'подхода', 'подходов')}, ${mins(w)} мин</p>`
        : active() ? '' : `<button class="btn sm" style="margin-top:10px" data-a="progStart" data-id="${se.date}">Начать эту тренировку</button>`}</div>` : ''}</div>`;
}

/* --- Активная тренировка --- */
function viewActive(w) {
  const taken = w.entries.map(e => e.exId);
  return `<header class="head"><div><h1>${esc(w.title || 'Тренировка')}</h1>
      <div class="sub live">Идёт <span id="elapsed">${mins(w)} мин</span></div></div>${avatarBtn()}</header>
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
  const sc = e.scheme || null, next = sc ? schemeGroupAt(sc, e.sets.length) : null;
  // Подстановка: вес и повторы следующей группы схемы программы, иначе последний подход
  const seed = next ? { w: next.kg ?? e.sets.at(-1)?.w, r: next.reps } : e.sets.at(-1) || prev?.sets[0] || {};
  const val = v => v != null && v !== 0 ? `value="${v}"` : '';
  const rpeSel = `<select name="rpe" aria-label="RPE: насколько тяжело" class="rpe"><option value="">RPE</option>${[6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10].map(x => `<option value="${x}">${fmtN(x)}</option>`).join('')}</select>`;
  const inputs = ex.type === 'strength'
    ? `<input name="w" inputmode="decimal" placeholder="кг" aria-label="Вес, кг" ${val(seed.w)}><input name="r" inputmode="numeric" placeholder="повторы" aria-label="Повторы" ${val(seed.r ?? e.target?.reps)}>${rpeSel}`
    : ex.type === 'bodyweight'
    ? `<input name="r" inputmode="numeric" placeholder="повторы" aria-label="Повторы" ${val(seed.r ?? e.target?.reps)}><input name="w" inputmode="decimal" placeholder="+кг" aria-label="Доп. вес, кг" ${val(seed.w)}>${rpeSel}`
    : `<input name="km" inputmode="decimal" placeholder="км" aria-label="Дистанция, км" ${val(seed.km)}><input name="min" inputmode="decimal" placeholder="мин" aria-label="Время, мин" ${val(seed.min ?? e.target?.reps)}>`;
  const complete = sc ? e.sets.length >= schemeTotal(sc) : e.target && ex.type !== 'cardio' ? e.sets.length >= e.target.sets : e.target && e.sets.length > 0;
  let done = 0;
  const schemeHTML = sc ? `<ol class="scheme">${sc.map(g => { const from = done; done += g.n; const st = e.sets.length >= done ? 'done' : e.sets.length >= from ? 'now' : '';
    return `<li class="${st}"><b>${esc(g.kg != null ? (g.n > 1 ? `${g.n} × ${g.reps} × ${fmtN(g.kg)} кг` : `${fmtN(g.kg)} кг × ${g.reps}`) : `${g.n} × ${g.reps}`)}</b>${g.note ? ` <span>${esc(g.note)}</span>` : ''}</li>`; }).join('')}</ol>` : '';
  const meta = [!sc && e.target && `Цель: ${fmtTarget(ex.type, e.target)}`, prev && `Прошлый раз: ${prev.sets.map(s => fmtSet(ex.type, s)).join(' / ')}`]
    .filter(Boolean).map(esc).join('<br>');
  return `<div class="entry ${complete ? 'complete' : ''}" data-ex="${e.exId}" style="--c:${gc(ex.group)}">
    <div class="entry-head"><b style="flex:1">${esc(ex.name)}</b><button class="icon-btn" data-a="delEntry" aria-label="Убрать упражнение">${ICON.x}</button></div>
    ${schemeHTML}${meta ? `<div class="meta">${meta}</div>` : ''}
    ${e.sets.length ? `<div class="sets">${e.sets.map((s, i) => `<div class="set-row"><span class="i">${i + 1}</span><span class="v">${fmtSet(ex.type, s)}</span>
      <button class="icon-btn" data-a="delSet" data-i="${i}" aria-label="Удалить подход">${ICON.x}</button></div>`).join('')}</div>` : ''}
    <div class="set-input ${ex.type === 'cardio' ? '' : 'with-rpe'}">${inputs}<button class="btn primary" data-a="addSet" aria-label="Записать подход">+</button></div>
  </div>`;
}

/* --- План --- */
function viewPlan() {
  const today = dowOf(Date.now());
  const tplOpts = sel => `<option value="">Отдых</option>` + S.templates.map(t => `<option value="${t.id}" ${t.id === sel ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  const sets = S.plan.days.reduce((a, id) => a + (tplById(id)?.items.reduce((b, i) => b + i.sets, 0) || 0), 0);
  const trainDays = S.plan.days.filter(id => tplById(id)).length;
  const progNote = S.program ? `<section class="notice"><p>Сейчас идёт программа «${esc(S.program.title)}», поэтому «Сегодня» показывает её тренировки. План недели снова заработает, когда программа закончится или ты её отключишь.</p></section>` : '';
  return `${progNote}<header class="head"><div><h1>План недели</h1>
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
      <p class="mute small" style="margin:6px 0 10px">${CLOUD.user
        ? 'Данные синхронизируются с аккаунтом. Файл JSON — дополнительная копия на всякий случай.'
        : 'Данные хранятся только в этом браузере. Сохраняй JSON раз в неделю или войди в аккаунт, чтобы не потерять историю.'}</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px"><button class="btn sm" data-a="expJSON">Экспорт JSON</button><button class="btn sm" data-a="expCSV">Экспорт CSV</button>
        <button class="btn sm" data-a="imp">Импорт JSON</button><input type="file" accept="application/json,.json" hidden id="impFile"></div></div>`;
}

/* =========================================================
   Аккаунт и синхронизация
   ========================================================= */
// Текущий пользователь хранится локально: приложение открывается и работает офлайн,
// даже если токен истёк. Сессия Supabase нужна только для синхронизации.
const CLOUD = { user: null, syncing: false, pending: 0, lastSync: null, error: null, needAuth: false };
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
};
const LS_USER = 'trainee-user', LS_GUEST = 'trainee-guest', LS_LASTSYNC = 'trainee-last-sync';
const PULL_OVERLAP_MS = 60_000; // перекрытие курсора: не теряем записи параллельных транзакций

function syncState() {
  if (!Cloud || !CLOUD.user) return 'off';
  if (CLOUD.needAuth) return 'auth';
  if (!navigator.onLine) return 'offline';
  if (CLOUD.error) return 'error';
  if (CLOUD.syncing || CLOUD.pending) return 'pending';
  return 'ok';
}
const SYNC_TEXT = {
  off: 'Без аккаунта', ok: 'Синхронизировано', pending: 'Синхронизация…', offline: 'Нет сети — изменения сохранятся на телефоне',
  error: 'Ошибка синхронизации', auth: 'Сессия истекла — войди снова',
};

function avatarBtn() {
  if (!Cloud) return '';
  const u = CLOUD.user, st = syncState();
  return `<button class="avatar s-${st}" data-tab="account" aria-label="${u ? 'Аккаунт, ' + SYNC_TEXT[st] : 'Войти в аккаунт'}">
    ${u ? esc((u.email || '?')[0].toUpperCase()) : ICON.user}<span class="sync-dot" aria-hidden="true"></span></button>`;
}
function refreshSyncUI() {
  const st = syncState();
  document.querySelectorAll('.avatar').forEach(a => { a.classList.remove(...[...a.classList].filter(c => c.startsWith('s-'))); a.classList.add('s-' + st); });
  const el = document.getElementById('syncStatus');
  if (el) el.innerHTML = syncStatusHTML();
}
function syncStatusHTML() {
  const st = syncState();
  const when = CLOUD.lastSync ? `Последняя синхронизация: ${new Date(CLOUD.lastSync).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Ещё не синхронизировано';
  return `<div class="status s-${st}"><span class="sync-dot"></span><b>${SYNC_TEXT[st]}</b></div>
    <p class="mute small" style="margin-top:4px">${CLOUD.error && st === 'error' ? esc(CLOUD.error) + '. ' : ''}${when}${CLOUD.pending ? `. В очереди: ${CLOUD.pending}` : ''}</p>`;
}

/* --- Отправка и получение --- */
async function pushOutbox() {
  const box = await getAll('outbox');
  if (!box.length) return;
  for (let i = 0; i < box.length; i += 200) {
    const part = box.slice(i, i + 200), rows = [];
    for (const o of part) {
      const rec = o.deleted ? null : await getOne(o.kind, o.id);
      rows.push({ user_id: CLOUD.user.id, kind: o.kind, id: o.id, data: rec || null, deleted: !rec, updated_at: o._u });
    }
    await Cloud.push(rows);
    for (const o of part) { const cur = await getOne('outbox', o.key); if (cur && cur._u === o._u) await del('outbox', o.key); }
  }
}
async function pullChanges() {
  const lp = await getOne('meta', 'lastPull');
  // Обрезаем микросекунды: Safari не всегда разбирает 6 знаков дробной части
  const since = lp ? new Date(new Date(lp.ts.replace(/(\.\d{3})\d+/, '$1')).getTime() - PULL_OVERLAP_MS).toISOString() : null;
  const rows = await Cloud.pull(since);
  let changed = 0, maxTs = lp ? lp.ts : null;
  for (const r of rows) {
    if (!maxTs || r.server_ts > maxTs) maxTs = r.server_ts;
    if (!DATA_STORES.includes(r.kind) || !(r.kind === 'meta' ? SYNCED_META.has(r.id) : vId(r.id))) continue;
    const key = r.kind + '|' + r.id;
    const ob = await getOne('outbox', key);
    if (ob && ob._u >= r.updated_at) continue; // локальная правка новее — уйдёт при следующей отправке
    const local = await getOne(r.kind, r.id);
    const updatedAt = vNum(r.updated_at, 0, 9e15) || 0;
    const data = r.deleted || !isObj(r.data) ? null
      : CLEAN[r.kind]({ ...r.data, [r.kind === 'meta' ? 'key' : 'id']: r.id, _u: updatedAt });
    if (!data) { if (local) { await del(r.kind, r.id); changed++; } } // удалено или не прошло проверку
    else if (!local || (local._u || 0) < updatedAt) { await put(r.kind, data); changed++; }
    if (ob) await del('outbox', key);
  }
  if (maxTs) await put('meta', { key: 'lastPull', ts: maxTs });
  return changed;
}

let syncTimer = null, syncAgain = false;
function scheduleSync(ms = 1500) { clearTimeout(syncTimer); syncTimer = setTimeout(sync, ms); }
async function sync() {
  if (!Cloud || !CLOUD.user || !db) return;
  if (CLOUD.syncing) { syncAgain = true; return; }
  if (!navigator.onLine) { CLOUD.pending = (await getAll('outbox').catch(() => [])).length; refreshSyncUI(); return; }
  const forUser = CLOUD.user.id, forDb = db;
  CLOUD.syncing = true; refreshSyncUI();
  try {
    const s = await Cloud.session();
    if (!s || s.user.id !== forUser) { CLOUD.needAuth = true; return; }
    CLOUD.needAuth = false;
    await pushOutbox();
    const changed = await pullChanges();
    if (db !== forDb) return; // пользователь сменился во время синхронизации
    CLOUD.error = null; CLOUD.lastSync = Date.now(); LS.set(LS_LASTSYNC + ':' + forUser, CLOUD.lastSync);
    if (changed) { await reloadState(); softRender(); }
  } catch (e) {
    CLOUD.error = humanError(e);
    if (/JWT|401|session/i.test(String(e && (e.message || e.code)))) CLOUD.needAuth = true;
  } finally {
    CLOUD.syncing = false;
    if (db === forDb) CLOUD.pending = (await getAll('outbox').catch(() => [])).length;
    refreshSyncUI();
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  }
}

// Не перерисовываем экран, пока человек печатает: применим изменения после ухода из поля
const isEditing = () => { const a = document.activeElement; return a && a.closest('#app') && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName); };
function softRender() { if (isEditing()) S.pendingRender = true; else render(); }
document.addEventListener('focusout', () => setTimeout(() => { if (S.pendingRender && !isEditing()) { S.pendingRender = false; render(); } }, 0));

/* --- Вход / выход / смена пользователя --- */
async function switchUser(user) {
  const old = db; db = null; if (old) old.close(); // пока база не открыта, sync() ничего не делает
  CLOUD.user = user ? { id: user.id, email: user.email } : null;
  CLOUD.error = null; CLOUD.needAuth = false; CLOUD.pending = 0;
  CLOUD.lastSync = user ? LS.get(LS_LASTSYNC + ':' + user.id) : null;
  LS.set(LS_USER, CLOUD.user);
  db = await openDB(dbNameFor(CLOUD.user));
  Object.assign(S, { selDay: null, adding: false, editTpl: null, progressEx: null, mergeOffer: null });
  await load();
  if (CLOUD.user) { CLOUD.pending = (await getAll('outbox')).length; await checkGuestData(); }
}

function humanError(e) {
  const m = String((e && (e.code || '') + ' ' + (e.message || '')) || e);
  if (/invalid_credentials|Invalid login credentials/i.test(m)) return 'Неверный email или пароль';
  if (/user_already_exists|already registered/i.test(m)) return 'Этот email уже зарегистрирован. Войди или сбрось пароль';
  if (/email_not_confirmed|not confirmed/i.test(m)) return 'Email не подтверждён — открой ссылку из письма';
  if (/weak_password|Password should|at least \d/i.test(m)) return 'Пароль слишком простой: минимум 8 символов, лучше с цифрами и буквами';
  if (/same_password|different from the old/i.test(m)) return 'Новый пароль должен отличаться от старого';
  if (/rate limit|over_.*_rate_limit|too many/i.test(m)) return 'Слишком много попыток. Подожди минуту и попробуй снова';
  if (/email_address_invalid|invalid.*email|validate email/i.test(m)) return 'Проверь адрес email';
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Нет связи с сервером. Проверь интернет';
  if (/relation .*records.* does not exist|PGRST205|42P01/i.test(m)) return 'В Supabase нет таблицы records — выполни supabase/schema.sql';
  return 'Ошибка: ' + (e && e.message || m).trim();
}

async function submitAuth(form) {
  const email = form.querySelector('[name=email]')?.value.trim();
  const password = form.querySelector('[name=password]')?.value || '';
  const mode = S.authMode || 'signin';
  if (email != null) S.authEmail = email; // не теряем введённый email при перерисовке
  const msg = (type, text) => { S.authMsg = { type, text }; S.authBusy = false; render(); };
  if (mode !== 'newpass' && !/^\S+@\S+\.\S+$/.test(email || '')) return msg('error', 'Проверь адрес email');
  if ((mode === 'signup' || mode === 'newpass') && password.length < 8) return msg('error', 'Пароль — минимум 8 символов');
  if (mode === 'signin' && !password) return msg('error', 'Введи пароль');
  S.authBusy = true; S.authMsg = null; S.authEmail = email || S.authEmail; render();
  try {
    if (mode === 'signin') {
      const d = await Cloud.signIn(email, password);
      await afterSignIn(d.user);
    } else if (mode === 'signup') {
      const d = await Cloud.signUp(email, password);
      if (d.user && Array.isArray(d.user.identities) && d.user.identities.length === 0) return msg('error', humanError({ code: 'user_already_exists' }));
      if (d.session) await afterSignIn(d.user);
      else { S.authMode = 'signin'; msg('ok', `Письмо отправлено на ${email}. Открой ссылку из него, затем войди здесь.`); }
    } else if (mode === 'reset') {
      await Cloud.resetPassword(email);
      S.authMode = 'signin'; msg('ok', `Ссылка для сброса пароля отправлена на ${email}.`);
    } else if (mode === 'newpass') {
      await Cloud.updatePassword(password);
      S.recovery = false; S.authMode = 'signin'; S.authMsg = { type: 'ok', text: 'Пароль обновлён.' }; S.authBusy = false;
      const s = await Cloud.session(); if (s) await afterSignIn(s.user); else render();
    }
  } catch (e) { msg('error', humanError(e)); }
}
async function afterSignIn(user) {
  S.authBusy = false; S.authMsg = null; S.gate = false; S.reauth = false;
  if (!CLOUD.user || CLOUD.user.id !== user.id) await switchUser(user);
  S.tab = S.mergeOffer ? 'account' : 'today';
  render(true); window.scrollTo(0, 0);
  sync();
}
async function signOut() {
  if (CLOUD.pending && !confirm(`${CLOUD.pending} ${plural(CLOUD.pending, 'изменение ещё не отправлено', 'изменения ещё не отправлены', 'изменений ещё не отправлено')} в облако. Они сохранятся на этом устройстве и уйдут после следующего входа. Выйти?`)) return;
  try { await Cloud.signOut(); } catch { /* офлайн: локальная сессия всё равно удалится */ }
  LS.set(LS_GUEST, null);
  await switchUser(null);
  S.gate = true; S.tab = 'today'; S.authMode = 'signin'; S.authMsg = null;
  render(true);
}
function continueAsGuest() { LS.set(LS_GUEST, true); S.gate = false; S.tab = 'today'; render(true); }

/* --- Перенос данных, записанных без аккаунта --- */
async function checkGuestData() {
  S.mergeOffer = null;
  if (LS.get('trainee-merge-dismissed:' + CLOUD.user.id)) return;
  let g;
  try { g = await openDB(GUEST_DB); } catch { return; }
  try {
    const merged = await getOne('meta', 'mergedTo', g);
    if (merged && merged.ids && merged.ids.includes(CLOUD.user.id)) return;
    const n = (await getAll('workouts', g)).filter(w => w.finished).length;
    if (n) S.mergeOffer = { count: n };
  } finally { g.close(); }
}
async function mergeGuest() {
  const g = await openDB(GUEST_DB);
  try {
    const [gx, gw, gt] = [cleanAll('exercises', await getAll('exercises', g)), cleanAll('workouts', await getAll('workouts', g)), cleanAll('templates', await getAll('templates', g))];
    const map = new Map();
    for (const e of gx) {
      const same = S.exercises.find(x => x.name.toLowerCase() === e.name.toLowerCase());
      if (same) map.set(e.id, same.id);
      else { const n = { id: uid(), name: e.name, type: e.type, group: e.group || 'other' }; await dataPut('exercises', n); S.exercises.push(n); map.set(e.id, n.id); }
    }
    const have = new Set(S.workouts.map(w => w.id));
    for (const w of gw) {
      if (!w.finished || have.has(w.id)) continue;
      await dataPut('workouts', { ...w, templateId: null, entries: w.entries.map(e => ({ ...e, exId: map.get(e.exId) || e.exId })) });
    }
    for (const t of gt) {
      if (S.templates.some(x => x.name === t.name)) continue;
      await dataPut('templates', { ...t, id: uid(), created: Date.now(), items: t.items.map(i => ({ ...i, exId: map.get(i.exId) || i.exId })) });
    }
    const m = (await getOne('meta', 'mergedTo', g)) || { key: 'mergedTo', ids: [] };
    m.ids.push(CLOUD.user.id); await put('meta', m, g);
  } finally { g.close(); }
  S.mergeOffer = null; await reloadState(); render(); sync();
}
function mergeOffer() {
  if (!S.mergeOffer) return '';
  const n = S.mergeOffer.count;
  return `<section class="notice"><p><b>На этом устройстве есть ${n} ${plural(n, 'тренировка', 'тренировки', 'тренировок')} без аккаунта.</b>
    Перенести в аккаунт? Упражнения с одинаковым названием объединятся.</p>
    <div class="row-btns"><button class="btn primary sm" data-a="merge">Перенести</button><button class="btn ghost sm" data-a="mergeNo">Не сейчас</button></div></section>`;
}

/* --- Экран аккаунта / входа --- */
function authForm() {
  const m = S.authMode || 'signin';
  const titles = { signin: 'Вход', signup: 'Регистрация', reset: 'Сброс пароля', newpass: 'Новый пароль' };
  const submit = { signin: 'Войти', signup: 'Создать аккаунт', reset: 'Отправить ссылку', newpass: 'Сохранить пароль' };
  const busy = S.authBusy ? 'disabled aria-busy="true"' : '';
  return `<form class="sheet auth" data-form="auth" novalidate>
    ${m === 'signin' || m === 'signup' ? `<div class="seg" role="tablist">
      <button type="button" role="tab" aria-selected="${m === 'signin'}" class="${m === 'signin' ? 'on' : ''}" data-a="authMode" data-id="signin">Вход</button>
      <button type="button" role="tab" aria-selected="${m === 'signup'}" class="${m === 'signup' ? 'on' : ''}" data-a="authMode" data-id="signup">Регистрация</button></div>`
      : `<h2>${titles[m]}</h2>`}
    <div class="stack" style="margin-top:14px">
      ${m !== 'newpass' ? `<label class="field"><span>Email</span><input name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" value="${esc(S.authEmail || '')}" required></label>` : ''}
      ${m !== 'reset' ? `<label class="field"><span>${m === 'newpass' ? 'Новый пароль' : 'Пароль'}</span><input name="password" type="password" autocomplete="${m === 'signin' ? 'current-password' : 'new-password'}" minlength="${m === 'signin' ? 1 : 8}" required></label>` : ''}
      ${m === 'signup' || m === 'newpass' ? '<p class="mute small">Минимум 8 символов.</p>' : ''}
      ${S.authMsg ? `<p class="msg ${S.authMsg.type}" role="${S.authMsg.type === 'error' ? 'alert' : 'status'}">${esc(S.authMsg.text)}</p>` : ''}
      <button class="btn primary big block" type="submit" ${busy}>${S.authBusy ? 'Подожди…' : submit[m]}</button>
      ${m === 'signin' ? '<button type="button" class="btn ghost sm" data-a="authMode" data-id="reset">Забыли пароль?</button>' : ''}
      ${m === 'reset' ? '<button type="button" class="btn ghost sm" data-a="authMode" data-id="signin">Назад ко входу</button>' : ''}
    </div></form>`;
}
function viewGate() {
  return `<div class="gate">
    <div class="gate-mark">${plate([['chest', 1], ['back', 1], ['legs', 1], ['shoulders', 1]], 'big')}</div>
    <h1>Тренировки</h1>
    <p class="sub" style="margin-bottom:20px">Войди, чтобы план и история были на телефоне и ноутбуке и не пропали при очистке браузера.</p>
    ${authForm()}
    <button class="btn ghost block" style="margin-top:10px" data-a="guest">Продолжить без аккаунта</button>
    <p class="mute small" style="text-align:center;margin-top:4px">Без аккаунта данные хранятся только на этом устройстве.</p></div>`;
}
function viewAccount() {
  const back = `<button class="btn ghost sm" data-tab="today" style="margin-left:-12px">‹ Назад</button>`;
  if (!Cloud) return `${back}<header class="head"><h1>Аккаунт</h1></header>
    <div class="sheet"><p>Облако не настроено: в <code>config.js</code> нет адреса Supabase. Приложение работает без аккаунтов, данные хранятся на устройстве.</p></div>`;
  if (S.recovery) { S.authMode = 'newpass'; return `${back}<header class="head"><h1>Аккаунт</h1></header>${authForm()}`; }
  if (CLOUD.user && S.reauth) return `${back}<header class="head"><div><h1>Вход</h1><div class="sub">Сессия истекла. Данные на устройстве в порядке — войди, чтобы продолжить синхронизацию.</div></div></header>${authForm()}
    <button class="btn ghost block" style="margin-top:8px" data-a="reauthCancel">Отмена</button>`;
  if (!CLOUD.user) return `${back}<header class="head"><div><h1>Аккаунт</h1><div class="sub">Сейчас данные хранятся только на этом устройстве</div></div></header>${authForm()}`;
  return `${back}<header class="head"><h1>Аккаунт</h1></header>
    ${mergeOffer()}
    <section class="sheet">
      <div class="who"><span class="avatar big-av s-${syncState()}">${esc((CLOUD.user.email || '?')[0].toUpperCase())}</span>
        <div style="min-width:0"><div style="font-weight:600;overflow-wrap:anywhere">${esc(CLOUD.user.email || '')}</div>
        <div class="mute small">План, шаблоны и история синхронизируются между устройствами</div></div></div>
      <div id="syncStatus" style="margin-top:16px">${syncStatusHTML()}</div>
      <div class="stack" style="margin-top:14px">
        ${CLOUD.needAuth ? '<button class="btn primary block" data-a="reauth">Войти снова</button>' : '<button class="btn block" data-a="syncNow">Синхронизировать сейчас</button>'}
        <button class="btn ghost danger block" data-a="signOut">Выйти</button>
      </div></section>`;
}

/* =========================================================
   Рендер и события
   ========================================================= */
const TABS = [['today', 'Сегодня'], ['goal', 'Цель'], ['plan', 'План'], ['history', 'История'], ['progress', 'Прогресс'], ['ex', 'Упражнения', 'Упражн.']];
const VIEWS = { today: viewToday, goal: viewGoal, plan: viewPlan, history: viewHistory, progress: viewProgress, ex: viewExercises, account: viewAccount };
function render(spin = false) {
  S.spin = spin;
  const y = window.scrollY;
  const gate = S.gate && !CLOUD.user;
  document.body.classList.toggle('no-nav', gate);
  document.getElementById('app').innerHTML = gate ? viewGate() : VIEWS[S.tab]();
  const rec = !!active();
  document.getElementById('nav').innerHTML = gate ? '' : TABS.map(([k, l, sh]) =>
    `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''} ${k === 'today' && rec ? 'rec' : ''}" ${S.tab === k ? 'aria-current="page"' : ''} aria-label="${l}">${ICON[k]}<span class="lf">${l}</span><span class="ls" aria-hidden="true">${sh || l}</span></button>`).join('');
  if (!spin) window.scrollTo(0, y);
}

document.addEventListener('click', ev => {
  const tab = ev.target.closest('[data-tab]');
  if (tab) { S.tab = tab.dataset.tab; S.authMsg = null; render(S.tab === 'today'); window.scrollTo(0, 0); return; }
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
    authMode: () => {
      const em = document.querySelector('[data-form=auth] [name=email]'); if (em) S.authEmail = em.value.trim();
      S.authMode = id; S.authMsg = null; render(); document.querySelector('[data-form=auth] input')?.focus();
    },
    guest: continueAsGuest,
    signOut,
    syncNow: () => { CLOUD.error = null; sync(); },
    reauth: () => { S.reauth = true; S.authEmail = CLOUD.user.email; S.authMode = 'signin'; S.authMsg = null; render(); },
    reauthCancel: () => { S.reauth = false; render(); },
    merge: mergeGuest,
    progOn: activateProgram,
    progOff: deactivateProgram,
    progStart: () => startProgramSession(id),
    progOpen: () => { S.openSession = S.openSession === id ? null : id; render(); },
    mergeNo: () => { LS.set('trainee-merge-dismissed:' + CLOUD.user.id, true); S.mergeOffer = null; render(); },
  })[b.dataset.a]?.();
});

// Enter в поле подхода = «+»
document.addEventListener('keydown', ev => {
  if (ev.key !== 'Enter') return;
  const card = ev.target.closest('.set-input') && ev.target.closest('[data-ex]');
  if (card) { ev.preventDefault(); addSet(card.dataset.ex, card); }
});
document.addEventListener('submit', ev => {
  const f = ev.target.closest('[data-form]'); if (!f) return;
  ev.preventDefault();
  if (f.dataset.form === 'addEx') addExercise(f);
  if (f.dataset.form === 'auth' && !S.authBusy) submitAuth(f);
});
document.addEventListener('change', async ev => {
  const el = ev.target;
  if (el.id === 'progSel') { S.progressEx = el.value; render(); }
  else if (el.id === 'impFile' && el.files[0]) importJSON(el.files[0]);
  else if (el.dataset.planDay != null) setPlanDay(+el.dataset.planDay, el.value);
  else if (el.dataset.tplName) {
    const t = tplById(el.dataset.tplName); t.name = el.value.trim() || 'Без названия'; await dataPut('templates', t);
  } else if (el.dataset.tpl) {
    // Без перерисовки: иначе потеряется фокус на следующем поле
    const t = tplById(el.dataset.tpl), n = Math.max(1, Math.round(num(el.value) || 1));
    t.items[+el.dataset.i][el.dataset.k] = n; el.value = n; await dataPut('templates', t);
  }
});

// Обновление таймера активной тренировки
setInterval(() => { const el = document.getElementById('elapsed'), w = active(); if (el && w) el.textContent = mins(w) + ' мин'; }, 15000);

// Когда синхронизировать: при появлении сети, при возврате в приложение и раз в минуту
window.addEventListener('online', () => sync());
window.addEventListener('offline', refreshSyncUI);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 60_000);

// Защита от встраивания во фрейм (clickjacking): GitHub Pages не даёт поставить заголовок frame-ancestors
if (window.top !== window.self) { try { window.top.location = window.location.href; } catch { document.documentElement.innerHTML = ''; } }

(async () => {
  try {
    let user = LS.get(LS_USER);
    if (Cloud && !user) {
      // Например, вход по ссылке из письма: Supabase уже создал сессию
      try { const s = await Cloud.session(); if (s) user = s.user; } catch { /* офлайн */ }
    }
    await switchUser(Cloud ? user : null);
  } catch (err) {
    document.getElementById('app').innerHTML = `<div class="empty">Не удалось открыть хранилище браузера (${esc(err && err.message || err)}). Проверь, что не включён приватный режим.</div>`;
    return;
  }
  S.gate = !!Cloud && !CLOUD.user && !LS.get(LS_GUEST);
  render(true);
  if (Cloud) {
    Cloud.onAuth(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') { S.recovery = true; S.gate = false; S.tab = 'account'; render(); return; }
      if (event === 'SIGNED_IN' && session && (!CLOUD.user || CLOUD.user.id !== session.user.id) && !S.authBusy) await afterSignIn(session.user);
      else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') { CLOUD.needAuth = false; sync(); }
    });
    sync();
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
