// server/ws/handlers.js
// Routes all inbound WebSocket messages to the correct handler.
// Imports are kept at the top; no circular deps (hub.js ← handlers.js ← hub.js avoided
// by passing ws directly from hub).

import { register, unregister, broadcast, sendTo } from './hub.js';
import { getSession, setSession } from '../storage/index.js';
import { sessionToPublic, participantToPublic, teamToPublic } from '../routes/session.js';
import { DISHES } from '../../config/dishes.js';
import { scoreRecipe, checkViability, computeRecipe } from '../logic/scoring.js';
import { startTimer, stopTimer, resetTimer } from '../logic/timer.js';

// ── Phase order ───────────────────────────────────────────────────────────────
const PHASES = [
  'LOBBY',
  'HOOK_POLL',
  'DISCUSSION',
  'APP_R1',
  'APP_R2_PRICE_SHOCK',
  'EXIT_QUIZ',
  'HOOK_REVEAL',
  'RESULTS',
];

// ── Message router ────────────────────────────────────────────────────────────

/**
 * Route an inbound WS message.
 * @param {import('ws').WebSocket} ws
 * @param {{ type: string, [k: string]: any }} msg
 */
export function routeMessage(ws, msg) {
  switch (msg.type) {
    case 'PING':
      ws.send(JSON.stringify({ type: 'PONG' }));
      break;
    case 'REJOIN':
      handleRejoin(ws, msg);
      break;
    case 'PROJECTOR_JOIN':
      handleProjectorJoin(ws, msg);
      break;
    case 'FACILITATOR_JOIN':
      handleFacilitatorJoin(ws, msg);
      break;
    case 'FAC_ACTION':
      handleFacAction(ws, msg);
      break;
    case 'VOTE':
      handleVote(ws, msg);
      break;
    case 'RECIPE_UPDATE':
      handleRecipeUpdate(ws, msg);
      break;
    case 'RECIPE_SUBMIT':
      handleRecipeSubmit(ws, msg);
      break;
    case 'QUIZ_ANSWER':
      handleQuizAnswer(ws, msg);
      break;
    case 'REFLECTION':
      handleReflection(ws, msg);
      break;
    case 'FAC_NOTE':
      handleFacNote(ws, msg);
      break;
    default:
      ws.send(JSON.stringify({ type: 'ERROR', message: `Unknown message type: ${msg.type}` }));
  }
}

export function handleDisconnect(sessionCode, clientId) {
  const session = getSession(sessionCode);
  if (!session) return;
  const p = session.participants.get(clientId);
  if (p) {
    p.connected = false;
    setSession(sessionCode, session);
    broadcastState(sessionCode);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function err(ws, message) {
  ws.send(JSON.stringify({ type: 'ERROR', message }));
}

function broadcastState(sessionCode) {
  const session = getSession(sessionCode);
  if (!session) return;
  broadcast(sessionCode, { type: 'STATE_UPDATE', state: sessionToPublic(session) });
}

function sendFullState(sessionCode, clientId) {
  const session = getSession(sessionCode);
  if (!session) return;
  sendTo(sessionCode, clientId, { type: 'FULL_STATE', state: sessionToPublic(session) });
}

function authFac(session, token) {
  return session && session.facilToken === token;
}

// ── Handler implementations ───────────────────────────────────────────────────

function handleRejoin(ws, msg) {
  const { sessionCode, clientId, nickname, teamName } = msg;
  const session = getSession(sessionCode);

  if (!session) {
    err(ws, 'Session not found. Please join with a new code.');
    return;
  }

  let participant = session.participants.get(clientId);

  if (!participant) {
    // Late joiner or first join from WS directly (shouldn't happen — join is via REST)
    err(ws, 'Client ID not found. Please rejoin via the join form.');
    return;
  }

  participant.connected = true;
  setSession(sessionCode, session);

  ws._meta = { sessionCode, clientId, role: 'student' };
  register(sessionCode, clientId, ws);

  // Send full state so client renders current phase immediately
  sendFullState(sessionCode, clientId);

  // Broadcast updated online count to everyone
  broadcastState(sessionCode);
}

function handleProjectorJoin(ws, msg) {
  const { sessionCode } = msg;
  const session = getSession(sessionCode);
  if (!session) { err(ws, 'Session not found.'); return; }

  const projId = `projector_${sessionCode}`;
  ws._meta = { sessionCode, clientId: projId, role: 'projector' };
  register(sessionCode, projId, ws);

  sendFullState(sessionCode, projId);
}

function handleFacilitatorJoin(ws, msg) {
  const { sessionCode, token } = msg;
  const session = getSession(sessionCode);
  if (!session) { err(ws, 'Session not found.'); return; }
  if (!authFac(session, token)) { err(ws, 'Invalid facilitator token.'); return; }

  const facId = `facilitator_${sessionCode}`;
  ws._meta = { sessionCode, clientId: facId, role: 'facilitator' };
  register(sessionCode, facId, ws);

  sendFullState(sessionCode, facId);
}

// ── Facilitator actions ───────────────────────────────────────────────────────

function handleFacAction(ws, msg) {
  const { sessionCode, action, token } = msg;
  const session = getSession(sessionCode ?? ws._meta?.sessionCode);
  if (!session) { err(ws, 'Session not found.'); return; }
  if (!authFac(session, token)) { err(ws, 'Not authorised.'); return; }

  switch (action) {
    case 'NEXT_PHASE': {
      const idx = PHASES.indexOf(session.phase);
      if (idx < PHASES.length - 1) {
        session.phase = PHASES[idx + 1];
        // Auto-enable Price Shock on APP_R2 if not already
        if (session.phase === 'APP_R2_PRICE_SHOCK') session.priceShock = true;
        setSession(session.code, session);
        broadcastState(session.code);
      }
      break;
    }
    case 'PREV_PHASE': {
      const idx = PHASES.indexOf(session.phase);
      if (idx > 0) {
        session.phase = PHASES[idx - 1];
        // Undo Price Shock if retreating past it
        if (session.phase === 'APP_R1') session.priceShock = false;
        setSession(session.code, session);
        broadcastState(session.code);
      }
      break;
    }
    case 'TOGGLE_TIMER': {
      if (session.timer.running) {
        stopTimer(session.code);
      } else {
        const remaining = session.timer.remaining ?? msg.totalSeconds ?? 300;
        startTimer(session.code, remaining);
      }
      broadcastState(session.code);
      break;
    }
    case 'SET_TIMER': {
      // msg.totalSeconds sets a new duration
      stopTimer(session.code);
      session.timer = { running: false, remaining: msg.totalSeconds, total: msg.totalSeconds };
      setSession(session.code, session);
      broadcastState(session.code);
      break;
    }
    case 'PRICE_SHOCK': {
      session.priceShock = true;
      setSession(session.code, session);
      broadcastState(session.code);
      break;
    }
    case 'HARD_MODE': {
      session.hardMode = !session.hardMode;
      setSession(session.code, session);
      broadcastState(session.code);
      break;
    }
    case 'REVEAL_ANSWER': {
      // Reveal next unrevealed discussion poll
      const poll = session.discPoll.find(p => !p.revealed);
      if (poll) {
        poll.revealed = true;
        setSession(session.code, session);
        broadcastState(session.code);
      }
      break;
    }
    case 'END_SESSION': {
      session.endedAt = new Date();
      setSession(session.code, session);
      broadcastState(session.code);
      stopTimer(session.code);
      break;
    }
    default:
      err(ws, `Unknown action: ${action}`);
  }
}

// ── Student actions ───────────────────────────────────────────────────────────

function handleVote(ws, msg) {
  const { sessionCode, clientId } = ws._meta ?? {};
  const { pollType, pollIndex, option } = msg;
  // pollType: 'hook' | 'discussion'
  // pollIndex: 0|1|2 for hook (q1/q2/q3), 0|1 for discussion

  const session = getSession(sessionCode);
  if (!session) return;
  const p = session.participants.get(clientId);
  if (!p) return;

  if (pollType === 'hook') {
    const key = `q${pollIndex + 1}`;
    if (!p.hookAnswers[key]) {
      p.hookAnswers[key] = option;
      session.hookVotes[key][option] = (session.hookVotes[key][option] ?? 0) + 1;
      setSession(sessionCode, session);
      broadcastState(sessionCode);
    }
  } else if (pollType === 'discussion') {
    const poll = session.discPoll[pollIndex];
    if (poll && !p.discPollAnswers[pollIndex]) {
      p.discPollAnswers[pollIndex] = option;
      poll.votes[option] = (poll.votes[option] ?? 0) + 1;
      setSession(sessionCode, session);
      broadcastState(sessionCode);
    }
  }
}

function handleRecipeUpdate(ws, msg) {
  // Debounced on client; server just persists currentRecipe
  const { sessionCode, clientId } = ws._meta ?? {};
  const session = getSession(sessionCode);
  if (!session) return;
  const p = session.participants.get(clientId);
  if (!p) return;

  p.currentRecipe = msg.recipe;
  setSession(sessionCode, session);
  // No broadcast needed — recipe is per-student
}

function handleRecipeSubmit(ws, msg) {
  const { sessionCode, clientId } = ws._meta ?? {};
  const session = getSession(sessionCode);
  if (!session) return;
  const p = session.participants.get(clientId);
  if (!p) return;

  const recipe = msg.recipe ?? p.currentRecipe;
  const dishKey = session.dishKey;

  // Viability check
  const v = checkViability(dishKey, recipe);
  if (!v.valid) {
    p.viabilityFailCount++;
    setSession(sessionCode, session);
    ws.send(JSON.stringify({ type: 'SUBMIT_ERROR', message: v.message }));
    return;
  }

  // Score the recipe
  const { score, meetsAll, breakdown } = scoreRecipe(
    dishKey, recipe, session.priceShock, session.hardMode
  );

  // Speed bonus: first 3 teams with meetsAll
  let speedBonus = 0;
  const normalTeam = p.teamName.toLowerCase();
  if (meetsAll && session.speedBonusTeams.size < 3 && !session.speedBonusTeams.has(normalTeam)) {
    session.speedBonusTeams.add(normalTeam);
    const team = session.teams.get(normalTeam);
    if (team) team.speedBonusAwarded = true;
    speedBonus = 10;
  }

  const totalScore = score + speedBonus;
  const submission = {
    recipe,
    score: totalScore,
    breakdown: { ...breakdown, speedBonus },
    timestamp: new Date(),
  };

  p.submissions.push(submission);
  if (totalScore > p.bestScore) p.bestScore = totalScore;

  // Update team best
  const team = session.teams.get(normalTeam);
  if (team && (!team.bestSubmission || totalScore > team.bestSubmission.score)) {
    team.bestSubmission = {
      score:          totalScore,
      costPerPortion: breakdown.costPerPortion,
      calories:       breakdown.kcalPerPortion,
      submittedBy:    p.nickname,
      timestamp:      submission.timestamp,
    };
  }

  setSession(sessionCode, session);

  // Confirm to student
  ws.send(JSON.stringify({ type: 'SUBMIT_OK', score: totalScore, breakdown, speedBonus }));

  // Broadcast updated leaderboard to everyone
  broadcastState(sessionCode);
}

function handleQuizAnswer(ws, msg) {
  const { sessionCode, clientId } = ws._meta ?? {};
  const { questionIndex, answer } = msg;
  const session = getSession(sessionCode);
  if (!session) return;
  const p = session.participants.get(clientId);
  if (!p) return;

  if (p.exitQuiz.answers[questionIndex] !== undefined) return; // already answered

  // Quiz answers and correct answers (0-indexed)
  const CORRECT = [0, 2, 1, 0, 0]; // correct option indices for Q1–Q5
  const isCorrect = answer === CORRECT[questionIndex];

  p.exitQuiz.answers[questionIndex] = answer;

  // Compute score when all 5 answered
  if (p.exitQuiz.answers.filter(a => a !== undefined).length === 5) {
    p.exitQuiz.score = p.exitQuiz.answers.reduce((sum, a, i) => sum + (a === CORRECT[i] ? 1 : 0), 0);
  }

  setSession(sessionCode, session);

  ws.send(JSON.stringify({
    type:       'QUIZ_FEEDBACK',
    questionIndex,
    isCorrect,
    correctAnswer: CORRECT[questionIndex],
  }));

  broadcastState(sessionCode);
}

function handleReflection(ws, msg) {
  const { sessionCode, clientId } = ws._meta ?? {};
  const session = getSession(sessionCode);
  if (!session) return;
  const p = session.participants.get(clientId);
  if (!p) return;

  if (typeof msg.reflection === 'string') p.reflection  = msg.reflection.slice(0, 300);
  if (typeof msg.confidence === 'number') p.confidence  = Math.max(1, Math.min(5, msg.confidence));
  setSession(sessionCode, session);
  broadcastState(sessionCode);
}

function handleFacNote(ws, msg) {
  const { sessionCode, token, clientId: targetId, note } = msg;
  const session = getSession(sessionCode ?? ws._meta?.sessionCode);
  if (!session || !authFac(session, token)) return;

  const p = session.participants.get(targetId);
  if (p) {
    p.facilitatorNote = String(note ?? '').slice(0, 500);
    setSession(session.code, session);
    sendTo(session.code, `facilitator_${session.code}`, {
      type: 'STATE_UPDATE', state: sessionToPublic(session),
    });
  }
}
