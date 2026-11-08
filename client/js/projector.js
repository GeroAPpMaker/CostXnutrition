// client/js/projector.js
// Projector view — all phases, big-screen layout.
import { ReconnectingWS, wsUrl } from './ws-client.js';

const params   = new URLSearchParams(location.search);
const code     = params.get('code');
const phaseEl  = document.getElementById('proj-phase');
const timerEl  = document.getElementById('proj-timer');
const mainEl   = document.getElementById('proj-main');
const countEl  = document.getElementById('proj-count');

if (!code) {
  mainEl.innerHTML = '<p style="color:#f87171;font-size:1.2rem">No session code in URL.<br>Add <code>?code=XXXXXX</code> to the URL.</p>';
} else {
  const ws = new ReconnectingWS(
    wsUrl(),
    onMessage,
    () => ws.send({ type: 'PROJECTOR_JOIN', sessionCode: code }),
  );
}

function onMessage(msg) {
  if (msg.type === 'FULL_STATE' || msg.type === 'STATE_UPDATE') {
    renderState(msg.state);
  }
  if (msg.type === 'TICK') renderTimer(msg.remaining);
  if (msg.type === 'TIMER_ENDED') renderTimer(0);
}

// ── State renderer ────────────────────────────────────────────────────────────
function renderState(s) {
  if (!s) return;

  phaseEl.textContent = phaseLabel(s.phase);
  renderTimer(s.timer?.remaining);

  const ps     = Object.values(s.participants ?? {});
  const online = ps.filter(p => p.connected).length;
  countEl.textContent = `${online} / ${ps.length} students online`;

  switch (s.phase) {
    case 'LOBBY':              renderLobby(s); break;
    case 'HOOK_POLL':          renderHookPoll(s); break;
    case 'DISCUSSION':         renderDiscussion(s); break;
    case 'APP_R1':
    case 'APP_R2_PRICE_SHOCK': renderLeaderboard(s); break;
    case 'EXIT_QUIZ':          renderQuizProgress(s); break;
    case 'HOOK_REVEAL':        renderHookReveal(s); break;
    case 'RESULTS':            renderFinalResults(s); break;
    default: mainEl.innerHTML = `<p style="color:#94a3b8">Phase: ${s.phase}</p>`;
  }
}

// ── Phase renderers ───────────────────────────────────────────────────────────

function renderLobby(s) {
  const ps    = Object.values(s.participants ?? {});
  const count = ps.length;
  const host  = location.origin;
  const joinUrl = `${host}/student.html?code=${s.code}`;
  // QR is SVG — fetched via API or stored in session (we stored it at creation)
  // Projector fetches it fresh from a dedicated endpoint.
  mainEl.innerHTML = `
    <div class="proj-lobby">
      <p style="color:#94a3b8;font-size:1rem">Join at: <strong style="color:#f8fafc">${location.host}/student.html</strong></p>
      <div class="proj-code">${s.code}</div>
      <div id="proj-qr" style="background:#fff;padding:1rem;border-radius:8px;width:200px;height:200px;display:flex;align-items:center;justify-content:center">
        <span style="color:#475569;font-size:0.8rem">Loading QR…</span>
      </div>
      <div class="proj-join-count"><strong>${count}</strong> student${count !== 1 ? 's' : ''} joined</div>
    </div>`;
  // Fetch QR SVG
  fetch(`/api/session/qr/${s.code}`)
    .then(r => r.text())
    .then(svg => {
      const el = document.getElementById('proj-qr');
      if (el) el.innerHTML = svg;
    })
    .catch(() => {});
}

function renderHookPoll(s) {
  const hv = s.hookVotes ?? {};
  const ps = Object.values(s.participants ?? {});
  const answered = ps.filter(p => p.hookAnswers?.q1).length;

  let html = `<div style="width:100%;max-width:800px">
    <p style="color:#94a3b8;margin-bottom:1.5rem;font-size:0.9rem">${answered} / ${ps.length} answered</p>`;

  // Q1
  const q1total = (hv.q1?.A ?? 0) + (hv.q1?.B ?? 0);
  html += pollBars('Q1: Which version costs more?', [
    { label: 'Version A', count: hv.q1?.A ?? 0 },
    { label: 'Version B', count: hv.q1?.B ?? 0 },
  ], q1total, false);

  // Q2
  const q2total = (hv.q2?.A ?? 0) + (hv.q2?.B ?? 0);
  html += pollBars('Q2: Which has more calories?', [
    { label: 'Version A', count: hv.q2?.A ?? 0 },
    { label: 'Version B', count: hv.q2?.B ?? 0 },
  ], q2total, false);

  // Q3
  const q3 = hv.q3 ?? {};
  const q3total = Object.values(q3).reduce((a,b)=>a+b,0);
  html += pollBars('Q3: Food cost % of Version A?', [
    { label: '20%', count: q3['20%'] ?? 0 },
    { label: '30%', count: q3['30%'] ?? 0 },
    { label: '40%', count: q3['40%'] ?? 0 },
    { label: '50%', count: q3['50%'] ?? 0 },
  ], q3total, false);

  html += `</div>`;
  mainEl.innerHTML = html;
}

function renderDiscussion(s) {
  const polls = s.discPoll ?? [];
  const ps    = Object.values(s.participants ?? {});
  let html    = `<div class="poll-bars" style="max-width:800px">`;

  // Poll 1
  const p1 = polls[0];
  const p1total = Object.values(p1?.votes ?? {}).reduce((a,b)=>a+b,0);
  html += pollBars('Poll 1: Selling price for 30% food cost on ₱68 dish?',
    Object.entries(p1?.votes ?? {}).map(([k,v]) => ({ label: k, count: v })),
    p1total, p1?.revealed, '₱228');

  // Poll 2
  const p2 = polls[1];
  const p2total = Object.values(p2?.votes ?? {}).reduce((a,b)=>a+b,0);
  html += pollBars('Poll 2: Which swap saved most money AND calories?',
    Object.entries(p2?.votes ?? {}).map(([k,v]) => ({ label: k, count: v })),
    p2total, p2?.revealed, 'Cream to evaporated milk');

  html += `</div>`;
  mainEl.innerHTML = html;
}

function renderLeaderboard(s) {
  const teams = Object.values(s.teams ?? {})
    .sort((a,b) => (b.bestSubmission?.score ?? 0) - (a.bestSubmission?.score ?? 0));

  const ps  = Object.values(s.participants ?? {});
  const submitted = ps.filter(p => p.submissionCount > 0).length;

  let html = `<div class="proj-leaderboard">
    ${s.priceShock ? '<div style="font-size:1rem;color:#fbbf24;font-weight:700;margin-bottom:0.75rem">⚡ PRICE SHOCK ACTIVE — Chicken +20%</div>' : ''}
    ${s.hardMode   ? '<div style="font-size:1rem;color:#c4b5fd;font-weight:700;margin-bottom:0.75rem">🔒 HARD MODE — 85% edible yield</div>' : ''}
    <p style="color:#64748b;font-size:0.8rem;margin-bottom:1rem">${submitted} / ${ps.length} submitted</p>
    <div class="proj-lb-row">
      <span>#</span><span>Team</span>
      <span style="text-align:right">Score</span>
      <span style="text-align:right">Cost/portion</span>
      <span style="text-align:right">Calories</span>
    </div>`;

  teams.slice(0, 10).forEach((t, i) => {
    const b = t.bestSubmission;
    html += `<div class="proj-lb-row">
      <span class="proj-lb-rank">${i+1}</span>
      <span>${esc(t.name)}${t.speedBonusAwarded ? ' 🚀' : ''}</span>
      <span class="proj-lb-score">${b?.score ?? '—'}</span>
      <span class="proj-lb-cost">${b ? '₱'+b.costPerPortion.toFixed(2) : '—'}</span>
      <span class="proj-lb-cal">${b ? Math.round(b.calories)+' kcal' : '—'}</span>
    </div>`;
  });
  html += `</div>`;
  mainEl.innerHTML = html;
}

function renderQuizProgress(s) {
  const ps      = Object.values(s.participants ?? {});
  const done    = ps.filter(p => (p.exitQuiz?.answers?.filter(a=>a!==undefined).length ?? 0) === 5).length;
  const withRefl= ps.filter(p => p.confidence != null).length;

  mainEl.innerHTML = `<div style="text-align:center">
    <p style="font-size:2rem;font-weight:800;color:#f8fafc">${done} / ${ps.length}</p>
    <p style="color:#94a3b8;margin-top:0.5rem">finished the quiz</p>
    <p style="color:#64748b;font-size:0.9rem;margin-top:0.5rem">${withRefl} submitted reflection</p>
  </div>`;
}

function renderHookReveal(s) {
  const hv = s.hookVotes ?? {};
  const total1 = (hv.q1?.A??0)+(hv.q1?.B??0);
  const total2 = (hv.q2?.A??0)+(hv.q2?.B??0);
  const total3 = Object.values(hv.q3??{}).reduce((a,b)=>a+b,0);
  const pct = (n,t) => t ? `${Math.round(n/t*100)}%` : '—';

  mainEl.innerHTML = `<div class="proj-reveal">
    <div class="proj-reveal-col">
      <h2>Your Guesses</h2>
      <div>
        <p class="proj-reveal-q">Q1: Which costs more?</p>
        <p style="color:#cbd5e1">A: ${pct(hv.q1?.A,total1)} · B: ${pct(hv.q1?.B,total1)}</p>
      </div>
      <div>
        <p class="proj-reveal-q">Q2: Which has more calories?</p>
        <p style="color:#cbd5e1">A: ${pct(hv.q2?.A,total2)} · B: ${pct(hv.q2?.B,total2)}</p>
      </div>
      <div>
        <p class="proj-reveal-q">Q3: Food cost % of Version A?</p>
        <p style="color:#cbd5e1">${Object.entries(hv.q3??{}).map(([k,v])=>`${k}: ${pct(v,total3)}`).join(' · ')}</p>
      </div>
    </div>
    <div class="proj-reveal-col">
      <h2>Real Answers</h2>
      <div>
        <p class="proj-reveal-q">Q1: Which costs more?</p>
        <p class="proj-reveal-a">A costs more — ₱68.33 vs ₱55.01</p>
      </div>
      <div>
        <p class="proj-reveal-q">Q2: Which has more calories?</p>
        <p class="proj-reveal-a">A has more — ~755 vs ~585 kcal</p>
      </div>
      <div>
        <p class="proj-reveal-q">Q3: Food cost %?</p>
        <p class="proj-reveal-a">34.2% — closest choice: 30%</p>
      </div>
    </div>
  </div>`;
}

function renderFinalResults(s) {
  const ps         = Object.values(s.participants ?? {});
  const teams      = Object.values(s.teams ?? {}).sort((a,b)=>(b.bestSubmission?.score??0)-(a.bestSubmission?.score??0));
  const quizScores = ps.map(p=>p.exitQuiz?.score).filter(v=>v!=null);
  const avgQuiz    = quizScores.length ? (quizScores.reduce((a,b)=>a+b,0)/quizScores.length).toFixed(1) : '—';
  const confs      = ps.map(p=>p.confidence).filter(v=>v!=null);
  const avgConf    = confs.length ? (confs.reduce((a,b)=>a+b,0)/confs.length).toFixed(1) : '—';

  // Most-missed quiz question
  const CORRECT = [0,2,1,0,0];
  const missedCounts = [0,0,0,0,0];
  ps.forEach(p => {
    (p.exitQuiz?.answers ?? []).forEach((a,i) => {
      if (a !== undefined && a !== CORRECT[i]) missedCounts[i]++;
    });
  });
  const worstQ = missedCounts.indexOf(Math.max(...missedCounts)) + 1;

  let html = `<div class="proj-leaderboard">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:2rem;margin-bottom:2rem;text-align:center">
      <div>
        <p style="color:#64748b;font-size:0.8rem;text-transform:uppercase">Quiz avg</p>
        <p style="font-size:2.5rem;font-weight:900;color:#4ade80">${avgQuiz}/5</p>
      </div>
      <div>
        <p style="color:#64748b;font-size:0.8rem;text-transform:uppercase">Confidence avg</p>
        <p style="font-size:2.5rem;font-weight:900;color:#60a5fa">${avgConf}/5</p>
      </div>
      <div>
        <p style="color:#64748b;font-size:0.8rem;text-transform:uppercase">Most-missed</p>
        <p style="font-size:2.5rem;font-weight:900;color:#fbbf24">Q${worstQ}</p>
      </div>
    </div>
    <div class="proj-lb-row">
      <span>#</span><span>Team</span>
      <span style="text-align:right">Score</span>
      <span style="text-align:right">Cost/portion</span>
      <span style="text-align:right">Calories</span>
    </div>`;

  teams.slice(0,10).forEach((t,i) => {
    const b = t.bestSubmission;
    html += `<div class="proj-lb-row">
      <span class="proj-lb-rank">${i+1}</span>
      <span>${esc(t.name)}${t.speedBonusAwarded?' 🚀':''}</span>
      <span class="proj-lb-score">${b?.score??'—'}</span>
      <span class="proj-lb-cost">${b?'₱'+b.costPerPortion.toFixed(2):'—'}</span>
      <span class="proj-lb-cal">${b?Math.round(b.calories)+' kcal':'—'}</span>
    </div>`;
  });
  html += `</div>`;
  mainEl.innerHTML = html;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function pollBars(title, items, total, revealed, correctKey) {
  let html = `<div style="margin-bottom:2rem">
    <p style="font-size:0.9rem;color:#cbd5e1;margin-bottom:0.75rem">${title}</p>
    <div class="poll-bars">`;
  items.forEach(({ label, count }) => {
    const pct    = total ? Math.round(count / total * 100) : 0;
    const isCorr = revealed && label === correctKey;
    html += `<div class="poll-bar-row">
      <span class="poll-bar-label">${label}</span>
      <div class="poll-bar-track">
        <div class="poll-bar-fill${isCorr?' correct-bar':''}" style="width:${pct}%"></div>
      </div>
      <span class="poll-bar-count">${count}</span>
    </div>`;
  });
  html += `</div>`;
  if (revealed && correctKey) {
    html += `<p style="font-size:0.85rem;color:#4ade80;margin-top:0.5rem">✓ Correct: ${correctKey}</p>`;
  }
  html += `</div>`;
  return html;
}

function renderTimer(remaining) {
  if (remaining == null) { timerEl.textContent = '—'; return; }
  const m   = Math.floor(remaining / 60).toString().padStart(2,'0');
  const sec = (remaining % 60).toString().padStart(2,'0');
  timerEl.textContent = `${m}:${sec}`;
  timerEl.classList.toggle('urgent', remaining <= 30);
}

function phaseLabel(phase) {
  const labels = {
    LOBBY: 'Lobby', HOOK_POLL: 'Hook Poll', DISCUSSION: 'Discussion',
    APP_R1: 'Recipe Builder', APP_R2_PRICE_SHOCK: '⚡ Price Shock',
    EXIT_QUIZ: 'Exit Quiz', HOOK_REVEAL: 'Poll Reveal', RESULTS: 'Results',
  };
  return labels[phase] ?? phase;
}

function esc(str) {
  return String(str).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
}
