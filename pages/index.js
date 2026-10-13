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

  useEffect(() => {
    setSaved(loadSaved());
  }, []);

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
    <AppCtx.Provider value={{ saved, isSaved, saveItem, removeItem, printIt, notify }}>
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
          <div className="tabs" role="tablist">
            <button
              role="tab"
              className={`tab ${tab === 'macros' ? 'active' : ''}`}
              onClick={() => setTab('macros')}
            >
              Work out my macros
            </button>
            <button role="tab" className={`tab ${tab === 'meal' ? 'active' : ''}`} onClick={() => setTab('meal')}>
              Build me a meal
            </button>
          </div>

          <div style={{ display: tab === 'macros' ? 'block' : 'none' }}>
            <MacrosMode />
          </div>
          <div style={{ display: tab === 'meal' ? 'block' : 'none' }}>
            <MealMode />
          </div>
        </div>
      </main>

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
  const { isSaved, saveItem, printIt, notify } = useApp();
  const saved = isSaved(data.id);

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
function MealMode() {
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
      setResult({ ...data, targets, mealType, id: newId() });
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
