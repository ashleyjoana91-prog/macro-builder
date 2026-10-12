import { useState, useRef } from 'react';

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
const cleanNum = (v) => v.replace(/[^0-9.]/g, '');

function scrollToRef(ref) {
  setTimeout(() => {
    if (ref.current) ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
}

// ---------------------------------------------------------------
// Page
// ---------------------------------------------------------------
export default function Home() {
  const [tab, setTab] = useState('macros');

  return (
    <main className="app">
      <header className="header">
        <div className="brand-mark">M</div>
        <div>
          <h1 className="brand">Macro Builder</h1>
          <p className="subtitle">UK nutrition, worked out for you</p>
        </div>
      </header>

      <div className="tabs" role="tablist">
        <button
          role="tab"
          className={`tab ${tab === 'macros' ? 'active' : ''}`}
          onClick={() => setTab('macros')}
        >
          Work out my macros
        </button>
        <button
          role="tab"
          className={`tab ${tab === 'meal' ? 'active' : ''}`}
          onClick={() => setTab('meal')}
        >
          Build me a meal
        </button>
      </div>

      {/* Both modes stay loaded so switching tabs doesn't lose your work */}
      <div style={{ display: tab === 'macros' ? 'block' : 'none' }}>
        <MacrosMode />
      </div>
      <div style={{ display: tab === 'meal' ? 'block' : 'none' }}>
        <MealMode />
      </div>
    </main>
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
      setResult(data);
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
        {result && !loading && <MacrosResult r={result} />}
      </div>
    </>
  );
}

function MacrosResult({ r }) {
  return (
    <>
      <MacroHero
        per={r.perServing}
        label={`Per serving · makes ${r.servings} ${r.servings === 1 ? 'serving' : 'servings'}`}
      />

      <section className="card">
        <h2 className="card-title">{r.title}</h2>
        <IngredientTable ingredients={r.ingredients} totals={r.totals} />
        <p className="hint">
          Whole recipe: <strong>{fmtK(r.totals.kcal)} kcal</strong> · {fmt(r.totals.protein)}g protein ·{' '}
          {fmt(r.totals.carbs)}g carbs · {fmt(r.totals.fat)}g fat · {fmt(r.totals.fibre)}g fibre
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
      setResult({ ...data, targets, mealType });
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
          <MealResult
            r={result}
            onRegenerate={() => run(true)}
            onEdit={() => scrollToRef(topRef)}
          />
        )}
      </div>
    </>
  );
}

function MealResult({ r, onRegenerate, onEdit }) {
  const time = [
    r.prepMinutes ? `${r.prepMinutes} min prep` : '',
    r.cookMinutes ? `${r.cookMinutes} min cook` : '',
  ]
    .filter(Boolean)
    .join(' · ');

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

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={onRegenerate}>
          ↻ Give me a different option
        </button>
        <button className="btn btn-ghost" onClick={onEdit}>
          Change my choices
        </button>
      </div>
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
        <button type="button" aria-label="Fewer" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>
          −
        </button>
        <span className="stepper-value">{value}</span>
        <button type="button" aria-label="More" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>
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

function IngredientTable({ ingredients, totals }) {
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
            <tr key={i}>
              <td>{ing.name}</td>
              <td>{ing.grams}g</td>
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
