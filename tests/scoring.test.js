// tests/scoring.test.js
// Unit tests for server/logic/scoring.js using §7 expected values.
// Run: node --test tests/scoring.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRecipe, checkViability } from '../server/logic/scoring.js';
import { DISHES } from '../config/dishes.js';

const DISH = 'creamy-chicken-pasta';
const vA   = DISHES[DISH].versionA;
const vB   = DISHES[DISH].versionB;

// Tolerance helpers
const MONEY   = 0.01;
const CAL_SOD = 2;
const PROT_FAT= 0.1;

function near(actual, expected, tol, label) {
  assert(
    Math.abs(actual - expected) <= tol,
    `${label}: expected ${expected} ±${tol}, got ${actual.toFixed(4)}`
  );
}

// ────────────────────────────────────────────────────────────────────────────
test('Version A — total cost, per-portion cost, food cost %, nutrition', () => {
  const r = computeRecipe(DISH, vA, false, false);

  near(r.totalCost,         273.32, MONEY,    'totalCost');
  near(r.costPerPortion,     68.33, MONEY,    'costPerPortion');
  near(r.foodCostPct,        34.17, 0.05,     'foodCostPct%');  // ~34.2%
  near(r.kcalPerPortion,    755,    CAL_SOD,  'kcal/portion');
  near(r.proteinPerPortion,  45.8,  PROT_FAT, 'protein/portion');
  near(r.fatPerPortion,      35.9,  PROT_FAT, 'fat/portion');
  near(r.sodiumPerPortion,  834,    CAL_SOD,  'sodium/portion');
});

// ────────────────────────────────────────────────────────────────────────────
test('Version B — total cost, per-portion cost, food cost %, nutrition', () => {
  const r = computeRecipe(DISH, vB, false, false);

  near(r.totalCost,         220.03, MONEY,    'totalCost');
  near(r.costPerPortion,     55.01, MONEY,    'costPerPortion');
  near(r.foodCostPct,        27.5,  0.05,     'foodCostPct%');
  near(r.kcalPerPortion,    585,    CAL_SOD,  'kcal/portion');
  near(r.proteinPerPortion,  47.4,  PROT_FAT, 'protein/portion');
  near(r.fatPerPortion,      14.3,  PROT_FAT, 'fat/portion');
  near(r.sodiumPerPortion,  598,    CAL_SOD,  'sodium/portion');
});

// ────────────────────────────────────────────────────────────────────────────
test('Version B after Price Shock — cost per portion ≈ ₱59.61', () => {
  const r = computeRecipe(DISH, vB, true, false);

  near(r.costPerPortion, 59.61, MONEY, 'costPerPortion after Price Shock');
  // Still passes all targets
  assert(r.costPerPortion <= 60,   'cost target still met');
  assert(r.kcalPerPortion <= 650,  'calorie target still met');
  assert(r.sodiumPerPortion <= 700,'sodium target still met');
  assert(r.proteinPerPortion >= 30,'protein target still met');
});

// ────────────────────────────────────────────────────────────────────────────
test('Version B after Price Shock + Hard Mode — cost ≈ ₱64.48, fails cost target', () => {
  const r = computeRecipe(DISH, vB, true, true);

  near(r.costPerPortion, 64.48, MONEY, 'costPerPortion with Hard Mode');
  assert(r.costPerPortion > 60, 'cost target should fail');
});

// ────────────────────────────────────────────────────────────────────────────
test('Chicken 320 g, Price Shock + Hard Mode — passes all targets', () => {
  const recipe = { ...vB, chicken_breast: 320 };
  const r = computeRecipe(DISH, recipe, true, true);

  near(r.costPerPortion,     58, 0.50,     'costPerPortion ≈₱58');   // §7 says "about ₱58"
  near(r.proteinPerPortion,  41, 0.5,      'protein ≈41g');
  near(r.kcalPerPortion,    552, CAL_SOD,  'kcal ≈552');
  near(r.sodiumPerPortion,  582, CAL_SOD,  'sodium ≈582mg');

  assert(r.costPerPortion    <= 60,  'cost target met');
  assert(r.kcalPerPortion    <= 650, 'calorie target met');
  assert(r.sodiumPerPortion  <= 700, 'sodium target met');
  assert(r.proteinPerPortion >= 30,  'protein target met');
});

// ────────────────────────────────────────────────────────────────────────────
test('Viability — Version A passes all checks', () => {
  const v = checkViability(DISH, vA);
  assert.equal(v.valid, true, v.message);
});

test('Viability — too little spaghetti fails', () => {
  const recipe = { ...vA, spaghetti: 100 };
  const v = checkViability(DISH, recipe);
  assert.equal(v.valid, false);
  assert.match(v.message, /spaghetti/i);
});

test('Viability — too little chicken fails', () => {
  const recipe = { ...vA, chicken_breast: 100 };
  const v = checkViability(DISH, recipe);
  assert.equal(v.valid, false);
  assert.match(v.message, /chicken/i);
});

test('Viability — no sauce base fails', () => {
  const recipe = { ...vA, heavy_cream: 0, evaporated_milk: 0 };
  const v = checkViability(DISH, recipe);
  assert.equal(v.valid, false);
  assert.match(v.message, /sauce/i);
});

test('Viability — too little salt fails', () => {
  const recipe = { ...vA, salt: 1 };
  const v = checkViability(DISH, recipe);
  assert.equal(v.valid, false);
  assert.match(v.message, /salt/i);
});
