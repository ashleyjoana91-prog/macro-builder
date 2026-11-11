import { createContext, useContext, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------
// Options shown as tappable chips
// ---------------------------------------------------------------
const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const DIETS = ['Dairy-free', 'Gluten-free', 'Vegetarian', 'Vegan', 'Pescatarian', 'Nut-free', 'No pork'];
const IDEAS = [
  'Something like a chicken curry',
  'Quick, under 20 minutes',
  'High-protein pasta',
  'Fakeaway',
  'Good for batch cooking',
  'Light and fresh',
];
const PROTEIN_CHIPS = [30, 40, 50, 60];
const EXAMPLE_RECIPE =
  '500g chicken thigh, 1 tin chopped tomatoes, 200g basmati rice, 1 tbsp olive oil, 1 onion';

const STORAGE_KEY = 'macro-builder:saved:v1';

// Shared app helpers (saving, printing, little pop-up messages)
const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

// ---------------------------------------------------------------
// Talking to our API
// ---------------------------------------------------------------
async function callApi(payload) {
  let res;
  try {
    res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Couldn't connect. Check your internet and try again.");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok || !data) {
    if (res.status === 504) throw new Error('That took too long to answer. Please try again.');
    throw new Error((data && data.error) || 'Something went wrong. Please try again.');
  }
  if (!Array.isArray(data.ingredients) || !data.perServing) {
    throw new Error('The answer came back incomplete. Please try again.');
  }
  return data;
}

// ---------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------
const fmt = (n) => String(Math.round((Number(n) || 0) * 10) / 10);
const fmtK = (n) => Math.round(Number(n) || 0).toLocaleString('en-GB');
const r1 = (n) => Math.round(n * 10) / 10;
const cleanNum = (v) => v.replace(/[^0-9.]/g, '');
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

function scrollToRef(ref) {
  setTimeout(() => {
    if (ref.current) ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
}

function totalsOf(list) {
  const t = list.reduce(
    (a, i) => ({
      kcal: a.kcal + i.kcal,
      protein: a.protein + i.protein,
      carbs: a.carbs + i.carbs,
      fat: a.fat + i.fat,
      fibre: a.fibre + i.fibre,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 }
  );
  return {
    kcal: Math.round(t.kcal),
    protein: r1(t.protein),
    carbs: r1(t.carbs),
    fat: r1(t.fat),
    fibre: r1(t.fibre),
  };
}

function perServingOf(t, n) {
  return {
    kcal: Math.round(t.kcal / n),
    protein: r1(t.protein / n),
    carbs: r1(t.carbs / n),
    fat: r1(t.fat / n),
    fibre: r1(t.fibre / n),
  };
}

// Recalculate one ingredient for a new gram amount (calories from 4 / 4 / 9)
function scaleIngredient(base, grams) {
  const f = grams / base.grams;
  const protein = r1(base.protein * f);
  const carbs = r1(base.carbs * f);
  const fat = r1(base.fat * f);
  const fibre = r1(base.fibre * f);
  return {
    ...base,
    grams: Math.round(grams),
    protein,
    carbs,
    fat,
    fibre,
    kcal: Math.round(protein * 4 + carbs * 4 + fat * 9),
  };
}

function titleOf(r) {
  return r.mode === 'meal' ? r.name : r.title;
}

function timeText(r) {
  return [r.prepMinutes ? `${r.prepMinutes} min prep` : '', r.cookMinutes ? `${r.cookMinutes} min cook` : '']
    .filter(Boolean)
    .join(' · ');
}

// ---------------------------------------------------------------
// Saving on this device
// ---------------------------------------------------------------
function loadSaved() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function storeSaved(list) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------
// Copying and sharing as text
// ---------------------------------------------------------------
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the older method
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function macroLine(m) {
  return `${fmtK(m.kcal)} kcal · ${fmt(m.protein)}g protein · ${fmt(m.carbs)}g carbs · ${fmt(m.fat)}g fat · ${fmt(m.fibre)}g fibre`;
}

function shoppingText(r) {
  return [`Shopping list – ${r.name} (serves ${r.people})`, '', ...r.ingredients.map((i) => `• ${i.name} – ${i.shopQty}`)].join(
    '\n'
  );
}

function recipeText(r) {
  const lines = [];
  if (r.mode === 'meal') {
    lines.push(r.name);
    if (r.description) lines.push(r.description);
    const t = timeText(r);
    lines.push(`Serves ${r.people}${t ? ` · ${t}` : ''}`);
    lines.push('', `Per serving: ${macroLine(r.perServing)}`);
    lines.push('', `Shopping list (for ${r.people}):`, ...r.ingredients.map((i) => `• ${i.name} – ${i.shopQty}`));
    if (r.method.length) lines.push('', 'Method:', ...r.method.map((s, i) => `${i + 1}. ${s}`));
    if (r.swap) lines.push('', `Tip: ${r.swap}`);
    lines.push('', `Whole meal: ${macroLine(r.totals)}`);
  } else {
    lines.push(`${r.title} – makes ${r.servings} ${r.servings === 1 ? 'serving' : 'servings'}`);
    lines.push('', `Per serving: ${macroLine(r.perServing)}`);
    lines.push(`Whole recipe: ${macroLine(r.totals)}`);
    lines.push(
      '',
      'Ingredients:',
      ...r.ingredients.map((i) => `• ${i.grams}g ${i.name} – ${fmtK(i.kcal)} kcal, ${fmt(i.protein)}g protein`)
    );
  }
  if (r.assumptions && r.assumptions.length) lines.push('', 'Assumptions:', ...r.assumptions.map((a) => `• ${a}`));
  lines.push('', 'Made with Macro Builder');
  return lines.join('\n');
}

// ---------------------------------------------------------------
// My week + calendar helpers
// ---------------------------------------------------------------
const PLAN_KEY = 'macro-builder:plan:v1';
const LOG_KEY = 'macro-builder:log:v1';
const TIMES_KEY = 'macro-builder:times:v1';
const TEMPLATE_URL = '/meal-plan-template.xlsx';
const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const PORTIONS = [0.5, 1, 1.5, 2];
const DEFAULT_TIMES = {
  'pre-gym shake': '06:30',
  breakfast: '08:30',
  'post-gym shake': '10:00',
  lunch: '12:30',
  afternoon: '15:30',
  'afternoon shake': '15:30',
  snack: '15:30',
  dinner: '18:30',
};

function readStore(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => isoDate(new Date());
const portionText = (p) => (p === 0.5 ? '½' : p === 1.5 ? '1½' : String(p));

// The date of that weekday in the current week (weeks start on Monday)
function dateForWeekday(dayName) {
  const idx = WEEK.indexOf(dayName);
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  return isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + (idx - dow)));
}

function niceDate(iso) {
  try {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return iso;
  }
}

function guessMeal() {
  const h = new Date().getHours();
  return h < 11 ? 'Breakfast' : h < 15 ? 'Lunch' : h < 17 ? 'Snack' : 'Dinner';
}

function defaultTime(meal, saved) {
  const k = String(meal || '').trim().toLowerCase();
  return (saved && saved[k]) || DEFAULT_TIMES[k] || '12:00';
}

function toUtcStamp(date, time, addMinutes = 0) {
  const d = new Date(`${date}T${time || '12:00'}:00`);
  d.setMinutes(d.getMinutes() + addMinutes);
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function scaled(e, portion) {
  return {
    kcal: Math.round((e.kcal || 0) * portion),
    protein: r1((e.protein || 0) * portion),
    carbs: r1((e.carbs || 0) * portion),
    fat: r1((e.fat || 0) * portion),
    fibre: r1((e.fibre || 0) * portion),
  };
}

function sumLog(entries) {
  return (entries || []).reduce(
    (a, e) => ({
      kcal: a.kcal + (e.kcal || 0),
      protein: r1(a.protein + (e.protein || 0)),
      carbs: r1(a.carbs + (e.carbs || 0)),
      fat: r1(a.fat + (e.fat || 0)),
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

const eventTitle = (meal, m) => `${meal} · ${fmtK(m.kcal)} kcal · P${fmt(m.protein)} C${fmt(m.carbs)} F${fmt(m.fat)}`;

function eventDetails(what, portion, m) {
  const lines = [];
  if (what) lines.push(what);
  lines.push(`Portion: ${portionText(portion)}`);
  lines.push(
    `${fmtK(m.kcal)} kcal · ${fmt(m.protein)}g protein · ${fmt(m.carbs)}g carbs · ${fmt(m.fat)}g fat${
      m.fibre ? ` · ${fmt(m.fibre)}g fibre` : ''
    }`
  );
  lines.push('Logged from Macro Builder');
  return lines.join('\n');
}

const icsUrl = (events) => `/api/ics?e=${encodeURIComponent(JSON.stringify(events))}`;

function googleUrl(ev) {
  const p = new URLSearchParams({ action: 'TEMPLATE', text: ev.t, dates: `${ev.s}/${ev.e}`, details: ev.d });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

// The spreadsheet reader is loaded only when someone uploads a plan
let xlsxPromise = null;
function loadXlsx() {
  if (typeof window !== 'undefined' && window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxPromise) return xlsxPromise;
  const urls = [
    'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  ];
  xlsxPromise = new Promise((resolve, reject) => {
    const tryNext = (i) => {
      if (i >= urls.length) {
        xlsxPromise = null;
        reject(new Error("Couldn't load the spreadsheet reader. Check your internet and try again."));
        return;
      }
      const s = document.createElement('script');
      s.src = urls[i];
      s.async = true;
      s.onload = () => (window.XLSX ? resolve(window.XLSX) : tryNext(i + 1));
      s.onerror = () => {
        s.remove();
        tryNext(i + 1);
      };
      document.head.appendChild(s);
    };
    tryNext(0);
  });
  return xlsxPromise;
}

function readNum(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

// Reads a meal plan laid out like the template
function parsePlan(XLSX, buffer, fileName) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'array' });
  } catch {
    throw new Error("That file couldn't be opened. Upload the meal plan as an Excel (.xlsx) file.");
  }
  const sheetName = wb.SheetNames.find((n) => n.trim().toLowerCase() === 'meal plan') || wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: true });
  const norm = (v) => String(v ?? '').trim().toLowerCase();

  const hIdx = rows.findIndex((r) => r.some((c) => norm(c) === 'day') && r.some((c) => norm(c).startsWith('kcal')));
  if (hIdx < 0) {
    throw new Error("Couldn't find the headings row. It needs Day, Meal, kcal, Protein, Carbs and Fat, like the template.");
  }
  const head = rows[hIdx].map(norm);
  const find = (test) => head.findIndex(test);
  const col = {
    day: find((h) => h === 'day'),
    type: find((h) => h.startsWith('day type')),
    meal: find((h) => h === 'meal'),
    what: find((h) => h.startsWith('what')),
    kcal: find((h) => h.startsWith('kcal') || h.startsWith('calories')),
    protein: find((h) => h.startsWith('protein')),
    carbs: find((h) => h.startsWith('carb')),
    fat: find((h) => h.startsWith('fat')),
  };
  const missing = ['day', 'meal', 'kcal', 'protein', 'carbs', 'fat'].filter((k) => col[k] < 0);
  if (missing.length) throw new Error(`Missing column: ${missing.join(', ')}. Keep the template's headings.`);

  const MACROS = [
    ['kcal', 'kcal'],
    ['protein', 'protein'],
    ['carbs', 'carbs'],
    ['fat', 'fat'],
  ];
  const cell = (r, k) => (col[k] >= 0 ? r[col[k]] : '');

  // Daily target row
  let target = null;
  const tRow = rows.find((r) => r.some((c) => norm(c) === 'daily target'));
  if (tRow) {
    const t = {};
    MACROS.forEach(([k]) => (t[k] = readNum(cell(tRow, k))));
    if (MACROS.every(([k]) => Number.isFinite(t[k]))) target = t;
  }

  const problems = [];
  const days = {};
  for (let i = hIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const rawDay = norm(cell(r, 'day'));
    const day = WEEK.find((d) => rawDay && d.toLowerCase().startsWith(rawDay.slice(0, 3)));
    if (!day) continue;
    const meal = String(cell(r, 'meal') || '').trim();
    const what = String(cell(r, 'what') || '').trim();
    if (!meal && !what) continue;

    const choice = /your choice/i.test(what);
    const vals = {};
    MACROS.forEach(([k, label]) => {
      const n = readNum(cell(r, k));
      if (Number.isNaN(n)) problems.push(`Row ${i + 1}: ${label} should be a number`);
      vals[k] = Number.isFinite(n) ? n : null;
    });
    const hasAll = MACROS.every(([k]) => vals[k] !== null);
    if (!choice && !hasAll) {
      problems.push(`Row ${i + 1} (${day} ${meal || 'meal'}): fill in kcal, protein, carbs and fat`);
      continue;
    }

    if (!days[day]) days[day] = { name: day, type: '', meals: [] };
    const type = String(cell(r, 'type') || '').trim();
    if (type && !days[day].type) days[day].type = type;
    days[day].meals.push({
      meal: meal || 'Meal',
      what,
      choice,
      hasAll,
      kcal: Math.round(vals.kcal || 0),
      protein: r1(vals.protein || 0),
      carbs: r1(vals.carbs || 0),
      fat: r1(vals.fat || 0),
      fibre: 0,
    });
  }

  if (problems.length) {
    const more = problems.length > 5 ? ` (and ${problems.length - 5} more)` : '';
    throw new Error(`Please fix these in your spreadsheet: ${problems.slice(0, 5).join('; ')}${more}.`);
  }

  const list = WEEK.filter((d) => days[d]).map((d) => days[d]);
  if (!list.length) throw new Error('No meals found. Fill in at least one day, then upload it again.');

  // "Your choice" rows with no numbers = whatever is left of the daily target
  list.forEach((d) => {
    const planned = sumLog(d.meals.filter((m) => !m.choice));
    d.meals.forEach((m) => {
      if (m.choice && !m.hasAll && target) {
        m.kcal = Math.max(0, Math.round(target.kcal - planned.kcal));
        m.protein = Math.max(0, r1(target.protein - planned.protein));
        m.carbs = Math.max(0, r1(target.carbs - planned.carbs));
        m.fat = Math.max(0, r1(target.fat - planned.fat));
      }
      delete m.hasAll;
    });
  });

  return { fileName, target, days: list, savedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------
// Page
// ---------------------------------------------------------------
export default function Home() {
  const [tab, setTab] = useState('macros');
  const [saved, setSaved] = useState([]);
  const [showSaved, setShowSaved] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [printItem, setPrintItem] = useState(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);

  // My week + calendar
  const [plan, setPlanState] = useState(null);
  const [log, setLogState] = useState({});
  const [times, setTimes] = useState({});
  const [calendarCfg, setCalendarCfg] = useState(null);
  const [mealPrefill, setMealPrefill] = useState(null);

  useEffect(() => {
    setSaved(loadSaved());
    setPlanState(readStore(PLAN_KEY, null));
    setLogState(readStore(LOG_KEY, {}));
    setTimes(readStore(TIMES_KEY, {}));
  }, []);

  function setPlan(p) {
    setPlanState(p);
    if (p) {
      if (!writeStore(PLAN_KEY, p)) notify("Couldn't save the plan on this device (private browsing?)");
    } else {
      try {
        window.localStorage.removeItem(PLAN_KEY);
      } catch {
        // nothing to do
      }
    }
  }

  function addLogs(date, entries) {
    setLogState((prev) => {
      const next = { ...prev, [date]: [...(prev[date] || []), ...entries] };
      // Keep the last 60 days only, so the phone doesn't fill up
      const cutoff = isoDate(new Date(Date.now() - 60 * 864e5));
      Object.keys(next).forEach((d) => {
        if (d < cutoff) delete next[d];
      });
      writeStore(LOG_KEY, next);
      return next;
    });
  }

  function removeLog(date, id) {
    setLogState((prev) => {
      const next = { ...prev, [date]: (prev[date] || []).filter((e) => e.id !== id) };
      writeStore(LOG_KEY, next);
      return next;
    });
  }

  function rememberTimes(pairs) {
    setTimes((prev) => {
      const next = { ...prev };
      pairs.forEach(([meal, time]) => {
        if (meal && time) next[String(meal).trim().toLowerCase()] = time;
      });
      writeStore(TIMES_KEY, next);
      return next;
    });
  }

  function buildDinner(pf) {
    setMealPrefill({ ...pf, nonce: Date.now() });
    setViewing(null);
    setTab('meal');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function notify(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  }

  function saveItem(data) {
    const item = { ...data, savedAt: new Date().toISOString() };
    const exists = saved.some((x) => x.id === item.id);
    const next = exists ? saved.map((x) => (x.id === item.id ? item : x)) : [item, ...saved];
    setSaved(next);
    const ok = storeSaved(next);
    if (!ok) notify("Couldn't save on this device (private browsing?)");
    else notify(exists ? 'Saved changes' : 'Saved to this device');
  }

  function removeItem(id) {
    const next = saved.filter((x) => x.id !== id);
    setSaved(next);
    storeSaved(next);
    if (viewing && viewing.id === id) setViewing(null);
    if (!next.length) setShowSaved(false);
    notify('Removed');
  }

  function printIt(data) {
    setPrintItem(data);
    setTimeout(() => window.print(), 150);
  }

  function openSaved(item) {
    setViewing(item);
    setShowSaved(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const isSaved = (id) => saved.some((x) => x.id === id);

  return (
    <AppCtx.Provider
      value={{
        saved,
        isSaved,
        saveItem,
        removeItem,
        printIt,
        notify,
        times,
        addLogs,
        rememberTimes,
        openCalendar: setCalendarCfg,
      }}
    >
      <main className="app">
        <header className="header">
          <div className="brand-mark">M</div>
          <div style={{ flex: 1 }}>
            <h1 className="brand">Macro Builder</h1>
            <p className="subtitle">UK nutrition, worked out for you</p>
          </div>
          {saved.length > 0 && (
            <button
              type="button"
              className={`chip ${showSaved ? 'active' : ''}`}
              onClick={() => setShowSaved((s) => !s)}
            >
              ★ Saved ({saved.length})
            </button>
          )}
        </header>

        {showSaved && saved.length > 0 && <SavedList onOpen={openSaved} onClose={() => setShowSaved(false)} />}

        {viewing && (
          <>
            <div className="saved-banner">
              <span>★ Saved recipe</span>
              <button type="button" className="link-btn" onClick={() => setViewing(null)}>
                ← Back to the app
              </button>
            </div>
            {viewing.mode === 'macros' ? (
              <MacrosResult key={viewing.id + viewing.savedAt} r={viewing} />
            ) : (
              <MealResult key={viewing.id + viewing.savedAt} r={viewing} />
            )}
          </>
        )}

        {/* Main app stays loaded underneath so nothing you've typed is lost */}
        <div style={{ display: viewing ? 'none' : 'block' }}>
          <div className="tabs" role="tablist" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <button
              role="tab"
              className={`tab ${tab === 'macros' ? 'active' : ''}`}
              onClick={() => setTab('macros')}
            >
              My macros
            </button>
            <button role="tab" className={`tab ${tab === 'meal' ? 'active' : ''}`} onClick={() => setTab('meal')}>
              Build a meal
            </button>
            <button role="tab" className={`tab ${tab === 'week' ? 'active' : ''}`} onClick={() => setTab('week')}>
              My week
            </button>
          </div>

          <div style={{ display: tab === 'macros' ? 'block' : 'none' }}>
            <MacrosMode />
          </div>
          <div style={{ display: tab === 'meal' ? 'block' : 'none' }}>
            <MealMode prefill={mealPrefill} />
          </div>
          <div style={{ display: tab === 'week' ? 'block' : 'none' }}>
            <WeekMode plan={plan} setPlan={setPlan} log={log} removeLog={removeLog} onBuildDinner={buildDinner} />
          </div>
        </div>
      </main>

      {calendarCfg && <CalendarSheet key={calendarCfg.key || 'sheet'} cfg={calendarCfg} onClose={() => setCalendarCfg(null)} />}
      <PrintView item={printItem} />
      {toast && <div className="toast">{toast}</div>}
    </AppCtx.Provider>
  );
}

// ---------------------------------------------------------------
// Saved list
// ---------------------------------------------------------------
function SavedList({ onOpen, onClose }) {
  const { saved, removeItem } = useApp();
  return (
    <section className="card saved-card">
      <div className="section-head">
        <h2 className="card-title">Saved on this device</h2>
        <button type="button" className="link-btn" onClick={onClose}>
          Close
        </button>
      </div>
      {saved.map((item) => (
        <div className="saved-item" key={item.id}>
          <button type="button" className="saved-open" onClick={() => onOpen(item)}>
            <span className="saved-name">{titleOf(item)}</span>
            <span className="saved-meta">
              {item.mode === 'meal' ? 'Meal' : 'Macros'} · {fmtK(item.perServing.kcal)} kcal ·{' '}
              {fmt(item.perServing.protein)}g protein per serving · {fmtDate(item.savedAt)}
            </span>
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Delete"
            onClick={() => {
              if (window.confirm('Delete this saved recipe?')) removeItem(item.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <p className="hint">
        These are saved in this browser only. Use Download PDF if you want a copy that lasts forever.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------
// Save / PDF / Share / Copy buttons
// ---------------------------------------------------------------
function ResultActions({ data }) {
  const { isSaved, saveItem, printIt, notify, openCalendar } = useApp();
  const saved = isSaved(data.id);

  function addToCalendar() {
    const p = data.perServing;
    openCalendar({
      key: newId(),
      pickMeal: true,
      date: data.logDate || todayIso(),
      items: [
        {
          meal: data.logMeal || (data.mode === 'meal' && data.mealType ? data.mealType : guessMeal()),
          what: titleOf(data),
          kcal: p.kcal,
          protein: p.protein,
          carbs: p.carbs,
          fat: p.fat,
          fibre: p.fibre,
        },
      ],
    });
  }

  async function share() {
    const text = recipeText(data);
    if (navigator.share) {
      try {
        await navigator.share({ title: titleOf(data), text });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // they closed the share sheet
      }
    }
    const ok = await copyText(text);
    notify(ok ? 'Copied – paste it anywhere' : "Couldn't copy on this device");
  }

  async function copyShopping() {
    const ok = await copyText(shoppingText(data));
    notify(ok ? 'Shopping list copied' : "Couldn't copy on this device");
  }

  async function copyAll() {
    const ok = await copyText(recipeText(data));
    notify(ok ? 'Copied' : "Couldn't copy on this device");
  }

  return (
    <>
    <button type="button" className="btn btn-primary btn-block" style={{ marginBottom: 10 }} onClick={addToCalendar}>
      📅 Add a portion to my calendar
    </button>
    <div className="action-grid">
      <button type="button" className={`btn ${saved ? 'is-done' : ''}`} onClick={() => saveItem(data)}>
        {saved ? '✓ Saved' : '☆ Save'}
      </button>
      <button type="button" className="btn" onClick={() => printIt(data)}>
        ⬇ Download PDF
      </button>
      <button type="button" className="btn" onClick={share}>
        ↗ Share
      </button>
      {data.mode === 'meal' ? (
        <button type="button" className="btn" onClick={copyShopping}>
          📋 Copy shopping list
        </button>
      ) : (
        <button type="button" className="btn" onClick={copyAll}>
          📋 Copy as text
        </button>
      )}
    </div>
    </>
  );
}

// ---------------------------------------------------------------
// MODE 1: Work out my macros
// ---------------------------------------------------------------
function MacrosMode() {
  const [recipe, setRecipe] = useState('');
  const [servings, setServings] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const resultsRef = useRef(null);

  async function run() {
    if (!recipe.trim()) {
      setError('Type a recipe or a list of ingredients first.');
      setResult(null);
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    scrollToRef(resultsRef);
    try {
      const data = await callApi({ mode: 'macros', recipe, servings });
      setResult({ ...data, id: newId() });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <section className="card">
        <h2 className="card-title">
          <span className="step-num">1</span>Your recipe
        </h2>
        <textarea
          className="textarea"
          value={recipe}
          onChange={(e) => setRecipe(e.target.value)}
          placeholder="e.g. 500g chicken thigh, 1 tin chopped tomatoes, 200g basmati rice, 1 tbsp olive oil, 1 onion"
        />
        <div className="chips mt">
          <button type="button" className="chip" onClick={() => setRecipe(EXAMPLE_RECIPE)}>
            Try an example
          </button>
          {recipe && (
            <button type="button" className="chip" onClick={() => setRecipe('')}>
              Clear
            </button>
          )}
        </div>
        <p className="hint">Plain English is fine. Weights are treated as raw unless you say "cooked".</p>
      </section>

      <section className="card">
        <h2 className="card-title">
          <span className="step-num">2</span>How many servings does it make?
        </h2>
        <Stepper
          value={servings}
          onChange={setServings}
          min={1}
          max={20}
          suffix={servings === 1 ? 'serving' : 'servings'}
        />
      </section>

      <button className="btn btn-primary btn-block" onClick={run} disabled={loading}>
        {loading ? 'Working it out…' : 'Work out macros'}
      </button>

      <div ref={resultsRef} className="mt" style={{ scrollMarginTop: 70 }}>
        {loading && <Loading text="Weighing up your ingredients… this can take 15–30 seconds." />}
        {error && !loading && <ErrorCard message={error} onRetry={run} />}
        {result && !loading && <MacrosResult key={result.id} r={result} />}
      </div>
    </>
  );
}

function MacrosResult({ r }) {
  // The original amounts from Claude - edits are recalculated from these
  const base = r.baseIngredients || r.ingredients;
  const [grams, setGrams] = useState(() => r.ingredients.map((i) => String(i.grams)));
  const [servings, setServings] = useState(r.servings);

  const ingredients = base.map((b, i) => {
    const g = parseFloat(grams[i]);
    if (!b.grams || !Number.isFinite(g) || g < 0) return b;
    return scaleIngredient(b, g);
  });
  const editableRows = base.map((b) => b.grams > 0);
  const edited = ingredients.map((ing, i) => ing.grams !== base[i].grams);
  const anyEdited = edited.some(Boolean);
  const totals = totalsOf(ingredients);
  const perServing = perServingOf(totals, servings);

  // This is what gets saved, shared and printed - including your edits
  const current = { ...r, baseIngredients: base, ingredients, totals, perServing, servings };

  function changeGrams(i, value) {
    const clean = cleanNum(value);
    setGrams((list) => list.map((x, j) => (j === i ? clean : x)));
  }

  function resetGrams() {
    setGrams(base.map((b) => String(b.grams)));
  }

  return (
    <>
      <MacroHero
        per={perServing}
        label={`Per serving · makes ${servings} ${servings === 1 ? 'serving' : 'servings'}`}
      />

      <ResultActions data={current} />

      <section className="card">
        <h2 className="card-title">{r.title}</h2>

        <div className="row" style={{ marginBottom: 14 }}>
          <span className="muted" style={{ fontSize: 14 }}>
            Servings
          </span>
          <Stepper value={servings} onChange={setServings} min={1} max={20} />
        </div>

        {anyEdited && (
          <div className="edited-note">
            <span>Quantities changed – totals updated.</span>
            <button type="button" className="link-btn" onClick={resetGrams}>
              Reset
            </button>
          </div>
        )}

        <IngredientTable
          ingredients={ingredients}
          totals={totals}
          editable
          grams={grams}
          editableRows={editableRows}
          edited={edited}
          onGramsChange={changeGrams}
        />
        <p className="hint">Tap a gram amount to change it. The macros recalculate instantly.</p>
        <p className="hint">
          Whole recipe: <strong>{fmtK(totals.kcal)} kcal</strong> · {fmt(totals.protein)}g protein ·{' '}
          {fmt(totals.carbs)}g carbs · {fmt(totals.fat)}g fat · {fmt(totals.fibre)}g fibre
        </p>
      </section>

      <Assumptions items={r.assumptions} />
    </>
  );
}

// ---------------------------------------------------------------
// MODE 2: Build me a meal
// ---------------------------------------------------------------
function MealMode({ prefill }) {
  const [dinnerFor, setDinnerFor] = useState(null);
  const [mealType, setMealType] = useState('Dinner');
  const [people, setPeople] = useState(2);
  const [targetMode, setTargetMode] = useState('perPerson');
  const [protein, setProtein] = useState('40');
  const [calories, setCalories] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [diets, setDiets] = useState([]);
  const [dietOther, setDietOther] = useState('');
  const [fancy, setFancy] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [lastWasRegen, setLastWasRegen] = useState(false);

  const topRef = useRef(null);
  const resultsRef = useRef(null);

  const isTotal = targetMode === 'total';
  const unitLabel = isTotal ? `total for ${people}` : 'per person';

  // "Build my dinner" from My week fills in what's left for that day
  useEffect(() => {
    if (!prefill) return;
    setMealType(prefill.mealType || 'Dinner');
    setPeople(1);
    setTargetMode('perPerson');
    setProtein(String(prefill.protein));
    setCalories(String(prefill.kcal));
    setCarbs(String(prefill.carbs));
    setFat(String(prefill.fat));
    setDinnerFor(prefill);
    setResult(null);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill && prefill.nonce]);

  function toggleDiet(d) {
    setDiets((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]));
  }

  function addIdea(idea) {
    setFancy((f) => (f.trim() ? `${f.trim()}, ${idea.toLowerCase()}` : idea));
  }

  async function run(isRegen) {
    if (!(parseFloat(protein) > 0)) {
      setError('Set a protein target first.');
      setResult(null);
      return;
    }

    // Work out per-serving targets now, so the comparison matches what was asked for
    const divider = isTotal ? people : 1;
    const targets = {};
    [
      ['kcal', calories],
      ['protein', protein],
      ['carbs', carbs],
      ['fat', fat],
    ].forEach(([key, val]) => {
      const n = parseFloat(val);
      if (n > 0) targets[key] = n / divider;
    });

    setLoading(true);
    setError('');
    setResult(null);
    setLastWasRegen(isRegen);
    scrollToRef(resultsRef);

    try {
      const data = await callApi({
        mode: 'meal',
        mealType: mealType.toLowerCase(),
        people,
        targetMode: isTotal ? 'total' : 'perPerson',
        protein,
        calories,
        carbs,
        fat,
        dietary: diets,
        dietOther,
        fancy,
        avoid: isRegen ? history : [],
      });
      setResult({
        ...data,
        targets,
        mealType,
        id: newId(),
        logDate: dinnerFor ? dinnerFor.date : undefined,
        logMeal: dinnerFor ? mealType : undefined,
      });
      setHistory(isRegen ? [...history, data.name] : [data.name]);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div ref={topRef} style={{ scrollMarginTop: 70 }} />

      {dinnerFor && (
        <section className="card" style={{ background: 'var(--accent-soft)' }}>
          <div className="section-head">
            <h2 className="card-title">
              Filling {dinnerFor.dayName}'s {String(dinnerFor.mealType || 'Dinner').toLowerCase()} · {niceDate(dinnerFor.date)}
            </h2>
            <button type="button" className="link-btn" onClick={() => setDinnerFor(null)}>
              Clear
            </button>
          </div>
          <MacroPills m={dinnerFor} />
          <p className="hint" style={{ marginBottom: 0 }}>
            Your targets below are filled in from what's left of your day. Change anything you like.
          </p>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">
          <span className="step-num">1</span>Which meal?
        </h2>
        <div className="chips">
          {MEAL_TYPES.map((m) => (
            <button
              key={m}
              type="button"
              className={`chip ${mealType === m ? 'active' : ''}`}
              onClick={() => setMealType(m)}
            >
              {m}
            </button>
          ))}
        </div>

        <label className="label">How many people?</label>
        <Stepper
          value={people}
          onChange={setPeople}
          min={1}
          max={12}
          suffix={people === 1 ? 'person' : 'people'}
        />
      </section>

      <section className="card">
        <h2 className="card-title">
          <span className="step-num">2</span>Your targets
        </h2>

        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted" style={{ fontSize: 14 }}>
            Targets are…
          </span>
          <div className="seg">
            <button
              type="button"
              className={!isTotal ? 'active' : ''}
              onClick={() => setTargetMode('perPerson')}
            >
              Per person
            </button>
            <button type="button" className={isTotal ? 'active' : ''} onClick={() => setTargetMode('total')}>
              Total
            </button>
          </div>
        </div>

        <label className="label">Protein (g) {unitLabel}</label>
        <div className="row">
          <input
            className="input input-small"
            inputMode="decimal"
            value={protein}
            onChange={(e) => setProtein(cleanNum(e.target.value))}
            placeholder="40"
          />
          <div className="chips">
            {PROTEIN_CHIPS.map((p) => {
              const v = String(isTotal ? p * people : p);
              return (
                <button
                  key={p}
                  type="button"
                  className={`chip ${protein === v ? 'active' : ''}`}
                  onClick={() => setProtein(v)}
                >
                  {v}g
                </button>
              );
            })}
          </div>
        </div>

        <label className="label">
          Other targets <span className="optional">(optional, {unitLabel})</span>
        </label>
        <div className="field-grid">
          <div>
            <label className="label">Calories</label>
            <input
              className="input"
              inputMode="decimal"
              value={calories}
              onChange={(e) => setCalories(cleanNum(e.target.value))}
              placeholder="kcal"
            />
          </div>
          <div>
            <label className="label">Carbs (g)</label>
            <input
              className="input"
              inputMode="decimal"
              value={carbs}
              onChange={(e) => setCarbs(cleanNum(e.target.value))}
              placeholder="g"
            />
          </div>
          <div>
            <label className="label">Fat (g)</label>
            <input
              className="input"
              inputMode="decimal"
              value={fat}
              onChange={(e) => setFat(cleanNum(e.target.value))}
              placeholder="g"
            />
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">
          <span className="step-num">3</span>Dietary needs <span className="optional">(optional)</span>
        </h2>
        <div className="chips">
          {DIETS.map((d) => (
            <button
              key={d}
              type="button"
              className={`chip ${diets.includes(d) ? 'active' : ''}`}
              onClick={() => toggleDiet(d)}
            >
              {d}
            </button>
          ))}
        </div>
        <input
          className="input mt"
          value={dietOther}
          onChange={(e) => setDietOther(e.target.value)}
          placeholder="Anything else? e.g. no mushrooms"
        />
      </section>

      <section className="card">
        <h2 className="card-title">
          <span className="step-num">4</span>What do you fancy?
        </h2>
        <textarea
          className="textarea"
          value={fancy}
          onChange={(e) => setFancy(e.target.value)}
          placeholder="e.g. something like a chicken curry, or I've got salmon and sweet potato"
        />
        <div className="chips mt">
          {IDEAS.map((idea) => (
            <button key={idea} type="button" className="chip" onClick={() => addIdea(idea)}>
              + {idea}
            </button>
          ))}
        </div>
      </section>

      <button className="btn btn-primary btn-block" onClick={() => run(false)} disabled={loading}>
        {loading ? 'Building your meal…' : 'Build my meal'}
      </button>

      <div ref={resultsRef} className="mt" style={{ scrollMarginTop: 70 }}>
        {loading && <Loading text="Planning your meal… this can take 20–40 seconds." />}
        {error && !loading && <ErrorCard message={error} onRetry={() => run(lastWasRegen)} />}
        {result && !loading && (
          <MealResult r={result} onRegenerate={() => run(true)} onEdit={() => scrollToRef(topRef)} />
        )}
      </div>
    </>
  );
}

function MealResult({ r, onRegenerate, onEdit }) {
  const time = timeText(r);

  return (
    <>
      <section className="card">
        <span className="badge">
          {r.mealType} · serves {r.people}
        </span>
        <h2 className="recipe-title">{r.name}</h2>
        {r.description && <p className="recipe-desc">{r.description}</p>}
        {time && <p className="hint">{time}</p>}
      </section>

      <MacroHero per={r.perServing} label="Per serving" />

      <ResultActions data={r} />

      <TargetsCard targets={r.targets} actual={r.perServing} swap={r.swap} />

      <section className="card">
        <h2 className="card-title">Shopping list · for {r.people}</h2>
        <ul className="shop-list">
          {r.ingredients.map((ing, i) => (
            <li key={i}>
              <span>{ing.name}</span>
              <span className="qty">{ing.shopQty}</span>
            </li>
          ))}
        </ul>
      </section>

      {r.method.length > 0 && (
        <section className="card">
          <h2 className="card-title">Method</h2>
          <ol className="method">
            {r.method.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">Whole meal · {r.people} servings</h2>
        <p style={{ margin: 0, fontSize: 15 }}>
          <strong>{fmtK(r.totals.kcal)} kcal</strong> · {fmt(r.totals.protein)}g protein · {fmt(r.totals.carbs)}g
          carbs · {fmt(r.totals.fat)}g fat · {fmt(r.totals.fibre)}g fibre
        </p>
        <details className="mt">
          <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14, color: 'var(--accent)' }}>
            Show ingredient breakdown
          </summary>
          <div className="mt">
            <IngredientTable ingredients={r.ingredients} totals={r.totals} />
          </div>
        </details>
      </section>

      <Assumptions items={r.assumptions} />

      {onRegenerate && (
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={onRegenerate}>
            ↻ Give me a different option
          </button>
          <button className="btn btn-ghost" onClick={onEdit}>
            Change my choices
          </button>
        </div>
      )}
    </>
  );
}

function TargetsCard({ targets, actual, swap }) {
  const rows = [
    ['kcal', 'Calories', ' kcal'],
    ['protein', 'Protein', 'g'],
    ['carbs', 'Carbs', 'g'],
    ['fat', 'Fat', 'g'],
  ].filter(([key]) => targets && targets[key]);

  if (!rows.length && !swap) return null;

  return (
    <section className="card">
      <h2 className="card-title">How close to your targets</h2>
      {rows.map(([key, label, unit]) => {
        const target = targets[key];
        const got = actual[key] || 0;
        const pct = target ? (got / target) * 100 : 0;
        const status = pct < 90 ? 'warn' : pct > 110 ? 'over' : '';
        return (
          <div className="target-row" key={key}>
            <div className="target-head">
              <span>
                {label}:{' '}
                <strong>
                  {key === 'kcal' ? fmtK(got) : fmt(got)}
                  {unit}
                </strong>{' '}
                <span className="muted">
                  of {key === 'kcal' ? fmtK(target) : fmt(target)}
                  {unit}
                </span>
              </span>
              <strong>{Math.round(pct)}%</strong>
            </div>
            <div className="bar">
              <div className={`bar-fill ${status}`} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          </div>
        );
      })}
      {rows.length > 0 && (
        <p className="hint" style={{ marginTop: 0 }}>
          Per serving. Green means within 10% of your target.
        </p>
      )}
      {swap && (
        <div className="swap">
          <strong>Fine-tune it:</strong> {swap}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------
// MODE 3: My week (uploaded meal plan)
// ---------------------------------------------------------------
function WeekMode({ plan, setPlan, log, removeLog, onBuildDinner }) {
  const { notify, openCalendar } = useApp();
  const [day, setDay] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  async function onFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const XLSX = await loadXlsx();
      const buf = await file.arrayBuffer();
      const p = parsePlan(XLSX, buf, file.name);
      setPlan(p);
      setDay(null);
      notify('Meal plan loaded');
    } catch (ex) {
      setErr(ex.message || "Couldn't read that file.");
    } finally {
      setBusy(false);
    }
  }

  const uploadInput = (
    <input
      ref={fileRef}
      type="file"
      accept=".xlsx,.xls,.csv"
      onChange={onFile}
      style={{ display: 'none' }}
      aria-label="Upload meal plan"
    />
  );

  if (!plan) {
    return (
      <>
        <section className="card">
          <h2 className="card-title">
            <span className="step-num">1</span>Load your meal plan
          </h2>
          <p style={{ margin: '0 0 14px', fontSize: 15, lineHeight: 1.5 }}>
            Upload your weekly plan as a spreadsheet. You'll see each day's meals with their macros, and can send any meal
            to your calendar in one tap.
          </p>
          {uploadInput}
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => fileRef.current && fileRef.current.click()}
            disabled={busy}
          >
            {busy ? 'Reading your plan…' : '⬆ Upload my meal plan'}
          </button>
          <a className="btn btn-block mt" href={TEMPLATE_URL} download style={{ textAlign: 'center', textDecoration: 'none' }}>
            ⬇ Download blank template
          </a>
          <p className="hint">
            New here? Download the template, fill in the yellow cells, then upload it. Your plan stays on this device only.
          </p>
        </section>
        {err && <ErrorCard message={err} onRetry={() => fileRef.current && fileRef.current.click()} />}
      </>
    );
  }

  // All seven days are always shown, even if the plan only covers some of them
  const names = WEEK;
  const todayName = WEEK[(new Date().getDay() + 6) % 7];
  const current = day || todayName;
  const dayPlan = plan.days.find((d) => d.name === current) || { name: current, type: '', meals: [] };
  const hasPlanned = dayPlan.meals.some((m) => !m.choice);
  const date = dateForWeekday(current);
  const entries = log[date] || [];
  const logged = sumLog(entries);
  const target = plan.target;

  const mealKey = (i) => `${current}|${i}`;
  const loggedFor = (i) => entries.filter((e) => e.planKey === mealKey(i));
  const toAdd = dayPlan.meals.map((m, i) => ({ m, i })).filter(({ m, i }) => !m.choice && !loggedFor(i).length);

  function itemFor(m, i) {
    return { meal: m.meal, what: m.what, kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat, fibre: 0, planKey: mealKey(i) };
  }

  function addOne(m, i) {
    openCalendar({ key: newId(), date, items: [itemFor(m, i)] });
  }

  function addWholeDay() {
    if (!toAdd.length) return;
    openCalendar({ key: newId(), date, items: toAdd.map(({ m, i }) => itemFor(m, i)) });
  }

  // What's left for a "your choice" dinner. Uses what you actually logged (e.g. 1½ portions),
  // plus your planned meals you haven't logged yet, plus any extras you've logged.
  function leftFor(m) {
    const others = entries.filter((e) => String(e.meal).toLowerCase() !== 'dinner');
    if (target && others.length) {
      const counted = [];
      dayPlan.meals.forEach((pm, i) => {
        if (pm.choice) return;
        const got = loggedFor(i);
        if (got.length) counted.push(...got);
        else counted.push(pm);
      });
      others.forEach((e) => {
        if (!e.planKey || !e.planKey.startsWith(`${current}|`)) counted.push(e);
      });
      const t = sumLog(counted);
      return {
        from: "what you've logged and what's still planned",
        kcal: Math.max(0, Math.round(target.kcal - t.kcal)),
        protein: Math.max(0, r1(target.protein - t.protein)),
        carbs: Math.max(0, r1(target.carbs - t.carbs)),
        fat: Math.max(0, r1(target.fat - t.fat)),
      };
    }
    return { from: 'your plan', kcal: m.kcal, protein: m.protein, carbs: m.carbs, fat: m.fat };
  }

  const leftAfterLogged = target
    ? {
        kcal: Math.max(0, Math.round(target.kcal - logged.kcal)),
        protein: Math.max(0, r1(target.protein - logged.protein)),
        carbs: Math.max(0, r1(target.carbs - logged.carbs)),
        fat: Math.max(0, r1(target.fat - logged.fat)),
      }
    : null;

  const bars = target
    ? [
        ['kcal', 'Calories', ' kcal'],
        ['protein', 'Protein', 'g'],
        ['carbs', 'Carbs', 'g'],
        ['fat', 'Fat', 'g'],
      ]
    : [];

  return (
    <>
      {uploadInput}

      <section className="card">
        <div className="section-head" style={{ marginBottom: 6 }}>
          <h2 className="card-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📄 {plan.fileName}
          </h2>
          <button type="button" className="link-btn" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>
            {busy ? 'Reading…' : 'Replace'}
          </button>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          {target
            ? `Daily target: ${fmtK(target.kcal)} kcal · ${fmt(target.protein)}g protein · ${fmt(target.carbs)}g carbs · ${fmt(target.fat)}g fat`
            : 'No daily target found in your plan. Add one to see your progress bars.'}
        </p>
        <p className="hint" style={{ marginBottom: 0 }}>
          <a href={TEMPLATE_URL} download style={{ color: 'var(--accent)', fontWeight: 600 }}>
            Download blank template
          </a>{' '}
          to share with someone else.
        </p>
      </section>

      {err && <ErrorCard message={err} onRetry={() => fileRef.current && fileRef.current.click()} />}

      <div className="chips" style={{ marginBottom: 14 }}>
        {names.map((n) => (
          <button key={n} type="button" className={`chip ${n === current ? 'active' : ''}`} onClick={() => setDay(n)}>
            {n.slice(0, 3)}
          </button>
        ))}
      </div>

      <section className="card">
        <div className="section-head">
          <h2 className="card-title">
            {current} · {niceDate(date)}
          </h2>
          {dayPlan.type && <span className="badge">{dayPlan.type}</span>}
        </div>
        <div className="hero-label" style={{ marginBottom: 4 }}>
          Logged that day
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 10 }}>
          {fmtK(logged.kcal)} <span className="muted" style={{ fontSize: 15, fontWeight: 600 }}>
            {target ? `/ ${fmtK(target.kcal)} kcal` : 'kcal'}
          </span>
        </div>
        {bars.map(([k, label, unit]) => {
          const pct = target[k] ? (logged[k] / target[k]) * 100 : 0;
          return (
            <div className="target-row" key={k}>
              <div className="target-head">
                <span>
                  {label}: <strong>{k === 'kcal' ? fmtK(logged[k]) : fmt(logged[k])}{unit}</strong>{' '}
                  <span className="muted">of {k === 'kcal' ? fmtK(target[k]) : fmt(target[k])}{unit}</span>
                </span>
                <strong>{Math.round(pct)}%</strong>
              </div>
              <div className="bar">
                <div className={`bar-fill ${pct > 110 ? 'over' : ''}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            </div>
          );
        })}
        {entries.length > 0 && (
          <div className="mt">
            {entries.map((e) => (
              <div className="saved-item" key={e.id}>
                <div className="saved-open" style={{ cursor: 'default' }}>
                  <span className="saved-name">
                    {e.time} · {e.meal}
                    {e.portion !== 1 ? ` (${portionText(e.portion)}×)` : ''}
                  </span>
                  <span className="saved-meta">
                    {fmtK(e.kcal)} kcal · P{fmt(e.protein)} C{fmt(e.carbs)} F{fmt(e.fat)}
                  </span>
                </div>
                <button type="button" className="icon-btn" aria-label={`Remove ${e.meal}`} onClick={() => removeLog(date, e.id)}>
                  ✕
                </button>
              </div>
            ))}
            <p className="hint" style={{ marginBottom: 0 }}>
              Removing here updates your totals only. Delete the calendar entry in your calendar app.
            </p>
          </div>
        )}
      </section>

      {dayPlan.meals.map((m, i) => {
        const done = loggedFor(i);
        const left = m.choice ? leftFor(m) : null;
        return (
          <section className="card" key={`${current}-${i}`}>
            <div className="section-head" style={{ marginBottom: 6 }}>
              <h3 className="card-title">{m.meal}</h3>
            </div>
            {m.what && (
              <p style={{ margin: '0 0 10px', fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>{m.what}</p>
            )}
            {m.choice ? (
              <>
                <MacroPills m={left} />
                <p className="hint">What's left, based on {left.from}.</p>
                <button
                  type="button"
                  className="btn btn-secondary btn-block"
                  onClick={() =>
                    onBuildDinner({
                      dayName: current,
                      date,
                      mealType: 'Dinner',
                      kcal: left.kcal,
                      protein: left.protein,
                      carbs: left.carbs,
                      fat: left.fat,
                    })
                  }
                >
                  ✨ Build my dinner to fit
                </button>
              </>
            ) : (
              <>
                <MacroPills m={m} />
                <button
                  type="button"
                  className={`btn btn-block mt ${done.length ? 'is-done' : ''}`}
                  onClick={() => addOne(m, i)}
                >
                  {done.length
                    ? `✓ Added${done[0].portion !== 1 ? ` · ${portionText(done[0].portion)}×` : ''} · add again`
                    : '📅 Add to calendar'}
                </button>
              </>
            )}
          </section>
        );
      })}

      {!dayPlan.meals.length && (
        <section className="card">
          <h3 className="card-title">Nothing planned for {current}</h3>
          {target ? (
            <>
              <MacroPills m={leftAfterLogged} />
              <p className="hint">What's left of your daily target, after anything you've logged.</p>
              <button
                type="button"
                className="btn btn-secondary btn-block"
                onClick={() =>
                  onBuildDinner({ dayName: current, date, mealType: guessMeal(), ...leftAfterLogged })
                }
              >
                ✨ Build a meal to fit
              </button>
            </>
          ) : (
            <p className="hint" style={{ margin: 0 }}>Log what you eat below and it adds up here.</p>
          )}
        </section>
      )}

      <ExtraLog date={date} dayName={current} />

      {hasPlanned && (
        <button type="button" className="btn btn-primary btn-block" onClick={addWholeDay} disabled={!toAdd.length}>
          {toAdd.length ? `📅 Add whole day (${toAdd.length} ${toAdd.length === 1 ? 'meal' : 'meals'})` : '✓ All planned meals added'}
        </button>
      )}

      <WeekExport plan={plan} log={log} />

      <div style={{ textAlign: 'center' }} className="mt">
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            if (window.confirm('Remove this meal plan from this device?')) setPlan(null);
          }}
        >
          Remove meal plan
        </button>
      </div>
    </>
  );
}

// Log something that isn't on the plan (weekends, a coffee, a meal out)
function ExtraLog({ date, dayName }) {
  const { openCalendar, notify } = useApp();
  const [open, setOpen] = useState(false);
  const [what, setWhat] = useState('');
  const [vals, setVals] = useState({ kcal: '', protein: '', carbs: '', fat: '' });

  const setVal = (k, v) => setVals((x) => ({ ...x, [k]: cleanNum(v) }));

  function go() {
    const n = (k) => parseFloat(vals[k]) || 0;
    const protein = n('protein');
    const carbs = n('carbs');
    const fat = n('fat');
    // If calories are left blank, work them out from the macros (4 / 4 / 9)
    const kcal = n('kcal') || Math.round(protein * 4 + carbs * 4 + fat * 9);
    if (!kcal && !protein && !carbs && !fat) {
      notify('Add the calories or macros first');
      return;
    }
    openCalendar({
      key: newId(),
      date,
      pickMeal: true,
      items: [{ meal: guessMeal(), what: what.trim(), kcal, protein, carbs, fat, fibre: 0 }],
    });
    setWhat('');
    setVals({ kcal: '', protein: '', carbs: '', fat: '' });
    setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-block" style={{ marginBottom: 14 }} onClick={() => setOpen(true)}>
        ➕ Log something not on the plan
      </button>
    );
  }

  return (
    <section className="card">
      <div className="section-head">
        <h3 className="card-title">Log something else · {dayName}</h3>
        <button type="button" className="link-btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <label className="label" htmlFor="extra-what">
        What did you have?
      </label>
      <input
        id="extra-what"
        className="input"
        value={what}
        onChange={(e) => setWhat(e.target.value)}
        placeholder="e.g. Flat white and a banana"
      />
      <div className="field-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
        {[
          ['kcal', 'Calories'],
          ['protein', 'Protein (g)'],
          ['carbs', 'Carbs (g)'],
          ['fat', 'Fat (g)'],
        ].map(([k, label]) => (
          <div key={k}>
            <label className="label" htmlFor={`extra-${k}`}>
              {label}
            </label>
            <input
              id={`extra-${k}`}
              className="input"
              inputMode="decimal"
              value={vals[k]}
              onChange={(e) => setVal(k, e.target.value)}
              placeholder={k === 'kcal' ? 'kcal' : 'g'}
            />
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-primary btn-block mt" onClick={go}>
        📅 Add to calendar
      </button>
      <p className="hint" style={{ marginBottom: 0 }}>
        Leave calories blank and they're worked out from the macros. Don't know the macros? Use My macros, then "Add a
        portion to my calendar".
      </p>
    </section>
  );
}

// ---------------------------------------------------------------
// Export a week of logged meals
// ---------------------------------------------------------------
function weekDays(offsetWeeks) {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  return WEEK.map((name, i) => ({
    name,
    date: isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + i + offsetWeeks * 7)),
  }));
}

function WeekExport({ plan, log }) {
  const { notify, printIt } = useApp();
  const [offset, setOffset] = useState(0);
  const days = weekDays(offset);
  const target = plan && plan.target;
  const range = `${niceDate(days[0].date)} – ${niceDate(days[6].date)}`;

  const perDay = days.map((d) => {
    const entries = (log[d.date] || []).slice().sort((a, b) => String(a.time).localeCompare(String(b.time)));
    return { ...d, entries, t: sumLog(entries) };
  });
  const logged = perDay.filter((d) => d.entries.length);
  const week = sumLog(logged.map((d) => d.t));
  const avg = (k) => (logged.length ? week[k] / logged.length : 0);

  // Uses the same print-to-PDF as recipes: choose "Save as PDF" in the print screen
  function downloadPdf() {
    if (!logged.length) return;
    printIt({ mode: 'week', range, perDay, week, logged: logged.length, avg: { kcal: avg('kcal'), protein: avg('protein'), carbs: avg('carbs'), fat: avg('fat') }, target });
  }

  function weekText() {
    const lines = [`My macros · week of ${range}`, ''];
    perDay.forEach((d) => {
      if (!d.entries.length) return;
      lines.push(`${d.name} ${niceDate(d.date)}: ${fmtK(d.t.kcal)} kcal · P${fmt(d.t.protein)} C${fmt(d.t.carbs)} F${fmt(d.t.fat)}`);
      d.entries.forEach((e) =>
        lines.push(`  ${e.time} ${e.meal}${e.portion !== 1 ? ` (${portionText(e.portion)}×)` : ''}: ${fmtK(e.kcal)} kcal · P${fmt(e.protein)}`)
      );
    });
    lines.push('');
    lines.push(`Daily average (${logged.length} days): ${fmtK(avg('kcal'))} kcal · P${fmt(avg('protein'))} C${fmt(avg('carbs'))} F${fmt(avg('fat'))}`);
    if (target) lines.push(`Daily target: ${fmtK(target.kcal)} kcal · P${fmt(target.protein)} C${fmt(target.carbs)} F${fmt(target.fat)}`);
    lines.push('', 'Made with Macro Builder');
    return lines.join('\n');
  }

  async function shareText() {
    if (!logged.length) return;
    const text = weekText();
    if (navigator.share) {
      try {
        await navigator.share({ title: `Macros week of ${range}`, text });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    const ok = await copyText(text);
    notify(ok ? 'Copied – paste it anywhere' : "Couldn't copy on this device");
  }

  return (
    <section className="card mt">
      <h3 className="card-title">Export a week</h3>
      <div className="chips">
        <button type="button" className={`chip ${offset === 0 ? 'active' : ''}`} onClick={() => setOffset(0)}>
          This week
        </button>
        <button type="button" className={`chip ${offset === -1 ? 'active' : ''}`} onClick={() => setOffset(-1)}>
          Last week
        </button>
      </div>
      <p className="hint">
        {range} ·{' '}
        {logged.length
          ? `${logged.length} ${logged.length === 1 ? 'day' : 'days'} logged · average ${fmtK(avg('kcal'))} kcal, ${fmt(avg('protein'))}g protein a day`
          : 'nothing logged yet'}
      </p>
      <div className="action-grid">
        <button type="button" className="btn" onClick={downloadPdf} disabled={!logged.length}>
          ⬇ Download PDF
        </button>
        <button type="button" className="btn" onClick={shareText} disabled={!logged.length}>
          ↗ Share as text
        </button>
      </div>
    </section>
  );
}

function MacroPills({ m }) {
  const pill = (bg, color, text) => (
    <span style={{ fontSize: 13, fontWeight: 700, padding: '5px 10px', borderRadius: 9, background: bg, color }}>{text}</span>
  );
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {pill('var(--ink)', '#fff', `${fmtK(m.kcal)} kcal`)}
      {pill('var(--protein-soft)', 'var(--ink)', `P ${fmt(m.protein)}g`)}
      {pill('var(--carbs-soft)', 'var(--ink)', `C ${fmt(m.carbs)}g`)}
      {pill('var(--fat-soft)', 'var(--ink)', `F ${fmt(m.fat)}g`)}
    </div>
  );
}

// ---------------------------------------------------------------
// Add to calendar pop-up
// ---------------------------------------------------------------
function CalendarSheet({ cfg, onClose }) {
  const { times, addLogs, rememberTimes, notify } = useApp();
  const single = cfg.items.length === 1;
  const [date, setDate] = useState(cfg.date || todayIso());
  const [portion, setPortion] = useState(1);
  const [mealName, setMealName] = useState(cfg.items[0].meal);
  const [timeList, setTimeList] = useState(() => cfg.items.map((it) => defaultTime(it.meal, times)));

  const rows = cfg.items.map((it, i) => {
    const por = single ? portion : 1;
    const meal = single && cfg.pickMeal ? mealName : it.meal;
    const m = scaled(it, por);
    const time = timeList[i] || '12:00';
    return {
      it,
      meal,
      m,
      por,
      time,
      ev: {
        t: eventTitle(meal, m),
        d: eventDetails(it.what, por, m),
        s: toUtcStamp(date, time),
        e: toUtcStamp(date, time, 15),
      },
    };
  });

  function setTimeAt(i, v) {
    setTimeList((list) => list.map((t, j) => (j === i ? v : t)));
  }

  function finish(kind) {
    // Open the calendar first, while the tap still counts (stops pop-up blockers)
    if (kind === 'google') window.open(googleUrl(rows[0].ev), '_blank', 'noopener');
    addLogs(
      date,
      rows.map((r) => ({
        id: newId(),
        meal: r.meal,
        what: r.it.what,
        planKey: r.it.planKey,
        portion: r.por,
        time: r.time,
        kcal: r.m.kcal,
        protein: r.m.protein,
        carbs: r.m.carbs,
        fat: r.m.fat,
      }))
    );
    rememberTimes(rows.map((r) => [r.meal, r.time]));
    notify(single ? `${rows[0].meal} logged` : `${rows.length} meals logged`);
    onClose();
    if (kind === 'ics') window.location.href = icsUrl(rows.map((r) => r.ev));
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add to calendar"
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(27,29,26,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--card)',
          width: '100%',
          maxWidth: 640,
          maxHeight: '90vh',
          overflowY: 'auto',
          borderRadius: '22px 22px 0 0',
          padding: '18px 18px calc(22px + env(safe-area-inset-bottom))',
          boxSizing: 'border-box',
        }}
      >
        <div className="section-head">
          <h2 className="card-title">{single ? 'Add to calendar' : 'Add whole day'}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>

        {single && cfg.pickMeal && (
          <>
            <label className="label">Which meal?</label>
            <div className="chips">
              {MEAL_TYPES.map((m) => (
                <button key={m} type="button" className={`chip ${mealName === m ? 'active' : ''}`} onClick={() => setMealName(m)}>
                  {m}
                </button>
              ))}
            </div>
          </>
        )}

        {single && (
          <>
            <label className="label">How much did you have?</label>
            <div className="chips">
              {PORTIONS.map((p) => (
                <button key={p} type="button" className={`chip ${portion === p ? 'active' : ''}`} onClick={() => setPortion(p)}>
                  {portionText(p)} {p <= 1 ? 'portion' : 'portions'}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="field-grid" style={{ gridTemplateColumns: single ? '1fr 1fr' : '1fr' }}>
          <div>
            <label className="label" htmlFor="cal-date">
              Date
            </label>
            <input id="cal-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || todayIso())} />
          </div>
          {single && (
            <div>
              <label className="label" htmlFor="cal-time">
                Time
              </label>
              <input id="cal-time" className="input" type="time" value={timeList[0]} onChange={(e) => setTimeAt(0, e.target.value)} />
            </div>
          )}
        </div>

        <label className="label">{single ? 'Calendar entry' : 'Calendar entries'}</label>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{ border: '1px solid var(--line)', borderLeft: '4px solid var(--accent)', borderRadius: 12, padding: '10px 12px', marginBottom: 8 }}
          >
            <div style={{ fontWeight: 700, fontSize: 14 }}>{r.ev.t}</div>
            {single ? (
              <div className="muted" style={{ fontSize: 13, marginTop: 4, whiteSpace: 'pre-line' }}>
                {r.ev.d}
              </div>
            ) : (
              <div className="row" style={{ marginTop: 6 }}>
                <label className="muted" style={{ fontSize: 13 }} htmlFor={`cal-time-${i}`}>
                  Time
                </label>
                <input
                  id={`cal-time-${i}`}
                  className="input input-small"
                  type="time"
                  value={timeList[i]}
                  onChange={(e) => setTimeAt(i, e.target.value)}
                />
              </div>
            )}
          </div>
        ))}

        <button type="button" className="btn btn-primary btn-block mt" onClick={() => finish('ics')}>
          📅 Apple / Outlook / phone calendar
        </button>
        {single && (
          <button type="button" className="btn btn-secondary btn-block mt" onClick={() => finish('google')}>
            Google Calendar
          </button>
        )}
        <p className="hint" style={{ marginBottom: 0 }}>
          {single
            ? 'Your calendar opens with the entry filled in, so you can pick which calendar it goes in (e.g. a "Macros" calendar).'
            : 'Your calendar opens with every meal filled in. Google Calendar users: add meals one at a time with the Google button instead.'}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------
function Stepper({ value, onChange, min = 1, max = 20, suffix }) {
  return (
    <div className="row">
      <div className="stepper">
        <button
          type="button"
          aria-label="Fewer"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
        >
          −
        </button>
        <span className="stepper-value">{value}</span>
        <button
          type="button"
          aria-label="More"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
        >
          +
        </button>
      </div>
      {suffix && <span className="muted">{suffix}</span>}
    </div>
  );
}

function MacroHero({ per, label }) {
  return (
    <section className="card hero">
      <div className="hero-label">{label}</div>
      <div className="hero-kcal">
        {fmtK(per.kcal)}
        <span>kcal</span>
      </div>
      <div className="macro-grid">
        <MacroTile cls="p" value={per.protein} label="Protein" />
        <MacroTile cls="c" value={per.carbs} label="Carbs" />
        <MacroTile cls="f" value={per.fat} label="Fat" />
        <MacroTile cls="fi" value={per.fibre} label="Fibre" />
      </div>
    </section>
  );
}

function MacroTile({ cls, value, label }) {
  return (
    <div className={`macro-tile ${cls}`}>
      <div className="val">{fmt(value)}g</div>
      <div className="lbl">{label}</div>
    </div>
  );
}

function IngredientTable({ ingredients, totals, editable, grams, editableRows, edited, onGramsChange }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Ingredient</th>
            <th>Grams</th>
            <th>kcal</th>
            <th>Protein</th>
            <th>Carbs</th>
            <th>Fat</th>
            <th>Fibre</th>
          </tr>
        </thead>
        <tbody>
          {ingredients.map((ing, i) => (
            <tr key={i} className={edited && edited[i] ? 'is-edited' : ''}>
              <td>{ing.name}</td>
              <td>
                {editable && editableRows && editableRows[i] ? (
                  <input
                    className="qty-input"
                    inputMode="decimal"
                    value={grams[i]}
                    onChange={(e) => onGramsChange(i, e.target.value)}
                    aria-label={`Grams of ${ing.name}`}
                  />
                ) : (
                  `${ing.grams}g`
                )}
              </td>
              <td>{fmtK(ing.kcal)}</td>
              <td className="p">{fmt(ing.protein)}</td>
              <td>{fmt(ing.carbs)}</td>
              <td>{fmt(ing.fat)}</td>
              <td>{fmt(ing.fibre)}</td>
            </tr>
          ))}
          <tr className="total-row">
            <td>Total</td>
            <td></td>
            <td>{fmtK(totals.kcal)}</td>
            <td className="p">{fmt(totals.protein)}</td>
            <td>{fmt(totals.carbs)}</td>
            <td>{fmt(totals.fat)}</td>
            <td>{fmt(totals.fibre)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Assumptions({ items }) {
  if (!items || !items.length) return null;
  return (
    <section className="card">
      <h2 className="card-title">What I assumed</h2>
      <ul className="notes">
        {items.map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ul>
    </section>
  );
}

function Loading({ text }) {
  return (
    <div className="card loading">
      <div className="spinner" />
      {text}
    </div>
  );
}

function ErrorCard({ message, onRetry }) {
  return (
    <div className="error-card" role="alert">
      <h3>Hmm, that didn't work</h3>
      <p>{message}</p>
      <button className="btn btn-primary btn-small" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

// ---------------------------------------------------------------
// Printer-friendly version (used for Download PDF)
// ---------------------------------------------------------------
function PrintView({ item }) {
  if (!item) return <div className="print-area" />;
  if (item.mode === 'week') return <WeekPrint item={item} />;
  const isMeal = item.mode === 'meal';
  const per = item.perServing;
  const time = timeText(item);

  return (
    <div className="print-area">
      <h1>{titleOf(item)}</h1>
      <p className="print-meta">
        {isMeal
          ? `${item.mealType} · serves ${item.people}${time ? ` · ${time}` : ''}`
          : `Makes ${item.servings} ${item.servings === 1 ? 'serving' : 'servings'}`}
      </p>
      {isMeal && item.description && <p className="print-desc">{item.description}</p>}

      <div className="print-macros">
        <div>
          <span>Per serving:</span> {fmtK(per.kcal)} kcal
        </div>
        <div>{fmt(per.protein)}g protein</div>
        <div>{fmt(per.carbs)}g carbs</div>
        <div>{fmt(per.fat)}g fat</div>
        <div>{fmt(per.fibre)}g fibre</div>
      </div>

      {isMeal && (
        <>
          <h2>Shopping list (for {item.people})</h2>
          <ul className="print-shop">
            {item.ingredients.map((ing, i) => (
              <li key={i}>
                <span>{ing.name}</span>
                <strong>{ing.shopQty}</strong>
              </li>
            ))}
          </ul>

          {item.method.length > 0 && (
            <>
              <h2>Method</h2>
              <ol>
                {item.method.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </>
          )}

          {item.swap && (
            <>
              <h2>Fine-tune it</h2>
              <p>{item.swap}</p>
            </>
          )}
        </>
      )}

      <h2>{isMeal ? 'Ingredient breakdown (whole meal)' : 'Ingredients (whole recipe)'}</h2>
      <PrintTable ingredients={item.ingredients} totals={item.totals} />

      {item.assumptions && item.assumptions.length > 0 && (
        <>
          <h2>Assumptions</h2>
          <ul>
            {item.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </>
      )}

      <p className="print-footer">
        Made with Macro Builder · {fmtDate(new Date().toISOString())}. Nutrition values are estimates based on UK
        data and raw weights.
      </p>
    </div>
  );
}

function WeekPrint({ item }) {
  const { perDay, week, avg, target, range } = item;
  const vs = (got, want) => {
    const d = Math.round(got - want);
    return d === 0 ? 'on target' : d > 0 ? `+${fmtK(d)}` : `−${fmtK(-d)}`;
  };
  return (
    <div className="print-area">
      <h1>My week of macros</h1>
      <p className="print-meta">
        {range} · {item.logged} {item.logged === 1 ? 'day' : 'days'} logged
      </p>

      <div className="print-macros">
        <div>
          <span>Daily average:</span> {fmtK(avg.kcal)} kcal
        </div>
        <div>{fmt(avg.protein)}g protein</div>
        <div>{fmt(avg.carbs)}g carbs</div>
        <div>{fmt(avg.fat)}g fat</div>
      </div>
      {target && (
        <p className="print-desc">
          Daily target: {fmtK(target.kcal)} kcal · {fmt(target.protein)}g protein · {fmt(target.carbs)}g carbs ·{' '}
          {fmt(target.fat)}g fat
        </p>
      )}

      <h2>Day by day</h2>
      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th>kcal</th>
            <th>Protein</th>
            <th>Carbs</th>
            <th>Fat</th>
            {target && <th>kcal vs target</th>}
            {target && <th>Protein vs target</th>}
          </tr>
        </thead>
        <tbody>
          {perDay.map((d) => (
            <tr key={d.date}>
              <td>
                {d.name} {niceDate(d.date).replace(/^\w+ /, '')}
              </td>
              {d.entries.length ? (
                <>
                  <td>{fmtK(d.t.kcal)}</td>
                  <td>{fmt(d.t.protein)}g</td>
                  <td>{fmt(d.t.carbs)}g</td>
                  <td>{fmt(d.t.fat)}g</td>
                  {target && <td>{vs(d.t.kcal, target.kcal)}</td>}
                  {target && <td>{vs(d.t.protein, target.protein)}g</td>}
                </>
              ) : (
                <td colSpan={target ? 6 : 4}>Nothing logged</td>
              )}
            </tr>
          ))}
          <tr className="total-row">
            <td>Week total</td>
            <td>{fmtK(week.kcal)}</td>
            <td>{fmt(week.protein)}g</td>
            <td>{fmt(week.carbs)}g</td>
            <td>{fmt(week.fat)}g</td>
            {target && <td></td>}
            {target && <td></td>}
          </tr>
        </tbody>
      </table>

      <h2>Meals logged</h2>
      {perDay
        .filter((d) => d.entries.length)
        .map((d) => (
          <div key={d.date} style={{ breakInside: 'avoid' }}>
            <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>
              {d.name} {niceDate(d.date).replace(/^\w+ /, '')} · {fmtK(d.t.kcal)} kcal · {fmt(d.t.protein)}g protein
            </h3>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Meal</th>
                  <th>What</th>
                  <th>kcal</th>
                  <th>P</th>
                  <th>C</th>
                  <th>F</th>
                </tr>
              </thead>
              <tbody>
                {d.entries.map((e) => (
                  <tr key={e.id}>
                    <td>{e.time}</td>
                    <td>
                      {e.meal}
                      {e.portion !== 1 ? ` (${portionText(e.portion)}×)` : ''}
                    </td>
                    <td>{e.what || ''}</td>
                    <td>{fmtK(e.kcal)}</td>
                    <td>{fmt(e.protein)}</td>
                    <td>{fmt(e.carbs)}</td>
                    <td>{fmt(e.fat)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      <p className="print-footer">
        Made with Macro Builder · {fmtDate(new Date().toISOString())}. Figures are as logged in the app; plan values come
        from your meal plan.
      </p>
    </div>
  );
}

function PrintTable({ ingredients, totals }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Ingredient</th>
          <th>Grams</th>
          <th>kcal</th>
          <th>Protein</th>
          <th>Carbs</th>
          <th>Fat</th>
          <th>Fibre</th>
        </tr>
      </thead>
      <tbody>
        {ingredients.map((ing, i) => (
          <tr key={i}>
            <td>{ing.name}</td>
            <td>{ing.grams}g</td>
            <td>{fmtK(ing.kcal)}</td>
            <td>{fmt(ing.protein)}</td>
            <td>{fmt(ing.carbs)}</td>
            <td>{fmt(ing.fat)}</td>
            <td>{fmt(ing.fibre)}</td>
          </tr>
        ))}
        <tr className="total-row">
          <td>Total</td>
          <td></td>
          <td>{fmtK(totals.kcal)}</td>
          <td>{fmt(totals.protein)}</td>
          <td>{fmt(totals.carbs)}</td>
          <td>{fmt(totals.fat)}</td>
          <td>{fmt(totals.fibre)}</td>
        </tr>
      </tbody>
    </table>
  );
}
