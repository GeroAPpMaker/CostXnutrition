// config/dishes.js
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for all dish data.
// To add a new dish (e.g. chicken adobo), add a new key here — zero code changes.
// Per-100g or per-100ml figures: price (₱), kcal, protein (g), fat (g), sodium (mg).
// ─────────────────────────────────────────────────────────────────────────────

export const DISHES = {
  'creamy-chicken-pasta': {
    name: 'Creamy Chicken Pasta',
    portions: 4,
    sellingPrice: 200,

    targets: {
      costPerPortion: 60,   // ₱
      calories:       650,  // kcal
      sodium:         700,  // mg
      protein:        30,   // g  (minimum — all others are maximums)
    },

    // Viability rules: block submit if any of these are violated.
    viability: {
      spaghetti:       240,  // min edible grams
      chicken_breast:  240,  // min edible grams
      sauce_base_min:  100,  // total ml of (heavy_cream + evaporated_milk)
      salt:              2,  // min grams
    },
    // Ingredients whose combined quantity is the "sauce base"
    sauceBaseIngredients: ['heavy_cream', 'evaporated_milk'],

    // Starting recipes (quantities per batch, NOT per portion)
    versionA: {
      spaghetti:       320,
      chicken_breast:  400,
      heavy_cream:     200,
      butter:           40,
      cheese:           60,
      garlic:           20,
      salt:              6,
      evaporated_milk:   0,
      mushrooms:         0,
    },
    versionB: {
      spaghetti:       320,
      chicken_breast:  400,
      evaporated_milk: 200,
      butter:           15,
      cheese:           30,
      mushrooms:       150,
      garlic:           20,
      salt:              4,
      heavy_cream:       0,
    },

    // Ingredient definitions: label, unit, default stepper step, and per-100g/ml nutrition
    ingredients: {
      spaghetti: {
        label:   'Spaghetti (dry)',
        unit:    'g',
        step:    10,
        price:   11.00,
        kcal:    350,
        protein: 12,
        fat:     1.5,
        sodium:  5,
      },
      chicken_breast: {
        label:   'Chicken breast',
        unit:    'g',
        step:    10,
        price:   23.00,   // base price; Price Shock raises this to 27.60
        kcal:    165,
        protein: 31,
        fat:     3.6,
        sodium:  74,
      },
      heavy_cream: {
        label:   'Heavy cream',
        unit:    'ml',
        step:    10,
        price:   50.00,
        kcal:    340,
        protein: 2.1,
        fat:     36,
        sodium:  38,
      },
      evaporated_milk: {
        label:   'Evaporated milk',
        unit:    'ml',
        step:    10,
        price:   20.00,
        kcal:    135,
        protein: 6.8,
        fat:     7.6,
        sodium:  118,
      },
      butter: {
        label:   'Butter (salted)',
        unit:    'g',
        step:    5,
        price:   45.00,
        kcal:    720,
        protein: 0.9,
        fat:     81,
        sodium:  576,
      },
      cheese: {
        label:   'Cheddar cheese',
        unit:    'g',
        step:    5,
        price:   40.00,
        kcal:    400,
        protein: 25,
        fat:     33,
        sodium:  650,
      },
      mushrooms: {
        label:   'Mushrooms',
        unit:    'g',
        step:    10,
        price:   20.00,
        kcal:    22,
        protein: 3.1,
        fat:     0.3,
        sodium:  5,
      },
      garlic: {
        label:   'Garlic',
        unit:    'g',
        step:    1,
        price:   20.00,
        kcal:    150,
        protein: 6.4,
        fat:     0.5,
        sodium:  17,
      },
      salt: {
        label:   'Salt',
        unit:    'g',
        step:    1,
        price:   2.00,
        kcal:    0,
        protein: 0,
        fat:     0,
        sodium:  38758,
      },
    },
  },

  // ── Add more dishes here, e.g.: ──────────────────────────────────────────
  // 'chicken-adobo': { ... },
};

// Price Shock: chicken breast price multiplier (20% increase)
export const PRICE_SHOCK_MULTIPLIER = 1.20;  // 23.00 → 27.60

// Hard Mode: edible yield for chicken breast
export const CHICKEN_YIELD = 0.85;
