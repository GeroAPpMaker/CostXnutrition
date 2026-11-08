# CostPlate — Build Plan

## 1. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 LTS | Free tier hosts, single binary, native WS |
| HTTP framework | Fastify | Low overhead, built-in schema validation |
| Real-time | `ws` (raw WebSocket) | ~10 KB vs socket.io's ~75 KB; works in every mobile browser |
| Frontend | Vanilla JS + HTML + CSS | Zero build step for clients; < 50 KB total JS |
| Dev bundler | Vite (dev only) | HMR during development; no runtime cost |
| QR code | `qrcode` (server-side SVG) | Scalable on projector; no client JS |
| PIN hashing | `bcryptjs` (1 round) | Fast; good enough for a session PIN |
| Storage | In-memory Map behind `storage/index.js` | Zero deps; interface swappable for Redis later |
| Test runner | Node's built-in `node:test` + `assert` | No extra dep; runs everywhere |
| Hosting | Railway (free, no sleep) | Persistent WS, free SSL, one-click deploy |

**Not used:** React/Vue, Socket.io, any CSS framework, any DB.

---

## 2. Architecture

### Request / broadcast flow

```
[Facilitator] --REST POST--> [Server: routes] --> [storage]
                                               --> broadcast STATE_UPDATE
[Student]     --WS msg-----> [Server: ws/hub] --> validate
                                               --> [storage]
                                               --> broadcast STATE_UPDATE
[All clients] <--STATE_UPDATE-- [WS Hub]
```

### Phase state machine

```
LOBBY → HOOK_POLL → DISCUSSION → APP_R1 → APP_R2_PRICE_SHOCK
      → [HARD_MODE overlay on APP_R2]
      → EXIT_QUIZ → HOOK_REVEAL → RESULTS
```

Facilitator moves freely. No data destroyed on backward navigation.

### Real-time rules

- Timer ticks are server-side (`setInterval`). Clients display `remaining` from server — never `Date.now()`.
- `currentRecipe` is saved server-side on every stepper change (WS, debounced 300 ms).
- On reconnect: client sends `REJOIN { clientId, sessionCode }` → server reattaches socket → sends `FULL_STATE`.

---

## 3. Data Model

### Session
```js
{
  code,             // 6-char, charset A-Z2-9 excluding 0,O,1,I
  pin,              // bcrypt hash
  phase,            // enum string
  timer: { running, remaining, total },
  priceShock: false,
  hardMode: false,
  participants: Map<clientId, Participant>,
  teams: Map<teamName, Team>,
  hookVotes: { q1:{A,B}, q2:{A,B}, q3:{'20%','30%','40%','50%'} },
  discPoll: [
    { votes: Map<option,count>, revealed: false },
    { votes: Map<option,count>, revealed: false },
  ],
  speedBonusTeams: Set<teamName>,   // first 3 valid-submitting teams
  createdAt, endedAt, deleteTimeout,
}
```

### Participant
```js
{
  clientId, nickname, teamName, connected,
  hookAnswers: { q1, q2, q3 },
  discPollAnswers: [option, option],
  currentRecipe: { [ingredientKey]: grams },
  submissions: [{ recipe, score, breakdown, timestamp }],
  bestScore: 0,
  viabilityFailCount: 0,
  lastSubmitAt: null,
  exitQuiz: { answers:[], score:null },
  confidence: null,        // 1–5
  reflection: '',
  facilitatorNote: '',
  joinedAt,
}
```

### Team
```js
{
  name,
  members: Set<clientId>,
  bestSubmission: { score, costPerPortion, calories, submittedBy, timestamp } | null,
  speedBonusAwarded: false,
}
```

---

## 4. Config File (`config/dishes.js`)

Single file to edit for all ingredient data. Adding a new dish = new key, zero code changes.

```js
export const DISHES = {
  'creamy-chicken-pasta': {
    name: 'Creamy Chicken Pasta',
    portions: 4,
    sellingPrice: 200,
    targets: { costPerPortion: 60, calories: 650, sodium: 700, protein: 30 },
    viability: {
      spaghetti: 240,          // min grams
      chicken_breast: 240,     // min edible grams
      sauce_base_min: 100,     // total of heavy_cream + evaporated_milk
      salt: 2,                 // min grams
    },
    sauceBaseIngredients: ['heavy_cream', 'evaporated_milk'],
    versionA: { spaghetti:320, chicken_breast:400, heavy_cream:200,
                butter:40, cheese:60, garlic:20, salt:6 },
    versionB: { spaghetti:320, chicken_breast:400, evaporated_milk:200,
                butter:15, cheese:30, mushrooms:150, garlic:20, salt:4 },
    ingredients: {
      spaghetti:       { label:'Spaghetti (dry)',  unit:'g',  step:10, price:11.00, kcal:350, protein:12,  fat:1.5, sodium:5     },
      chicken_breast:  { label:'Chicken breast',   unit:'g',  step:10, price:23.00, kcal:165, protein:31,  fat:3.6, sodium:74    },
      heavy_cream:     { label:'Heavy cream',      unit:'ml', step:10, price:50.00, kcal:340, protein:2.1, fat:36,  sodium:38    },
      evaporated_milk: { label:'Evaporated milk',  unit:'ml', step:10, price:20.00, kcal:135, protein:6.8, fat:7.6, sodium:118   },
      butter:          { label:'Butter (salted)',  unit:'g',  step:5,  price:45.00, kcal:720, protein:0.9, fat:81,  sodium:576   },
      cheese:          { label:'Cheddar cheese',   unit:'g',  step:5,  price:40.00, kcal:400, protein:25,  fat:33,  sodium:650   },
      mushrooms:       { label:'Mushrooms',        unit:'g',  step:10, price:20.00, kcal:22,  protein:3.1, fat:0.3, sodium:5     },
      garlic:          { label:'Garlic',           unit:'g',  step:1,  price:20.00, kcal:150, protein:6.4, fat:0.5, sodium:17    },
      salt:            { label:'Salt',             unit:'g',  step:1,  price:2.00,  kcal:0,   protein:0,   fat:0,   sodium:38758 },
    },
  },
};
```

---

## 5. Folder Structure

```
costplate/
├── server/
│   ├── index.js              # Fastify + WS attach + static serving
│   ├── routes/
│   │   ├── session.js        # POST /session, GET /session/:code
│   │   ├── join.js           # POST /join
│   │   └── facilitator.js    # POST /facilitator/* (PIN-gated)
│   ├── ws/
│   │   ├── hub.js            # connection map, broadcast helpers
│   │   └── handlers.js       # WS message routing
│   ├── logic/
│   │   ├── scoring.js        # formulas + scoring
│   │   ├── timer.js          # server-side countdown
│   │   └── dedup.js          # nickname uniqueness
│   └── storage/
│       ├── index.js          # public interface
│       └── memory.js         # in-memory Map implementation
├── client/
│   ├── index.html            # landing: enter code or create session
│   ├── student.html
│   ├── projector.html
│   ├── facilitator.html
│   ├── plan-b.html           # printable offline fallback
│   ├── css/
│   │   ├── base.css
│   │   ├── mobile.css
│   │   └── projector.css
│   └── js/
│       ├── ws-client.js      # auto-reconnecting WS wrapper
│       ├── student.js
│       ├── projector.js
│       └── facilitator.js
├── config/
│   └── dishes.js
├── tests/
│   ├── scoring.test.js       # §7 expected-value unit tests
│   ├── session.test.js       # lifecycle integration tests
│   └── load-test.js          # 60-client simulation
├── exports/
│   └── csv.js                # CSV generation
├── .env.example
├── package.json
└── README.md
```

---

## 6. Formulas (implemented in `server/logic/scoring.js`)

All calculations use unrounded values; display rounds at render time.

- `ingredientCost(qty, price)` = `qty * price / 100`
- `costPerPortion(recipe, prices, portions)` = `Σ ingredientCost / portions`
- `foodCostPct(costPerPortion, sellingPrice)` = `costPerPortion / sellingPrice * 100`
- `nutrientPerPortion(recipe, nutrientKey, portions)` = `Σ (qty * nutrient/100) / portions`
- `sellingPriceForTarget(costPerPortion, targetPct)` = `costPerPortion / (targetPct / 100)`
- Hard Mode: `asPurchasedQty = edibleQty / 0.85`; cost uses AP qty; nutrition uses edible qty

---

## 7. Scoring (max 100 per student)

| Criterion | Points |
|---|---|
| Cost per portion ≤ ₱60.00 | 40 |
| Calories ≤ 650 | 20 |
| Sodium ≤ 700 mg | 20 |
| Protein ≥ 30 g | 10 |
| Speed bonus (first 3 teams, all 4 targets met) | 10 |

Team score = best submission among members.

---

## 8. Build Milestones

| # | Milestone | Test |
|---|---|---|
| M1 | Scaffold: Fastify, static serve, base CSS | Server starts; `/` returns `index.html` |
| M2 | Config + Scoring | §7 unit tests all pass |
| M3 | Session lifecycle: create, join, storage, dedup, QR | Code returned; participant stored; QR renders |
| M4 | WS hub + state sync, FULL_STATE, phase transitions | 3 tabs: phase advance syncs; refresh rejoins |
| M5 | Lobby: all 3 views, QR large, join count | Join count increments live |
| M6 | Hook poll: student tap, projector counts | Votes update live; no answers shown |
| M7 | Discussion companion: formula card, 2 polls, reveal | Reveal shows correct answer |
| M8 | Recipe builder R1: steppers, live panel, viability, submit, leaderboard | Submit passes §7 Version A/B checks |
| M9 | Price Shock + Hard Mode | §7 Price Shock ≈₱59.61, Hard Mode ≈₱64.48 pass |
| M10 | Exit quiz + reflection | Quiz score computed; reflection saved |
| M11 | Hook reveal + Results | End-to-end flow; final leaderboard |
| M12 | Timer | Syncs across tabs; survives refresh |
| M13 | Facilitator dashboard (§10) | All table columns; detail panel; help flags |
| M14 | Export + Plan B | CSV downloads; plan-b.html prints cleanly |
| M15 | 24h delete + privacy | No Set-Cookie; no external requests; delete fires |
| M16 | Load test | 60 simulated clients; updates < 500 ms |
| M17 | README + hardening | Follow README to deploy; reconnect edge cases pass |

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| School Wi-Fi blocks WS | `ws-client.js` falls back to SSE long-poll if WS fails in 3 s |
| 60 WS connections RAM | 60 × ~5 KB ≈ 300 KB — well within 256 MB free tier |
| Phone clock drift | Timer is server-authoritative; clients display server's `remaining` |
| Student refreshes, loses recipe | `currentRecipe` saved server-side on every stepper change (debounced 300 ms) |
| Slow mobile first load | No framework; < 50 KB JS; CSS inline in `<head>` |
| Free tier sleeps | Railway (no sleep); README documents keep-alive ping |
| Facilitator skips phase | Back button; no data destroyed |
| 60 simultaneous submits | WS message queue is sequential; no DB bottleneck |
| Server restart mid-session | State lost (documented in README); pre-class checklist: download CSV before ending |
| Duplicate team names | Normalised to lowercase-trimmed for matching; display preserves original case |

---

## 10. Open Design Decisions (resolved)

| Q | Decision |
|---|---|
| PIN auth | Set once at creation. `sessionStorage` token after first auth; re-enter only after browser close. |
| Speed bonus | First 3 **teams**. First valid submit from any member claims it for the team. |
| Discussion poll tracking | Per-student votes stored server-side. Projector shows aggregates only. |
| Hard Mode cost target | Stays ₱60. Students see yield note in brief. |
| QR encodes | Full join URL (`https://host/join?code=XXXXXX`). |
| Session code charset | Uppercase A-Z plus digits 2-9 (excludes 0, O, 1, I). 6 chars ≈ 1.07 billion combos. |
