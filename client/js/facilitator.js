// client/js/facilitator.js
// Facilitator dashboard — all §10 features.
import { ReconnectingWS, wsUrl } from './ws-client.js';

const FAC_TOKEN_KEY = 'costplate_fac_token';
const FAC_CODE_KEY  = 'costplate_fac_code';

let ws      = null;
let state   = null;
let sortCol = 'nickname';
let sortDir = 1;
let filterSearch = '';
let filterTeam   = '';
let filterStatus = '';
let selectedId   = null;

// ── Login modal ───────────────────────────────────────────────────────────────
const overlay   = document.getElementById('fac-login-overlay');
const loginForm = document.getElementById('fac-login-form');
const loginErr  = document.getElementById('fac-login-error');
const modeEl    = document.getElementById('fac-mode');
const codeWrap  = document.getElementById('field-code-wrap');

modeEl.addEventListener('change', () => {
  codeWrap.style.display = modeEl.value === 'join' ? '' : 'none';
});

const savedToken = sessionStorage.getItem(FAC_TOKEN_KEY);
const savedCode  = sessionStorage.getItem(FAC_CODE_KEY);
if (savedToken && savedCode) {
  overlay.style.display = 'none';
  document.getElementById('fac-code').textContent = savedCode;
  connectFacWS(savedCode, savedToken);
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin  = document.getElementById('fac-pin-input').value;
  const mode = modeEl.value;
  loginErr.style.display = 'none';

  try {
    let res, data;
    if (mode === 'create') {
      res  = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      data = await res.json();
    } else {
      const code = document.getElementById('fac-code-input').value.trim().toUpperCase();
      res  = await fetch('/api/facilitator/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, pin }),
      });
      data = await res.json();
    }

    if (!res.ok) { showLoginErr(data.error ?? 'Invalid PIN or code.'); return; }

    sessionStorage.setItem(FAC_TOKEN_KEY, data.token);
    sessionStorage.setItem(FAC_CODE_KEY, data.code);
    overlay.style.display = 'none';
    document.getElementById('fac-code').textContent = data.code;

    // Show QR in a banner
    if (data.qrSvg) {
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;top:60px;right:1rem;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:0.5rem;z-index:50;width:160px';
      banner.innerHTML = data.qrSvg;
      document.body.appendChild(banner);
      setTimeout(() => banner.remove(), 30000); // auto-hide after 30s
    }

    connectFacWS(data.code, data.token);
  } catch {
    showLoginErr('Network error. Please try again.');
  }
});

function showLoginErr(msg) {
  loginErr.textContent = msg;
  loginErr.style.display = '';
}

// ── WS connection ─────────────────────────────────────────────────────────────
function connectFacWS(code, token) {
  ws = new ReconnectingWS(
    wsUrl(),
    onMessage,
    () => ws.send({ type: 'FACILITATOR_JOIN', sessionCode: code, token }),
  );
}

function onMessage(msg) {
  if (msg.type === 'FULL_STATE' || msg.type === 'STATE_UPDATE') {
    state = msg.state;
    renderDashboard(state);
  }
  if (msg.type === 'TICK') renderTimerVal(msg.remaining);
  if (msg.type === 'TIMER_ENDED') renderTimerVal(0);
}

// ── Dashboard render ──────────────────────────────────────────────────────────
function renderDashboard(s) {
  if (!s) return;

  // Top bar
  document.getElementById('fac-phase').textContent  = phaseLabel(s.phase);
  document.getElementById('fac-code').textContent   = s.code;
  renderTimerVal(s.timer?.remaining);

  const ps     = Object.values(s.participants ?? {});
  const online = ps.filter(p => p.connected).length;
  document.getElementById('fac-online').textContent = `${online}/${ps.length} online`;

  // Control buttons
  updateControls(s);

  // Progress strip
  renderProgress(s, ps);

  // Student table
  renderTable(ps, s);

  // Detail panel (if a student is selected)
  if (selectedId && s.participants?.[selectedId]) {
    renderDetail(s.participants[selectedId], s);
  }
}

function phaseLabel(phase) {
  const l = { LOBBY:'Lobby', HOOK_POLL:'Hook Poll', DISCUSSION:'Discussion',
    APP_R1:'Recipe Builder', APP_R2_PRICE_SHOCK:'⚡ Price Shock',
    EXIT_QUIZ:'Exit Quiz', HOOK_REVEAL:'Poll Reveal', RESULTS:'Results' };
  return l[phase] ?? phase;
}

function renderTimerVal(remaining) {
  const el = document.getElementById('fac-timer');
  if (remaining == null) { el.textContent = '—'; return; }
  const m = Math.floor(remaining/60).toString().padStart(2,'0');
  const s = (remaining%60).toString().padStart(2,'0');
  el.textContent = `${m}:${s}`;
}

function updateControls(s) {
  const isApp  = s.phase === 'APP_R1' || s.phase === 'APP_R2_PRICE_SHOCK';
  const isDisc = s.phase === 'DISCUSSION';
  document.getElementById('btn-shock').disabled  = !isApp || s.priceShock;
  document.getElementById('btn-hard').disabled   = !isApp;
  document.getElementById('btn-reveal').disabled = !isDisc;
  document.getElementById('btn-timer').textContent = s.timer?.running ? '■ Stop timer' : '▶ Start timer';
  document.getElementById('btn-hard').textContent  = s.hardMode ? '🔓 Hard Mode ON' : '🔒 Hard Mode';
}

function renderProgress(s, ps) {
  let done = 0, label = '';
  const total = ps.length || 1;

  switch (s.phase) {
    case 'HOOK_POLL':
      done  = ps.filter(p => p.hookAnswers?.q1 && p.hookAnswers?.q2 && p.hookAnswers?.q3).length;
      label = `${done} of ${ps.length} answered the hook poll`;
      break;
    case 'DISCUSSION':
      done  = ps.filter(p => p.discPollAnswers?.[0] && p.discPollAnswers?.[1]).length;
      label = `${done} of ${ps.length} answered both discussion polls`;
      break;
    case 'APP_R1': case 'APP_R2_PRICE_SHOCK':
      done  = ps.filter(p => p.submissionCount > 0).length;
      label = `${done} of ${ps.length} submitted a recipe`;
      break;
    case 'EXIT_QUIZ':
      done  = ps.filter(p => (p.exitQuiz?.answers?.filter(a=>a!==undefined).length??0)===5).length;
      label = `${done} of ${ps.length} finished the quiz`;
      break;
    default:
      label = `${ps.filter(p=>p.connected).length} students online`;
      done  = ps.filter(p=>p.connected).length;
  }

  document.getElementById('progress-label').textContent = label;
  document.getElementById('progress-fill').style.width  = `${Math.round(done/total*100)}%`;
}

// ── Student table ─────────────────────────────────────────────────────────────
function renderTable(ps, s) {
  const now = Date.now();

  // Filter
  let rows = ps.filter(p => {
    if (filterSearch && !p.nickname.toLowerCase().includes(filterSearch.toLowerCase())) return false;
    if (filterTeam   && !p.teamName.toLowerCase().includes(filterTeam.toLowerCase()))   return false;
    if (filterStatus === 'online'  && !p.connected) return false;
    if (filterStatus === 'offline' && p.connected)  return false;
    if (filterStatus === 'flag'    && !isFlagged(p, s)) return false;
    return true;
  });

  // Sort
  rows.sort((a, b) => {
    let va = a[sortCol] ?? 0;
    let vb = b[sortCol] ?? 0;
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    return va < vb ? -sortDir : va > vb ? sortDir : 0;
  });

  const tbody = document.getElementById('student-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--clr-muted)">No students match filter</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(p => {
    const flag     = isFlagged(p, s) ? '⚠' : '';
    const dot      = p.connected ? '<span class="dot-online" aria-label="online"></span>' : '<span class="dot-offline" aria-label="offline"></span>';
    const status   = p.connected ? 'Online' : 'Offline';
    const selected = p.clientId === selectedId ? 'style="background:#eff6ff"' : '';
    return `<tr ${selected} onclick="window.__selectStudent('${p.clientId}')">
      <td>${dot}${flag}</td>
      <td>${esc(p.nickname)}</td>
      <td>${esc(p.teamName)}</td>
      <td>${p.bestScore ?? 0}</td>
      <td>${p.exitQuiz?.score != null ? `${p.exitQuiz.score}/5` : '—'}</td>
      <td>${p.confidence ?? '—'}</td>
      <td>${p.submissionCount ?? 0}</td>
    </tr>`;
  }).join('');
}

function isFlagged(p, s) {
  if (!p.connected) return true;
  // Hasn't submitted in app phase after 5 minutes
  const isApp = s.phase === 'APP_R1' || s.phase === 'APP_R2_PRICE_SHOCK';
  if (isApp && p.submissionCount === 0 && p.joinedAt) {
    const mins = (Date.now() - new Date(p.joinedAt).getTime()) / 60000;
    if (mins > 5) return true;
  }
  if (p.viabilityFailCount >= 3) return true;
  return false;
}

window.__selectStudent = (cid) => {
  selectedId = cid;
  if (state?.participants?.[cid]) {
    renderDetail(state.participants[cid], state);
  }
  // Highlight row (re-render table)
  if (state) renderTable(Object.values(state.participants ?? {}), state);
};

// ── Detail panel ──────────────────────────────────────────────────────────────
function renderDetail(p, s) {
  const panel = document.getElementById('detail-panel');
  if (!p) { panel.innerHTML = '<h3>Student detail</h3><p style="color:var(--clr-muted)">Select a student.</p>'; return; }

  const DISH_KEY = 'creamy-chicken-pasta';
  const recipe   = p.currentRecipe ?? {};

  // Compute live stats from recipe
  let liveStats = null;
  try {
    // Inline calculation (same as scoring.js but no import)
    const ingDefs = {
      spaghetti:       { price:11.00, kcal:350, protein:12,  fat:1.5, sodium:5     },
      chicken_breast:  { price:23.00, kcal:165, protein:31,  fat:3.6, sodium:74    },
      heavy_cream:     { price:50.00, kcal:340, protein:2.1, fat:36,  sodium:38    },
      evaporated_milk: { price:20.00, kcal:135, protein:6.8, fat:7.6, sodium:118   },
      butter:          { price:45.00, kcal:720, protein:0.9, fat:81,  sodium:576   },
      cheese:          { price:40.00, kcal:400, protein:25,  fat:33,  sodium:650   },
      mushrooms:       { price:20.00, kcal:22,  protein:3.1, fat:0.3, sodium:5     },
      garlic:          { price:20.00, kcal:150, protein:6.4, fat:0.5, sodium:17    },
      salt:            { price:2.00,  kcal:0,   protein:0,   fat:0,   sodium:38758 },
    };
    let tc=0,tk=0,tp=0,tf=0,ts=0;
    for (const [k,qty] of Object.entries(recipe)) {
      if (!qty) continue;
      const ing = ingDefs[k]; if (!ing) continue;
      let cq = qty;
      if (s.hardMode && k==='chicken_breast') cq = qty/0.85;
      const price = ing.price * (s.priceShock && k==='chicken_breast' ? 1.2 : 1);
      tc += cq*price/100; tk+=qty*ing.kcal/100; tp+=qty*ing.protein/100; tf+=qty*ing.fat/100; ts+=qty*ing.sodium/100;
    }
    const portions = 4;
    liveStats = {
      costPerPortion:    tc/portions,
      foodCostPct:       (tc/portions)/200*100,
      kcalPerPortion:    tk/portions,
      proteinPerPortion: tp/portions,
      fatPerPortion:     tf/portions,
      sodiumPerPortion:  ts/portions,
    };
  } catch(e) {}

  const t = { costPerPortion:60, calories:650, sodium:700, protein:30 };
  const costOk = liveStats && liveStats.costPerPortion <= t.costPerPortion;
  const calOk  = liveStats && liveStats.kcalPerPortion <= t.calories;
  const sodOk  = liveStats && liveStats.sodiumPerPortion <= t.sodium;
  const proOk  = liveStats && liveStats.proteinPerPortion >= t.protein;

  panel.innerHTML = `
    <h3>${esc(p.nickname)} <span style="font-weight:400;color:var(--clr-muted)">/ ${esc(p.teamName)}</span></h3>
    <div class="detail-grid">
      <span class="detail-label">Status</span>
      <span class="detail-value">${p.connected ? '🟢 Online' : '🔴 Offline'}</span>
      <span class="detail-label">Best score</span>
      <span class="detail-value">${p.bestScore}</span>
      <span class="detail-label">Submissions</span>
      <span class="detail-value">${p.submissionCount}</span>
      <span class="detail-label">Quiz score</span>
      <span class="detail-value">${p.exitQuiz?.score != null ? p.exitQuiz.score+'/5' : '—'}</span>
      <span class="detail-label">Confidence</span>
      <span class="detail-value">${p.confidence ?? '—'}/5</span>
      <span class="detail-label">Viability fails</span>
      <span class="detail-value">${p.viabilityFailCount}</span>
    </div>

    ${liveStats ? `
    <p style="font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:0.05em;color:var(--clr-muted);margin-bottom:0.3rem">Live recipe</p>
    <div class="detail-grid">
      <span class="detail-label">Cost/portion</span>
      <span class="detail-value ${costOk?'text-success':'text-error'}">₱${liveStats.costPerPortion.toFixed(2)} ${costOk?'✓':'✗'}</span>
      <span class="detail-label">Food cost %</span>
      <span class="detail-value">${liveStats.foodCostPct.toFixed(1)}%</span>
      <span class="detail-label">Calories</span>
      <span class="detail-value ${calOk?'text-success':'text-error'}">${Math.round(liveStats.kcalPerPortion)} kcal ${calOk?'✓':'✗'}</span>
      <span class="detail-label">Protein</span>
      <span class="detail-value ${proOk?'text-success':'text-error'}">${liveStats.proteinPerPortion.toFixed(1)} g ${proOk?'✓':'✗'}</span>
      <span class="detail-label">Fat</span>
      <span class="detail-value">${liveStats.fatPerPortion.toFixed(1)} g</span>
      <span class="detail-label">Sodium</span>
      <span class="detail-value ${sodOk?'text-success':'text-error'}">${Math.round(liveStats.sodiumPerPortion)} mg ${sodOk?'✓':'✗'}</span>
    </div>` : ''}

    <p style="font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:0.05em;color:var(--clr-muted);margin:0.75rem 0 0.3rem">Facilitator note</p>
    <textarea class="note-input" placeholder="Private note (not shown to students)"
      onchange="window.__saveNote('${p.clientId}', this.value)">${esc(p.facilitatorNote ?? '')}</textarea>

    ${p.reflection ? `<p style="margin-top:0.5rem;font-size:var(--fs-xs);color:var(--clr-muted)">Reflection:</p>
    <p style="font-size:var(--fs-sm);font-style:italic">"${esc(p.reflection)}"</p>` : ''}
  `;
}

window.__saveNote = (clientId, note) => {
  const code  = sessionStorage.getItem(FAC_CODE_KEY);
  const token = sessionStorage.getItem(FAC_TOKEN_KEY);
  ws?.send({ type: 'FAC_NOTE', sessionCode: code, token, clientId, note });
};

// ── Table filter wiring ───────────────────────────────────────────────────────
document.getElementById('filter-search').addEventListener('input', e => {
  filterSearch = e.target.value;
  if (state) renderTable(Object.values(state.participants ?? {}), state);
});
document.getElementById('filter-team').addEventListener('input', e => {
  filterTeam = e.target.value;
  if (state) renderTable(Object.values(state.participants ?? {}), state);
});
document.getElementById('filter-status').addEventListener('change', e => {
  filterStatus = e.target.value;
  if (state) renderTable(Object.values(state.participants ?? {}), state);
});

// Sort on header click
document.getElementById('student-table').querySelector('thead').addEventListener('click', e => {
  const th = e.target.closest('[data-col]');
  if (!th) return;
  const col = th.dataset.col;
  if (sortCol === col) sortDir = -sortDir;
  else { sortCol = col; sortDir = 1; }
  if (state) renderTable(Object.values(state.participants ?? {}), state);
});

// ── Control buttons ───────────────────────────────────────────────────────────
function facAction(action, extra = {}) {
  const code  = sessionStorage.getItem(FAC_CODE_KEY);
  const token = sessionStorage.getItem(FAC_TOKEN_KEY);
  ws?.send({ type: 'FAC_ACTION', action, sessionCode: code, token, ...extra });
}

document.getElementById('btn-next').addEventListener('click',    () => facAction('NEXT_PHASE'));
document.getElementById('btn-prev').addEventListener('click',    () => facAction('PREV_PHASE'));
document.getElementById('btn-timer').addEventListener('click',   () => {
  if (state?.timer?.running) facAction('TOGGLE_TIMER');
  else {
    const secs = parseInt(prompt('Timer duration in seconds (e.g. 300 for 5 min):', '300'), 10);
    if (!isNaN(secs) && secs > 0) {
      facAction('SET_TIMER', { totalSeconds: secs });
      setTimeout(() => facAction('TOGGLE_TIMER'), 200);
    }
  }
});
document.getElementById('btn-shock').addEventListener('click',   () => {
  if (confirm('Trigger Price Shock? Chicken breast price will rise 20%.')) facAction('PRICE_SHOCK');
});
document.getElementById('btn-hard').addEventListener('click',    () => {
  const on = state?.hardMode;
  if (confirm(on ? 'Turn off Hard Mode?' : 'Enable Hard Mode? (85% chicken yield)')) facAction('HARD_MODE');
});
document.getElementById('btn-reveal').addEventListener('click',  () => facAction('REVEAL_ANSWER'));
document.getElementById('btn-end').addEventListener('click', () => {
  if (!state?.endedAt && !confirm('End the session? Download results first if you haven\'t already.')) return;
  facAction('END_SESSION');
});
document.getElementById('btn-download').addEventListener('click', async () => {
  const code  = sessionStorage.getItem(FAC_CODE_KEY);
  const token = sessionStorage.getItem(FAC_TOKEN_KEY);
  if (!code || !token || !state) return;

  // Build CSV client-side from state
  const { buildStudentCSV, buildSubmissionCSV } = await import('./csv-export.js');
  const students   = buildStudentCSV(state);
  const submissions= buildSubmissionCSV(state);

  downloadCSV(students,    `costplate-${code}-students.csv`);
  setTimeout(() => downloadCSV(submissions, `costplate-${code}-submissions.csv`), 300);
});

function downloadCSV(content, filename) {
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' }); // BOM for Excel
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
}
