// tests/load-test.js
// Simulates 60 students joining, voting, submitting recipes, and answering the quiz.
// Run: node tests/load-test.js
// Requires the server to be running on localhost:3000.
// Reports latency percentiles and any errors.

import { WebSocket } from 'ws';

const BASE_URL   = process.env.TEST_URL ?? 'http://localhost:3000';
const WS_URL     = BASE_URL.replace(/^http/, 'ws') + '/ws';
const N_STUDENTS = parseInt(process.env.N ?? '60', 10);
const N_TEAMS    = 10;
const THINK_MS   = 500; // delay between messages per client (simulate human)

let sessionCode, facilToken;

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiPost(path, body) {
  const res  = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error}`);
  return data;
}

// ── Create session ────────────────────────────────────────────────────────────
console.log(`[load-test] Creating session…`);
const session = await apiPost('/api/session', { pin: 'test1234' });
sessionCode = session.code;
facilToken  = session.token;
console.log(`[load-test] Session code: ${sessionCode}`);

// ── Metrics ───────────────────────────────────────────────────────────────────
const latencies    = [];
const errors       = [];
let   msgsReceived = 0;

// ── Student simulator ─────────────────────────────────────────────────────────
async function runStudent(index) {
  const teamIndex = index % N_TEAMS;
  const nickname  = `Student${index}`;
  const teamName  = `Team${teamIndex + 1}`;

  // Join via REST
  let joinData;
  try {
    joinData = await apiPost('/api/join', { code: sessionCode, nickname, teamName });
  } catch (e) {
    errors.push(`Student${index} join error: ${e.message}`);
    return;
  }
  const clientId = joinData.clientId;

  // Connect WS
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let phase = 'LOBBY';
    let hookDone = false;
    let discDone = false;
    let submitDone = false;
    let quizDone = false;

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'REJOIN', sessionCode, clientId }));
    });

    ws.on('message', async (raw) => {
      msgsReceived++;
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type !== 'FULL_STATE' && msg.type !== 'STATE_UPDATE') return;
      const s = msg.state;
      if (!s) return;

      const newPhase = s.phase;
      if (newPhase === phase) return; // no phase change
      phase = newPhase;

      await sleep(Math.random() * THINK_MS);

      // Hook poll
      if (phase === 'HOOK_POLL' && !hookDone) {
        hookDone = true;
        const t0 = Date.now();
        ws.send(JSON.stringify({ type: 'VOTE', pollType: 'hook', pollIndex: 0, option: 'A' }));
        ws.send(JSON.stringify({ type: 'VOTE', pollType: 'hook', pollIndex: 1, option: 'A' }));
        ws.send(JSON.stringify({ type: 'VOTE', pollType: 'hook', pollIndex: 2, option: '30%' }));
        latencies.push(Date.now() - t0);
      }

      // Discussion poll
      if (phase === 'DISCUSSION' && !discDone) {
        discDone = true;
        ws.send(JSON.stringify({ type: 'VOTE', pollType: 'discussion', pollIndex: 0, option: '₱228' }));
        ws.send(JSON.stringify({ type: 'VOTE', pollType: 'discussion', pollIndex: 1, option: 'Cream to evaporated milk' }));
      }

      // Recipe submit (Version B)
      if ((phase === 'APP_R1' || phase === 'APP_R2_PRICE_SHOCK') && !submitDone) {
        submitDone = true;
        await sleep(Math.random() * 2000); // stagger submissions
        const t0 = Date.now();
        ws.send(JSON.stringify({
          type: 'RECIPE_SUBMIT',
          recipe: {
            spaghetti: 320, chicken_breast: 400, evaporated_milk: 200,
            butter: 15, cheese: 30, mushrooms: 150, garlic: 20, salt: 4,
            heavy_cream: 0,
          },
        }));
        latencies.push(Date.now() - t0);
      }

      // Exit quiz
      if (phase === 'EXIT_QUIZ' && !quizDone) {
        quizDone = true;
        for (let q = 0; q < 5; q++) {
          await sleep(300 + Math.random() * 200);
          const correct = [0, 2, 1, 0, 0][q];
          ws.send(JSON.stringify({ type: 'QUIZ_ANSWER', questionIndex: q, answer: correct }));
        }
        ws.send(JSON.stringify({ type: 'REFLECTION', reflection: 'Swap cream for evap milk', confidence: 4 }));
      }

      if (phase === 'RESULTS') {
        ws.close();
        resolve();
      }
    });

    ws.on('error', (e) => {
      errors.push(`Student${index} WS error: ${e.message}`);
      resolve();
    });

    ws.on('close', () => resolve());

    // Timeout after 3 minutes
    setTimeout(() => { ws.close(); resolve(); }, 3 * 60 * 1000);
  });
}

// ── Facilitator driver ────────────────────────────────────────────────────────
async function runFacilitator() {
  const facWs = new WebSocket(WS_URL);
  await new Promise(r => facWs.on('open', r));
  facWs.send(JSON.stringify({ type: 'FACILITATOR_JOIN', sessionCode, token: facilToken }));

  const action = (a, extra = {}) => facWs.send(JSON.stringify({
    type: 'FAC_ACTION', action: a, sessionCode, token: facilToken, ...extra,
  }));

  // Wait for all students to join (~3s), then drive phases
  await sleep(4000);
  console.log(`[fac] Starting HOOK_POLL`);
  action('NEXT_PHASE');

  await sleep(3000);
  console.log(`[fac] Starting DISCUSSION`);
  action('NEXT_PHASE');

  await sleep(1000);
  action('REVEAL_ANSWER');
  await sleep(500);
  action('REVEAL_ANSWER');

  await sleep(2000);
  console.log(`[fac] Starting APP_R1`);
  action('NEXT_PHASE');

  await sleep(5000); // wait for submissions
  console.log(`[fac] Starting EXIT_QUIZ`);
  action('NEXT_PHASE');
  action('NEXT_PHASE');

  await sleep(6000);
  console.log(`[fac] Starting HOOK_REVEAL`);
  action('NEXT_PHASE');

  await sleep(1000);
  console.log(`[fac] Starting RESULTS`);
  action('NEXT_PHASE');

  await sleep(1000);
  facWs.close();
}

// ── Run ───────────────────────────────────────────────────────────────────────
console.log(`[load-test] Spawning ${N_STUDENTS} students…`);
const start    = Date.now();
const students = Array.from({ length: N_STUDENTS }, (_, i) => runStudent(i));
runFacilitator(); // runs concurrently

await Promise.all(students);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

// ── Report ────────────────────────────────────────────────────────────────────
latencies.sort((a, b) => a - b);
const p50 = latencies[Math.floor(latencies.length * 0.5)];
const p95 = latencies[Math.floor(latencies.length * 0.95)];
const p99 = latencies[latencies.length - 1];

console.log('\n══ Load Test Results ══');
console.log(`Students simulated : ${N_STUDENTS}`);
console.log(`Total time         : ${elapsed}s`);
console.log(`Messages received  : ${msgsReceived}`);
console.log(`Latency p50        : ${p50}ms`);
console.log(`Latency p95        : ${p95}ms`);
console.log(`Latency p99 (max)  : ${p99}ms`);
console.log(`Errors             : ${errors.length}`);
if (errors.length) errors.forEach(e => console.error(' -', e));

if (errors.length === 0 && p95 < 500) {
  console.log('\n✅ PASS: No errors, p95 latency < 500ms');
  process.exit(0);
} else {
  console.log('\n❌ FAIL: Check errors or latency above');
  process.exit(1);
}
