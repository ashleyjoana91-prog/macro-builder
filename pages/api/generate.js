// Allow up to 60 seconds for Claude to answer
export const config = { maxDuration: 60 };

// Change the model here if you ever want to
const MODEL = 'claude-sonnet-5-5';
const MAX_TOKENS = 6000;

// ---------------------------------------------------------------
// Accuracy rules - sent to Claude with every request
// ---------------------------------------------------------------
const SYSTEM_PROMPT = `You are a precise UK nutrition calculator and practical home-cooking recipe developer.

ACCURACY RULES (always follow):
1. Use UK nutrition values: McCance and Widdowson's Composition of Foods (CoFID) first, and typical UK supermarket label values where CoFID has no good match. Pick the closest specific match (e.g. "chicken thigh, boneless, skinless, raw", not just "chicken").
2. Base all values on RAW / uncooked weights, unless the user clearly says an item is cooked, drained or ready-to-eat. If they do, use the cooked/drained values and say so in the assumptions.
3. Always work in grams. Convert cups, spoons, tins, pieces, handfuls and items (e.g. "1 onion") into grams and record every conversion in the assumptions. Useful UK defaults: 1 tsp = 5 ml, 1 tbsp = 15 ml, 1 cup = 240 ml; 1 tbsp olive oil = 14 g; 1 tin chopped tomatoes = 400 g; 1 medium onion = 150 g; 1 garlic clove = 5 g; 1 medium egg = 50 g (without shell); 1 medium sweet potato = 200 g; 1 medium carrot = 80 g. For liquids, 1 ml = 1 g unless density clearly matters (e.g. oil, honey).
4. "carbs" means available carbohydrate as on UK labels. Fibre is listed separately and NOT included in carbs.
5. Calories must match the macros: kcal = (protein x 4) + (carbs x 4) + (fat x 9) for every ingredient. Double-check your arithmetic and totals before answering.
6. List every ingredient, including small ones (oil, butter, sauces, honey). Salt, pepper, water and dried spices can be listed with zero or tiny values.
7. Rounding: grams to whole numbers, macros to 1 decimal place, kcal to whole numbers.

OUTPUT RULES:
- Reply with ONE valid JSON object only. No markdown, no code fences, no text before or after it.
- All numbers must be plain numbers (e.g. 31.5), never strings and never with units.
- If the request is not about food, or you genuinely cannot understand it, reply with: {"ok": false, "message": "<short friendly explanation of what to change>"}`;

// ---------------------------------------------------------------
// Prompts for each mode
// ---------------------------------------------------------------
function buildMacrosPrompt(body) {
  const recipe = String(body.recipe || '').trim();
  const servings = clampInt(body.servings, 1, 50);
  if (!recipe) throw new Error('Please type a recipe or list of ingredients first.');
  if (recipe.length > 4000) throw new Error('That recipe is very long. Try trimming it down a bit.');

  return `MODE: Work out the macros for a recipe.

The recipe makes ${servings} serving(s).

Recipe / ingredients:
"""
${recipe}
"""

Instructions:
- One entry per ingredient, in the order given.
- "grams" is the raw weight you assumed for the WHOLE recipe.
- protein, carbs, fat, fibre and kcal are for that full gram amount (not per 100 g).
- "assumptions": short notes for every conversion or guess, e.g. "1 onion = 150g", "rice weighed raw", "chicken thigh assumed boneless & skinless".

Reply with exactly this JSON shape:
{"ok": true, "title": "short name for this recipe", "ingredients": [{"name": "Chicken thigh, boneless, skinless, raw", "grams": 500, "kcal": 0, "protein": 0, "carbs": 0, "fat": 0, "fibre": 0}], "assumptions": ["..."]}`;
}

function buildMealPrompt(body) {
  const mealType = String(body.mealType || 'dinner');
  const people = clampInt(body.people, 1, 20);
  const isTotal = body.targetMode === 'total';

  const targets = [];
  const addTarget = (label, value, unit) => {
    const n = toNum(value);
    if (n > 0) {
      const perServing = isTotal ? n / people : n;
      targets.push(`- ${label}: ${round1(perServing)}${unit} per serving (${round1(perServing * people)}${unit} total for ${people})`);
    }
  };
  addTarget('Protein', body.protein, 'g');
  addTarget('Calories', body.calories, ' kcal');
  addTarget('Carbs', body.carbs, 'g');
  addTarget('Fat', body.fat, 'g');
  if (!targets.length) throw new Error('Please set a protein target.');

  const diet = Array.isArray(body.dietary) ? body.dietary.filter(Boolean) : [];
  const dietText = [...diet, String(body.dietOther || '').trim()].filter(Boolean).join(', ');
  const fancy = String(body.fancy || '').trim().slice(0, 1500);
  const avoid = Array.isArray(body.avoid) ? body.avoid.filter(Boolean).slice(-10) : [];

  return `MODE: Build a meal.

Create ONE ${mealType} recipe for ${people} ${people === 1 ? 'person' : 'people'}.

Targets:
${targets.join('\n')}

Dietary needs (must be followed strictly): ${dietText || 'none'}
What they fancy / ingredients they have: ${fancy || 'anything - surprise them with something tasty and realistic'}
${avoid.length ? `Give a clearly DIFFERENT recipe from these previous suggestions: ${avoid.join('; ')}` : ''}

Instructions:
- Ingredient amounts are RAW weights for ALL ${people} servings combined.
- Get each per-serving target within about 5%. Protein matters most: hit it or slightly exceed it.
- Realistic home cooking with ingredients from a normal UK supermarket. If they listed ingredients they have, build around those.
- "shopQty" is how you'd buy or measure it: grams for most things, ml for liquids, or units where natural with grams in brackets, e.g. "2 medium (300g)" or "400ml".
- "method": 4 to 8 short, clear steps.
- "swap": ONE specific tweak with numbers to land the targets more precisely, e.g. "Add 50g more chicken breast for +12g protein in total (+6g each)". If already very close, give an optional tweak instead.
- "assumptions": short notes on any conversions or choices.

Reply with exactly this JSON shape:
{"ok": true, "name": "Recipe name", "description": "One or two appetising sentences.", "prepMinutes": 10, "cookMinutes": 25, "ingredients": [{"name": "Chicken breast, raw", "shopQty": "600g", "grams": 600, "kcal": 0, "protein": 0, "carbs": 0, "fat": 0, "fibre": 0}], "method": ["Step one...", "Step two..."], "swap": "...", "assumptions": ["..."]}`;
}

// ---------------------------------------------------------------
// The API route
// ---------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'The API key is missing. Add ANTHROPIC_API_KEY in your Vercel project settings, then redeploy.',
    });
  }

  const body = req.body || {};
  let userPrompt;
  try {
    if (body.mode === 'macros') userPrompt = buildMacrosPrompt(body);
    else if (body.mode === 'meal') userPrompt = buildMealPrompt(body);
    else return res.status(400).json({ error: 'Unknown mode.' });
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // Call Anthropic
  let apiRes;
  let data;
  try {
    apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    data = await apiRes.json().catch(() => null);
  } catch (e) {
    return res.status(502).json({ error: "Couldn't reach the AI service. Check your connection and try again." });
  }

  if (!apiRes.ok) {
    return res.status(502).json({ error: friendlyApiError(apiRes.status, data) });
  }

  if (data && data.stop_reason === 'max_tokens') {
    return res.status(502).json({ error: 'The answer was too long and got cut off. Try a shorter recipe, or try again.' });
  }

  const text = ((data && data.content) || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const parsed = extractJson(text);
  if (!parsed) {
    return res.status(502).json({ error: 'The answer came back in an unexpected format. Please try again.' });
  }
  if (parsed.ok === false) {
    return res.status(422).json({ error: parsed.message || "Sorry, I couldn't work with that. Try rewording it." });
  }

  try {
    const result =
      body.mode === 'macros'
        ? finishMacros(parsed, clampInt(body.servings, 1, 50))
        : finishMeal(parsed, clampInt(body.people, 1, 20));
    return res.status(200).json(result);
  } catch (e) {
    return res.status(502).json({ error: 'Some of the numbers came back incomplete. Please try again.' });
  }
}

// ---------------------------------------------------------------
// Tidy up and re-check the maths
// ---------------------------------------------------------------
function cleanIngredient(ing) {
  const protein = round1(toNum(ing.protein));
  const carbs = round1(toNum(ing.carbs));
  const fat = round1(toNum(ing.fat));
  const fibre = round1(toNum(ing.fibre));
  return {
    name: String(ing.name || 'Ingredient'),
    grams: Math.round(toNum(ing.grams)),
    protein,
    carbs,
    fat,
    fibre,
    // Calories always recalculated from the macros (4 / 4 / 9)
    kcal: Math.round(protein * 4 + carbs * 4 + fat * 9),
  };
}

function sumTotals(ingredients) {
  const t = ingredients.reduce(
    (acc, i) => ({
      kcal: acc.kcal + i.kcal,
      protein: acc.protein + i.protein,
      carbs: acc.carbs + i.carbs,
      fat: acc.fat + i.fat,
      fibre: acc.fibre + i.fibre,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 }
  );
  return roundTotals(t);
}

function divideTotals(t, n) {
  return roundTotals({
    kcal: t.kcal / n,
    protein: t.protein / n,
    carbs: t.carbs / n,
    fat: t.fat / n,
    fibre: t.fibre / n,
  });
}

function roundTotals(t) {
  return {
    kcal: Math.round(t.kcal),
    protein: round1(t.protein),
    carbs: round1(t.carbs),
    fat: round1(t.fat),
    fibre: round1(t.fibre),
  };
}

function finishMacros(parsed, servings) {
  if (!Array.isArray(parsed.ingredients) || !parsed.ingredients.length) throw new Error('No ingredients');
  const ingredients = parsed.ingredients.map(cleanIngredient);
  const totals = sumTotals(ingredients);
  return {
    mode: 'macros',
    title: String(parsed.title || 'Your recipe'),
    servings,
    ingredients,
    totals,
    perServing: divideTotals(totals, servings),
    assumptions: toStringList(parsed.assumptions),
  };
}

function finishMeal(parsed, people) {
  if (!Array.isArray(parsed.ingredients) || !parsed.ingredients.length) throw new Error('No ingredients');
  const ingredients = parsed.ingredients.map((ing) => ({
    ...cleanIngredient(ing),
    shopQty: String(ing.shopQty || `${Math.round(toNum(ing.grams))}g`),
  }));
  const totals = sumTotals(ingredients);
  return {
    mode: 'meal',
    name: String(parsed.name || 'Your meal'),
    description: String(parsed.description || ''),
    prepMinutes: Math.round(toNum(parsed.prepMinutes)),
    cookMinutes: Math.round(toNum(parsed.cookMinutes)),
    people,
    ingredients,
    method: toStringList(parsed.method),
    swap: String(parsed.swap || ''),
    assumptions: toStringList(parsed.assumptions),
    totals,
    perServing: divideTotals(totals, people),
  };
}

// ---------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------
function extractJson(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

function friendlyApiError(status, data) {
  if (status === 401) return 'The API key was rejected. Check ANTHROPIC_API_KEY in Vercel settings.';
  if (status === 429) return 'Too many requests right now. Wait a minute and try again.';
  if (status === 529 || status >= 500) return 'The AI service is busy at the moment. Please try again shortly.';
  const msg = data && data.error && data.error.message;
  return msg ? `Something went wrong: ${msg}` : 'Something went wrong. Please try again.';
}

function toNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function clampInt(v, min, max) {
  const n = Math.round(toNum(v)) || min;
  return Math.min(max, Math.max(min, n));
}

function toStringList(v) {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
}
