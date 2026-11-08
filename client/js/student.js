// client/js/student.js
// Student view — all phases.
import { ReconnectingWS, wsUrl } from './ws-client.js';
import { DISHES } from './config.js';

const DISH_KEY    = 'creamy-chicken-pasta';
const DISH        = DISHES[DISH_KEY];
const CLIENT_ID_KEY = 'costplate_client_id';
const SESSION_KEY   = 'costplate_session';

let ws       = null;
let state    = null;
let myId     = null;
let myCode   = null;
let recipeDebounce = null;

// ── Entry point ───────────────────────────────────────────────────────────────
const savedCode = sessionStorage.getItem(SESSION_KEY);
const savedCid  = sessionStorage.getItem(CLIENT_ID_KEY);

if (savedCode && savedCid) {
  myCode = savedCode;
  myId   = savedCid;
  // Hide join form, show loading
  document.getElementById('app').innerHTML = loadingHTML('Reconnecting…');
  connectWS(savedCode, savedCid);
} else {
  // Check URL param for code pre-fill
  const urlCode = new URLSearchParams(location.search).get('code');
  if (urlCode) {
    const codeEl = document.getElementById('code');
    if (codeEl) codeEl.value = urlCode.toUpperCase();
  }
  wireJoinForm();
}

// ── Join form ─────────────────────────────────────────────────────────────────
function wireJoinForm() {
  const form    = document.getElementById('join-form');
  const errorEl = document.getElementById('join-error');

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code     = form.code.value.trim().toUpperCase();
    const nickname = form.nickname.value.trim();
    const teamName = form.teamName.value.trim();
    showError('', errorEl);

    try {
      const res  = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, nickname, teamName }),
      });
      const data = await res.json();
      if (!res.ok) { showError(data.error ?? 'Could not join.', errorEl); return; }

      myCode = code;
      myId   = data.clientId;
      sessionStorage.setItem(SESSION_KEY, code);
      sessionStorage.setItem(CLIENT_ID_KEY, data.clientId);

      document.getElementById('app').innerHTML = loadingHTML('Joining session…');
      connectWS(code, data.clientId);
    } catch {
      showError('Network error. Please try again.', errorEl);
    }
  });
}

function showError(msg, el) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
}

function loadingHTML(msg) {
  return `<div class="join-wrap"><p style="color:var(--clr-muted)">${msg}</p></div>`;
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWS(code, clientId) {
  ws = new ReconnectingWS(
    wsUrl(),
    onMessage,
    () => ws.send({ type: 'REJOIN', sessionCode: code, clientId }),
    () => showToast('Connection lost — reconnecting…'),
  );
}

function onMessage(msg) {
  switch (msg.type) {
    case 'FULL_STATE':
    case 'STATE_UPDATE':
      state = msg.state;
      render(state);
      break;
    case 'TICK':
      renderTimerEl(msg.remaining);
      break;
    case 'TIMER_ENDED':
      renderTimerEl(0);
      break;
    case 'SUBMIT_OK':
      showSubmitResult(msg);
      break;
    case 'SUBMIT_ERROR':
      showToast(msg.message, 'error');
      break;
    case 'QUIZ_FEEDBACK':
      handleQuizFeedback(msg);
      break;
    case 'ERROR':
      // Session not found — clear storage and reload to join form
      if (msg.message?.includes('not found') || msg.message?.includes('Client ID')) {
        sessionStorage.clear();
        location.reload();
      }
      break;
  }
}

// ── Render dispatcher ─────────────────────────────────────────────────────────
function render(s) {
  if (!s) return;
  const me = s.participants?.[myId];
  switch (s.phase) {
    case 'LOBBY':            renderLobby(s, me); break;
    case 'HOOK_POLL':        renderHookPoll(s, me); break;
    case 'DISCUSSION':       renderDiscussion(s, me); break;
    case 'APP_R1':
    case 'APP_R2_PRICE_SHOCK': renderBuilder(s, me); break;
    case 'EXIT_QUIZ':        renderQuiz(s, me); break;
    case 'HOOK_REVEAL':      renderHookReveal(s, me); break;
    case 'RESULTS':          renderResults(s, me); break;
    default: renderWaiting(s.phase);
  }
}

// ── Phase renderers ───────────────────────────────────────────────────────────

function renderLobby(s, me) {
  setPage(`
    <div class="page-header">
      <div>
        <div class="join-logo">Cost<span>Plate</span></div>
        <div class="phase-badge">Lobby</div>
      </div>
    </div>
    <div class="card" style="text-align:center;padding:2rem 1rem">
      <p style="font-size:var(--fs-lg);margin-bottom:0.5rem">You're in! 🎉</p>
      <p style="font-size:var(--fs-xl);font-weight:800;color:var(--clr-accent)">${me?.nickname ?? '—'}</p>
      <p style="color:var(--clr-muted)">Team: <strong>${me?.teamName ?? '—'}</strong></p>
      <hr style="margin:1rem 0;border:none;border-top:1px solid var(--clr-border)">
      <p style="color:var(--clr-muted);font-size:var(--fs-sm)">
        ${Object.keys(s.participants ?? {}).length} student(s) joined
      </p>
      <p style="color:var(--clr-muted);font-size:var(--fs-sm);margin-top:0.5rem">
        Waiting for the facilitator to start…
      </p>
    </div>
    ${timerBlock(s)}
  `);
}

function renderHookPoll(s, me) {
  const hookQ = [
    { q: 'Which version of Creamy Chicken Pasta costs more per portion?', opts: ['Version A', 'Version B'], keys: ['A','B'], answered: me?.hookAnswers?.q1 },
    { q: 'Which version has more calories?', opts: ['Version A', 'Version B'], keys: ['A','B'], answered: me?.hookAnswers?.q2 },
    { q: 'Version A sells for ₱200. What food cost % do you think it has?', opts: ['20%','30%','40%','50%'], keys: ['20%','30%','40%','50%'], answered: me?.hookAnswers?.q3 },
  ];

  const allAnswered = me?.hookAnswers?.q1 && me?.hookAnswers?.q2 && me?.hookAnswers?.q3;

  let html = `<div class="page-header"><h1>Quick Poll</h1><div class="phase-badge">Hook</div></div>`;

  if (allAnswered) {
    html += `<div class="alert alert-success" style="margin-bottom:1rem">✓ Your answers are saved! Listen to the discussion.</div>`;
  }

  hookQ.forEach((q, qi) => {
    const answered = q.answered;
    html += `<div class="card" style="margin-bottom:1rem">
      <p class="quiz-question" style="margin-bottom:0.75rem">Q${qi+1}: ${q.q}</p>`;
    q.opts.forEach((opt, oi) => {
      const key = q.keys[oi];
      const sel = answered === key;
      html += `<button class="poll-option${sel ? ' selected' : ''}"
        ${answered ? 'disabled' : ''}
        onclick="window.__vote('hook', ${qi}, '${key}')">
        ${sel ? '✓ ' : ''}${opt}
      </button>`;
    });
    html += `</div>`;
  });

  html += timerBlock(s);
  setPage(html);

  window.__vote = (type, idx, opt) => {
    ws.send({ type: 'VOTE', pollType: type, pollIndex: idx, option: opt });
  };
}

function renderDiscussion(s, me) {
  const polls = s.discPoll ?? [];

  let html = `<div class="page-header"><h1>Discussion</h1><div class="phase-badge">Companion</div></div>`;

  // Formula reference card
  html += `<div class="card" style="margin-bottom:1rem">
    <h2 style="font-size:var(--fs-base);margin-bottom:0.5rem">📐 Formula Card</h2>
    <ul style="font-size:var(--fs-sm);padding-left:1.2rem;line-height:2">
      <li><strong>Ingredient cost</strong> = qty × price ÷ 100</li>
      <li><strong>Cost per portion</strong> = total cost ÷ portions</li>
      <li><strong>Food cost %</strong> = cost per portion ÷ selling price × 100</li>
      <li><strong>Target selling price</strong> = cost per portion ÷ target %</li>
    </ul>
  </div>`;

  // Poll 1
  const p1opts   = Object.keys(polls[0]?.votes ?? {});
  const p1ans    = me?.discPollAnswers?.[0];
  const p1reveal = polls[0]?.revealed;
  html += `<div class="card" style="margin-bottom:1rem">
    <p class="quiz-question">Poll 1: Version A costs about ₱68 per portion. What selling price gives a 30% food cost?</p>`;
  p1opts.forEach(opt => {
    const sel     = p1ans === opt;
    const correct = p1reveal && opt === '₱228';
    const wrong   = p1reveal && sel && opt !== '₱228';
    html += `<button class="poll-option${sel?' selected':''}${correct?' correct':''}${wrong?' wrong':''}"
      ${p1ans ? 'disabled' : ''}
      onclick="window.__vote('discussion', 0, '${opt}')">
      ${opt}${correct ? ' ✓ Correct!' : ''}${wrong ? ' ✗' : ''}
    </button>`;
  });
  if (p1reveal && !p1ans) {
    html += `<p class="text-muted" style="font-size:var(--fs-sm)">Correct answer: ₱228</p>`;
  }
  html += `</div>`;

  // Poll 2
  const p2opts   = Object.keys(polls[1]?.votes ?? {});
  const p2ans    = me?.discPollAnswers?.[1];
  const p2reveal = polls[1]?.revealed;
  html += `<div class="card" style="margin-bottom:1rem">
    <p class="quiz-question">Poll 2: Which single swap saved the most money AND calories?</p>`;
  p2opts.forEach(opt => {
    const sel     = p2ans === opt;
    const correct = p2reveal && opt === 'Cream to evaporated milk';
    const wrong   = p2reveal && sel && opt !== 'Cream to evaporated milk';
    html += `<button class="poll-option${sel?' selected':''}${correct?' correct':''}${wrong?' wrong':''}"
      ${p2ans ? 'disabled' : ''}
      onclick="window.__vote('discussion', 1, '${opt}')">
      ${opt}${correct ? ' ✓ Correct!' : ''}${wrong ? ' ✗' : ''}
    </button>`;
  });
  if (p2reveal && !p2ans) {
    html += `<p class="text-muted" style="font-size:var(--fs-sm)">Correct answer: Cream to evaporated milk</p>`;
  }
  html += `</div>`;

  html += timerBlock(s);
  setPage(html);

  window.__vote = (type, idx, opt) => {
    ws.send({ type: 'VOTE', pollType: type, pollIndex: idx, option: opt });
  };
}

// ── Recipe builder ────────────────────────────────────────────────────────────
let builderRecipe = null; // local copy (updated by steppers)
let lastBuilderState = null;

function renderBuilder(s, me) {
  const isShock = s.priceShock;
  const isHard  = s.hardMode;
  const phase   = s.phase;

  // Initialise local recipe from server state on first render
  if (!builderRecipe || lastBuilderState?.phase !== phase) {
    builderRecipe = { ...(me?.currentRecipe ?? DISH.versionA) };
    lastBuilderState = s;
  }

  // If Price Shock just activated, update display (recipe unchanged but costs change)
  const results = computeLocal(builderRecipe, isShock, isHard);

  let html = `
    <div class="page-header">
      <h1>Recipe Builder</h1>
      <div class="phase-badge">${isShock ? '⚡ Price Shock' : 'Round 1'}</div>
    </div>
    <div class="alert alert-info" style="margin-bottom:1rem;font-size:var(--fs-sm)">
      You run a small café. Creamy Chicken Pasta sells for ₱200. Management wants food cost ≤30%.
      The dietitian wants ≤650 kcal, ≤700 mg sodium, and ≥30 g protein.
      ${isHard ? '<br><strong>Hard Mode:</strong> Chicken has 85% edible yield. Cost uses as-purchased weight.' : ''}
    </div>`;

  // Ingredient steppers
  html += `<div class="card" style="margin-bottom:5rem">`;
  for (const [key, ing] of Object.entries(DISH.ingredients)) {
    const qty = builderRecipe[key] ?? 0;
    html += `
      <div class="ingredient-row">
        <div>
          <div class="ingredient-name">${ing.label}</div>
          <div class="ingredient-unit">${ing.unit} · ₱${(ing.price * (isShock && key==='chicken_breast' ? 1.2 : 1)).toFixed(2)}/100${ing.unit}</div>
        </div>
        <div class="stepper">
          <button class="stepper__btn" onclick="window.__step('${key}', -${ing.step})">−</button>
          <input class="stepper__input" type="number" min="0" value="${qty}"
            onchange="window.__setQty('${key}', this.value)"
            oninput="window.__setQty('${key}', this.value)">
          <button class="stepper__btn" onclick="window.__step('${key}', ${ing.step})">+</button>
        </div>
      </div>`;
  }
  html += `<div style="margin-top:1rem;display:flex;gap:0.5rem;flex-wrap:wrap">
    <button class="btn btn-outline" onclick="window.__resetRecipe()">↺ Reset to Version A</button>
    <button id="submit-btn" class="btn btn-primary" onclick="window.__submitRecipe()">Submit recipe</button>
  </div>`;
  html += `</div>`;

  // Sticky results panel
  html += buildResultsPanel(results, s);

  setPage(html);
  updateResultsPanel(results, s); // initial render

  // Stepper handlers
  window.__step = (key, delta) => {
    builderRecipe[key] = Math.max(0, (builderRecipe[key] ?? 0) + delta);
    refreshBuilder(s);
  };
  window.__setQty = (key, val) => {
    const n = Math.max(0, parseFloat(val) || 0);
    builderRecipe[key] = n;
    scheduleRecipeUpdate();
    updateResultsPanel(computeLocal(builderRecipe, s.priceShock, s.hardMode), s);
  };
  window.__resetRecipe = () => {
    builderRecipe = { ...DISH.versionA };
    refreshBuilder(s);
  };
  window.__submitRecipe = () => {
    ws.send({ type: 'RECIPE_SUBMIT', recipe: builderRecipe });
  };
}

function refreshBuilder(s) {
  scheduleRecipeUpdate();
  const results = computeLocal(builderRecipe, s.priceShock, s.hardMode);
  // Update all input values without full re-render
  for (const [key] of Object.entries(DISH.ingredients)) {
    const inputs = document.querySelectorAll(`.stepper__input`);
    // Find the right input by iterating
    const rows = document.querySelectorAll('.ingredient-row');
    let i = 0;
    for (const [k] of Object.entries(DISH.ingredients)) {
      if (k === key && rows[i]) {
        const inp = rows[i].querySelector('.stepper__input');
        if (inp && document.activeElement !== inp) inp.value = builderRecipe[key] ?? 0;
      }
      i++;
    }
  }
  updateResultsPanel(results, s);
}

function scheduleRecipeUpdate() {
  clearTimeout(recipeDebounce);
  recipeDebounce = setTimeout(() => {
    ws.send({ type: 'RECIPE_UPDATE', recipe: builderRecipe });
  }, 300);
}

function computeLocal(recipe, priceShock, hardMode) {
  const prices = {};
  for (const [k, ing] of Object.entries(DISH.ingredients)) prices[k] = ing.price;
  if (priceShock) prices.chicken_breast *= 1.2;

  const portions = DISH.portions;
  let totalCost = 0, totalKcal = 0, totalProt = 0, totalFat = 0, totalSodium = 0;

  for (const [k, qty] of Object.entries(recipe)) {
    if (!qty) continue;
    const ing = DISH.ingredients[k];
    if (!ing) continue;
    let costQty = qty;
    if (hardMode && k === 'chicken_breast') costQty = qty / 0.85;
    totalCost   += costQty * prices[k] / 100;
    totalKcal   += qty * ing.kcal    / 100;
    totalProt   += qty * ing.protein / 100;
    totalFat    += qty * ing.fat     / 100;
    totalSodium += qty * ing.sodium  / 100;
  }
  return {
    costPerPortion:    totalCost   / portions,
    foodCostPct:       (totalCost / portions) / DISH.sellingPrice * 100,
    kcalPerPortion:    totalKcal   / portions,
    proteinPerPortion: totalProt   / portions,
    fatPerPortion:     totalFat    / portions,
    sodiumPerPortion:  totalSodium / portions,
  };
}

function buildResultsPanel(r, s) {
  return `<div class="results-panel" id="results-panel">${resultsInner(r, s)}</div>`;
}

function updateResultsPanel(r, s) {
  const el = document.getElementById('results-panel');
  if (el) el.innerHTML = resultsInner(r, s);
}

function resultsInner(r, s) {
  const t = DISH.targets;
  const costOk = r.costPerPortion <= t.costPerPortion;
  const calOk  = r.kcalPerPortion <= t.calories;
  const sodOk  = r.sodiumPerPortion <= t.sodium;
  const proOk  = r.proteinPerPortion >= t.protein;

  const gap = (val, target, direction) => {
    const diff = direction === 'max'
      ? val - target
      : target - val;
    if (diff <= 0) return null; // meets target
    return diff;
  };

  return `
  <div class="panel-grid">
    <div class="panel-item">
      <span class="panel-label">Cost/portion</span>
      <span class="panel-value ${costOk?'text-success':'text-error'}">
        ${costOk?'✓':'✗'} ₱${r.costPerPortion.toFixed(2)}
      </span>
      ${!costOk ? `<span style="font-size:var(--fs-xs);color:var(--clr-error)">₱${(r.costPerPortion-t.costPerPortion).toFixed(2)} over</span>` : ''}
    </div>
    <div class="panel-item">
      <span class="panel-label">Food cost %</span>
      <span class="panel-value">${r.foodCostPct.toFixed(1)}%</span>
    </div>
    <div class="panel-item">
      <span class="panel-label">Calories</span>
      <span class="panel-value ${calOk?'text-success':'text-error'}">
        ${calOk?'✓':'✗'} ${Math.round(r.kcalPerPortion)} kcal
      </span>
      ${!calOk ? `<span style="font-size:var(--fs-xs);color:var(--clr-error)">${Math.round(r.kcalPerPortion-t.calories)} over</span>` : ''}
    </div>
    <div class="panel-item">
      <span class="panel-label">Sodium</span>
      <span class="panel-value ${sodOk?'text-success':'text-error'}">
        ${sodOk?'✓':'✗'} ${Math.round(r.sodiumPerPortion)} mg
      </span>
      ${!sodOk ? `<span style="font-size:var(--fs-xs);color:var(--clr-error)">${Math.round(r.sodiumPerPortion-t.sodium)} mg over</span>` : ''}
    </div>
    <div class="panel-item">
      <span class="panel-label">Protein</span>
      <span class="panel-value ${proOk?'text-success':'text-error'}">
        ${proOk?'✓':'✗'} ${r.proteinPerPortion.toFixed(1)} g
      </span>
      ${!proOk ? `<span style="font-size:var(--fs-xs);color:var(--clr-error)">${(t.protein-r.proteinPerPortion).toFixed(1)} g short</span>` : ''}
    </div>
    <div class="panel-item">
      <span class="panel-label">Fat</span>
      <span class="panel-value">${r.fatPerPortion.toFixed(1)} g</span>
    </div>
  </div>`;
}

let submitResultTimeout = null;
function showSubmitResult(msg) {
  clearTimeout(submitResultTimeout);
  const icon  = msg.speedBonus ? '🚀' : (msg.score >= 90 ? '🏆' : msg.score >= 70 ? '✓' : '↻');
  const color = msg.score >= 90 ? 'success' : msg.score >= 70 ? 'info' : 'warning';
  showToast(`${icon} Submitted! Score: ${msg.score}/100${msg.speedBonus ? ' (+10 speed bonus!)' : ''}`, color);
}

// ── Exit quiz ─────────────────────────────────────────────────────────────────
const QUIZ = [
  {
    q: 'How do you compute cost per portion?',
    opts: [
      'Total recipe cost ÷ number of portions',
      'Total recipe cost × number of portions',
      'Selling price ÷ number of portions',
      'Total recipe cost ÷ selling price',
    ],
    correct: 0,
    explanation: 'Divide the total recipe cost by the number of portions it makes.',
  },
  {
    q: 'A dish costs ₱60 per portion. Target food cost is 30%. What is the selling price?',
    opts: ['₱150', '₱180', '₱200', '₱240'],
    correct: 2,
    explanation: '₱60 ÷ 0.30 = ₱200.',
  },
  {
    q: 'A dish costs ₱55 per portion and sells for ₱200. What is the food cost %?',
    opts: ['22.5%', '27.5%', '30%', '35%'],
    correct: 1,
    explanation: '₱55 ÷ ₱200 × 100 = 27.5%.',
  },
  {
    q: 'How do you compute calories per portion?',
    opts: [
      'Add the calories of every ingredient, then divide by the number of portions',
      'Take the calories of the main ingredient only',
      'Multiply total calories by the number of portions',
      'Divide the selling price by the calories',
    ],
    correct: 0,
    explanation: 'Sum all ingredient calories and divide by portions.',
  },
  {
    q: 'The price of your main ingredient rises and selling price stays the same. What happens to food cost %?',
    opts: ['It goes up', 'It goes down', 'It stays the same', 'It cannot be known'],
    correct: 0,
    explanation: 'Higher cost → higher food cost %.',
  },
];

let quizState = {}; // questionIndex → { answered, isCorrect }
let reflectionDone = false;

function renderQuiz(s, me) {
  if (!me) return;
  const answers = me.exitQuiz?.answers ?? [];

  // Find first unanswered question
  let current = 0;
  for (let i = 0; i < QUIZ.length; i++) {
    if (answers[i] !== undefined) current = i + 1;
    else { current = i; break; }
    if (i === QUIZ.length - 1 && answers[i] !== undefined) current = QUIZ.length;
  }

  const allDone = answers.filter(a => a !== undefined).length === QUIZ.length;

  let html = `<div class="page-header"><h1>Exit Quiz</h1><div class="phase-badge">Q${Math.min(current+1,5)}/5</div></div>`;

  if (allDone) {
    // Show reflection form
    html += `<div class="alert alert-success" style="margin-bottom:1rem">
      ✓ Quiz complete! Score: ${me.exitQuiz?.score ?? 0}/5
    </div>`;
    html += renderReflectionForm(me);
  } else {
    const q = QUIZ[current];
    const fb = quizState[current];

    html += `<div class="card">
      <p class="quiz-question">${q.q}</p>`;
    q.opts.forEach((opt, oi) => {
      const locked = fb !== undefined;
      const isCorrect = oi === q.correct;
      const chosen    = fb?.answer === oi;
      html += `<button class="poll-option${chosen && fb.isCorrect ? ' correct' : ''}${chosen && !fb.isCorrect ? ' wrong' : ''}"
        ${locked ? 'disabled' : ''}
        onclick="window.__quizAnswer(${current}, ${oi})">
        ${opt}${locked && isCorrect ? ' ✓' : ''}
      </button>`;
    });

    if (fb !== undefined) {
      html += `<div class="quiz-feedback ${fb.isCorrect ? 'correct' : 'wrong'}">
        ${fb.isCorrect ? '✓ Correct!' : '✗ Not quite.'} ${q.explanation}
      </div>
      <button class="btn btn-primary btn-full" style="margin-top:0.75rem"
        onclick="window.__nextQ()">Next →</button>`;
    }
    html += `</div>`;
  }

  html += timerBlock(s);
  setPage(html);

  window.__quizAnswer = (qi, answer) => {
    ws.send({ type: 'QUIZ_ANSWER', questionIndex: qi, answer });
  };
  window.__nextQ = () => {
    delete quizState[Object.keys(quizState).length - 1]; // advance — server will re-render on next state
    render(state);
  };
}

function handleQuizFeedback(msg) {
  quizState[msg.questionIndex] = { answer: msg.correctAnswer === msg.questionIndex ? 0 : msg.correctAnswer, isCorrect: msg.isCorrect };
  quizState[msg.questionIndex] = { answer: null, isCorrect: msg.isCorrect };
  // Re-render with feedback visible (the answer is already saved server-side)
  render(state);
}

function renderReflectionForm(me) {
  const conf = me?.confidence;
  const refl = me?.reflection ?? '';
  return `<div class="card" style="margin-bottom:1rem">
    <h2 style="font-size:var(--fs-base);margin-bottom:0.75rem">Reflection</h2>
    <div class="field" style="margin-bottom:1rem">
      <label>One swap I would use in my own kitchen is…</label>
      <textarea class="reflection-input" id="refl-text" placeholder="Type your answer…" maxlength="300">${refl}</textarea>
    </div>
    <div class="field">
      <label>How confident are you in costing a dish and checking its nutrition? (1 = not at all, 5 = very)</label>
      <div class="confidence-row" id="conf-row">
        ${[1,2,3,4,5].map(n => `<button class="confidence-btn${conf===n?' selected':''}" onclick="window.__setConf(${n})">${n}</button>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-full" style="margin-top:0.75rem" onclick="window.__submitReflection()">Save reflection</button>
    ${reflectionDone ? '<div class="alert alert-success" style="margin-top:0.5rem">✓ Saved!</div>' : ''}
  </div>`;
}

// Re-render confidence buttons without full page re-render
window.__setConf = (n) => {
  document.querySelectorAll('.confidence-btn').forEach((b, i) => {
    b.classList.toggle('selected', i + 1 === n);
  });
  window.__pendingConf = n;
};

window.__submitReflection = () => {
  const text = document.getElementById('refl-text')?.value ?? '';
  const conf = window.__pendingConf ?? null;
  ws.send({ type: 'REFLECTION', reflection: text, confidence: conf });
  reflectionDone = true;
  showToast('Reflection saved ✓', 'success');
};

// ── Hook reveal ───────────────────────────────────────────────────────────────
function renderHookReveal(s, me) {
  const hv = s.hookVotes ?? {};
  const totalQ1 = (hv.q1?.A ?? 0) + (hv.q1?.B ?? 0);
  const totalQ2 = (hv.q2?.A ?? 0) + (hv.q2?.B ?? 0);
  const totalQ3 = Object.values(hv.q3 ?? {}).reduce((a,b)=>a+b,0);

  const pct = (n, total) => total ? `${Math.round(n/total*100)}%` : '—';

  let html = `<div class="page-header"><h1>Poll Reveal</h1><div class="phase-badge">Results</div></div>`;
  html += `<div class="card" style="margin-bottom:1rem">
    <p style="font-weight:700;margin-bottom:0.5rem">Q1: Which version costs more?</p>
    <p>Class said: A ${pct(hv.q1?.A,totalQ1)} / B ${pct(hv.q1?.B,totalQ1)}</p>
    <p class="text-success" style="font-weight:700">✓ Answer: A (₱68.33 vs ₱55.01)</p>
  </div>
  <div class="card" style="margin-bottom:1rem">
    <p style="font-weight:700;margin-bottom:0.5rem">Q2: Which version has more calories?</p>
    <p>Class said: A ${pct(hv.q2?.A,totalQ2)} / B ${pct(hv.q2?.B,totalQ2)}</p>
    <p class="text-success" style="font-weight:700">✓ Answer: A (about 755 vs 585 kcal)</p>
  </div>
  <div class="card" style="margin-bottom:1rem">
    <p style="font-weight:700;margin-bottom:0.5rem">Q3: What is Version A's food cost %?</p>
    <p>Class said: ${Object.entries(hv.q3 ?? {}).map(([k,v])=>`${k}: ${pct(v,totalQ3)}`).join(' / ')}</p>
    <p class="text-success" style="font-weight:700">✓ Answer: 34.2% — closest choice is 30%</p>
  </div>`;

  html += timerBlock(s);
  setPage(html);
}

// ── Results ───────────────────────────────────────────────────────────────────
function renderResults(s, me) {
  const teams = Object.values(s.teams ?? {}).sort((a,b)=>(b.bestSubmission?.score??0)-(a.bestSubmission?.score??0));
  const ps    = Object.values(s.participants ?? {});
  const quizScores = ps.map(p => p.exitQuiz?.score).filter(v => v != null);
  const avgQuiz    = quizScores.length ? (quizScores.reduce((a,b)=>a+b,0)/quizScores.length).toFixed(1) : '—';
  const confs      = ps.map(p => p.confidence).filter(v => v != null);
  const avgConf    = confs.length ? (confs.reduce((a,b)=>a+b,0)/confs.length).toFixed(1) : '—';

  let html = `<div class="page-header"><h1>Results</h1><div class="phase-badge">Done!</div></div>`;
  html += `<div class="card" style="margin-bottom:1rem">
    <p>Quiz average: <strong>${avgQuiz}/5</strong></p>
    <p>Confidence average: <strong>${avgConf}/5</strong></p>
    ${me?.exitQuiz?.score != null ? `<p>Your quiz score: <strong>${me.exitQuiz.score}/5</strong></p>` : ''}
  </div>`;

  html += `<h2 style="font-size:var(--fs-base);margin-bottom:0.5rem">Team Leaderboard</h2>`;
  html += `<ol class="leaderboard card">`;
  teams.forEach((t, i) => {
    html += `<li>
      <span class="lb-rank">${i+1}</span>
      <span>${t.name}</span>
      <span class="lb-score">${t.bestSubmission?.score ?? 0} pts</span>
    </li>`;
  });
  html += `</ol>`;
  setPage(html);
}

function renderWaiting(phase) {
  setPage(`<div class="join-wrap"><p style="color:var(--clr-muted)">Phase: <strong>${phase}</strong><br>Please wait…</p></div>`);
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function setPage(html) {
  document.getElementById('app').innerHTML = `<div class="page">${html}</div>`;
}

function timerBlock(s) {
  if (!s?.timer?.remaining && !s?.timer?.running) return '';
  const r = s.timer.remaining ?? 0;
  return `<div id="student-timer" style="text-align:center;font-size:var(--fs-2xl);font-weight:800;
    color:${r<=30?'var(--clr-error)':'var(--clr-accent)'};margin-top:1rem">${fmtTime(r)}</div>`;
}

function renderTimerEl(remaining) {
  const el = document.getElementById('student-timer');
  if (el) {
    el.textContent = fmtTime(remaining);
    el.style.color = remaining <= 30 ? 'var(--clr-error)' : 'var(--clr-accent)';
  }
}

function fmtTime(s) {
  const m = Math.floor(s / 60).toString().padStart(2,'0');
  const sec = (s % 60).toString().padStart(2,'0');
  return `${m}:${sec}`;
}

let toastTimeout;
function showToast(msg, type = 'info') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);padding:0.6rem 1.2rem;border-radius:8px;font-size:0.9rem;font-weight:600;z-index:999;max-width:90vw;text-align:center;transition:opacity 0.3s';
    document.body.appendChild(el);
  }
  const colors = { info:'#1d4ed8,#eff6ff', success:'#15803d,#dcfce7', error:'#b91c1c,#fee2e2', warning:'#92400e,#fef9c3' };
  const [fg, bg] = (colors[type] ?? colors.info).split(',');
  el.style.background = bg; el.style.color = fg; el.style.opacity = '1';
  el.textContent = msg;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { el.style.opacity = '0'; }, 3500);
}
