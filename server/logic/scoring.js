// server/logic/scoring.js
// ─────────────────────────────────────────────────────────────────────────────
// All food-cost and nutrition formulas.
// All calculations use unrounded values; callers round for display only.
// ─────────────────────────────────────────────────────────────────────────────
import { DISHES, PRICE_SHOCK_MULTIPLIER, CHICKEN_YIELD } from '../../config/dishes.js';

/**
 * Build the effective price map for a dish, applying optional modifiers.
 *
 * @param {string}  dishKey
 * @param {boolean} priceShock - if true, multiply chicken_breast price by 1.20
 * @returns {Record<string, number>} ingredientKey → effective price per 100 g/ml
 */
export function buildPrices(dishKey, priceShock = false) {
  const dish = DISHES[dishKey];
  const prices = {};
  for (const [key, ing] of Object.entries(dish.ingredients)) {
    prices[key] = ing.price;
  }
  if (priceShock) {
    prices['chicken_breast'] = dish.ingredients['chicken_breast'].price * PRICE_SHOCK_MULTIPLIER;
  }
  return prices;
}

/**
 * Compute cost and nutrition totals for a recipe.
 *
 * @param {string}  dishKey
 * @param {Record<string, number>} recipe   - ingredientKey → quantity (g or ml)
 * @param {boolean} priceShock
 * @param {boolean} hardMode  - if true, chicken cost uses as-purchased qty (edible / yield)
 * @returns {{
 *   totalCost: number,
 *   costPerPortion: number,
 *   foodCostPct: number,
 *   kcalPerPortion: number,
 *   proteinPerPortion: number,
 *   fatPerPortion: number,
 *   sodiumPerPortion: number,
 * }}
 */
export function computeRecipe(dishKey, recipe, priceShock = false, hardMode = false) {
  const dish    = DISHES[dishKey];
  const prices  = buildPrices(dishKey, priceShock);
  const { portions, sellingPrice, ingredients } = dish;

  let totalCost   = 0;
  let totalKcal   = 0;
  let totalProt   = 0;
  let totalFat    = 0;
  let totalSodium = 0;

  for (const [key, qty] of Object.entries(recipe)) {
    if (!qty || qty === 0) continue;
    const ing = ingredients[key];
    if (!ing) continue;

    // Cost: Hard Mode adjusts chicken cost to use as-purchased weight
    let costQty = qty;
    if (hardMode && key === 'chicken_breast') {
      costQty = qty / CHICKEN_YIELD; // as-purchased weight is higher
    }
    totalCost += costQty * prices[key] / 100;

    // Nutrition always uses edible (entered) quantity
    totalKcal   += qty * ing.kcal    / 100;
    totalProt   += qty * ing.protein / 100;
    totalFat    += qty * ing.fat     / 100;
    totalSodium += qty * ing.sodium  / 100;
  }

  const costPerPortion    = totalCost   / portions;
  const foodCostPct       = costPerPortion / sellingPrice * 100;
  const kcalPerPortion    = totalKcal   / portions;
  const proteinPerPortion = totalProt   / portions;
  const fatPerPortion     = totalFat    / portions;
  const sodiumPerPortion  = totalSodium / portions;

  return {
    totalCost,
    costPerPortion,
    foodCostPct,
    kcalPerPortion,
    proteinPerPortion,
    fatPerPortion,
    sodiumPerPortion,
  };
}

/**
 * Compute the selling price needed to hit a target food cost percentage.
 * @param {number} costPerPortion
 * @param {number} targetPct  - e.g. 30 for 30%
 * @returns {number}
 */
export function sellingPriceForTarget(costPerPortion, targetPct) {
  return costPerPortion / (targetPct / 100);
}

/**
 * Check viability rules for a recipe.
 * @param {string} dishKey
 * @param {Record<string, number>} recipe
 * @returns {{ valid: boolean, message: string | null }}
 */
export function checkViability(dishKey, recipe) {
  const dish = DISHES[dishKey];
  const v    = dish.viability;

  if ((recipe.spaghetti ?? 0) < v.spaghetti) {
    return { valid: false, message: `Spaghetti must be at least ${v.spaghetti} g.` };
  }
  if ((recipe.chicken_breast ?? 0) < v.chicken_breast) {
    return { valid: false, message: `Chicken must be at least ${v.chicken_breast} g.` };
  }
  const sauceBase = dish.sauceBaseIngredients.reduce((sum, k) => sum + (recipe[k] ?? 0), 0);
  if (sauceBase < v.sauce_base_min) {
    return { valid: false, message: `Sauce base (cream or evaporated milk) must total at least ${v.sauce_base_min} ml.` };
  }
  if ((recipe.salt ?? 0) < v.salt) {
    return { valid: false, message: `Salt must be at least ${v.salt} g.` };
  }
  return { valid: true, message: null };
}

/**
 * Score a recipe submission (max 100, excluding speed bonus).
 * @param {string} dishKey
 * @param {Record<string, number>} recipe
 * @param {boolean} priceShock
 * @param {boolean} hardMode
 * @returns {{ score: number, breakdown: object, meetsAll: boolean }}
 */
export function scoreRecipe(dishKey, recipe, priceShock = false, hardMode = false) {
  const dish   = DISHES[dishKey];
  const t      = dish.targets;
  const result = computeRecipe(dishKey, recipe, priceShock, hardMode);

  const costOk    = result.costPerPortion    <= t.costPerPortion;
  const caloriesOk= result.kcalPerPortion    <= t.calories;
  const sodiumOk  = result.sodiumPerPortion  <= t.sodium;
  const proteinOk = result.proteinPerPortion >= t.protein;

  const score =
    (costOk     ? 40 : 0) +
    (caloriesOk ? 20 : 0) +
    (sodiumOk   ? 20 : 0) +
    (proteinOk  ? 10 : 0);
  // Speed bonus (10 pts) is added by the session logic when the team qualifies.

  return {
    score,
    meetsAll: costOk && caloriesOk && sodiumOk && proteinOk,
    breakdown: {
      costOk, caloriesOk, sodiumOk, proteinOk,
      costPerPortion:    result.costPerPortion,
      kcalPerPortion:    result.kcalPerPortion,
      sodiumPerPortion:  result.sodiumPerPortion,
      proteinPerPortion: result.proteinPerPortion,
      fatPerPortion:     result.fatPerPortion,
      foodCostPct:       result.foodCostPct,
      totalCost:         result.totalCost,
    },
  };
}
