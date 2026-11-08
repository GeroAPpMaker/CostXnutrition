// server/routes/session.js
// POST /api/session  — create a new session (facilitator only)
// GET  /api/session/:code — public session info (phase, counts)
// POST /api/facilitator/auth — facilitator re-auth for existing session

import bcrypt from 'bcryptjs';
import QRCode from 'qrcode';
import { randomUUID } from 'node:crypto';
import { getSession, setSession } from '../storage/index.js';
import { DISHES } from '../../config/dishes.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Session code charset: uppercase A-Z plus digits 2-9, no 0/O/1/I */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

function uniqueCode() {
  let code;
  let attempts = 0;
  do {
    code = generateCode();
    attempts++;
    if (attempts > 1000) throw new Error('Failed to generate unique code');
  } while (getSession(code));
  return code;
}

/** Build the initial (empty) session object. */
function createSessionObject(code, hashedPin) {
  return {
    code,
    pin: hashedPin,
    phase: 'LOBBY',
    timer: { running: false, remaining: null, total: null },
    priceShock: false,
    hardMode: false,
    dishKey: 'creamy-chicken-pasta',
    participants: new Map(),
    teams: new Map(),
    hookVotes: { q1: { A: 0, B: 0 }, q2: { A: 0, B: 0 }, q3: { '20%': 0, '30%': 0, '40%': 0, '50%': 0 } },
    discPoll: [
      { votes: { '₱180': 0, '₱200': 0, '₱228': 0, '₱250': 0 }, revealed: false },
      { votes: { 'Cream to evaporated milk': 0, 'Less butter': 0, 'Less cheese': 0, 'Adding mushrooms': 0 }, revealed: false },
    ],
    speedBonusTeams: new Set(),
    createdAt: new Date(),
    endedAt: null,
    deleteTimeout: null,
    // facilitator token — a random UUID validated on WS/REST
    facilToken: randomUUID(),
  };
}

/** Serialise session to a plain object safe for JSON (strip Maps/Sets/pin/token). */
export function sessionToPublic(session) {
  return {
    code:        session.code,
    phase:       session.phase,
    timer:       session.timer,
    priceShock:  session.priceShock,
    hardMode:    session.hardMode,
    dishKey:     session.dishKey,
    hookVotes:   session.hookVotes,
    discPoll:    session.discPoll.map(p => ({ votes: p.votes, revealed: p.revealed })),
    speedBonusTeams: [...session.speedBonusTeams],
    participants: Object.fromEntries(
      [...session.participants.entries()].map(([cid, p]) => [cid, participantToPublic(p)])
    ),
    teams: Object.fromEntries(
      [...session.teams.entries()].map(([name, t]) => [name, teamToPublic(t)])
    ),
  };
}

export function participantToPublic(p) {
  return {
    clientId:         p.clientId,
    nickname:         p.nickname,
    teamName:         p.teamName,
    connected:        p.connected,
    hookAnswers:      p.hookAnswers,
    discPollAnswers:  p.discPollAnswers,
    currentRecipe:    p.currentRecipe,
    bestScore:        p.bestScore,
    submissionCount:  p.submissions.length,
    viabilityFailCount: p.viabilityFailCount,
    lastSubmitAt:     p.lastSubmitAt,
    exitQuiz:         p.exitQuiz,
    confidence:       p.confidence,
    reflection:       p.reflection,
    facilitatorNote:  p.facilitatorNote,
    joinedAt:         p.joinedAt,
  };
}

export function teamToPublic(t) {
  return {
    name:              t.name,
    members:           [...t.members],
    bestSubmission:    t.bestSubmission,
    speedBonusAwarded: t.speedBonusAwarded,
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export default async function sessionRoutes(app) {
  /**
   * POST /api/session
   * Body: { pin: string }
   * Returns: { code, token, qrSvg, joinUrl }
   */
  app.post('/session', async (req, reply) => {
    const { pin } = req.body ?? {};
    if (!pin || typeof pin !== 'string' || pin.length < 4) {
      return reply.code(400).send({ error: 'PIN must be at least 4 characters.' });
    }

    const hashedPin = bcrypt.hashSync(pin, 4); // 4 rounds — fast for a session PIN
    const code      = uniqueCode();
    const session   = createSessionObject(code, hashedPin);

    setSession(code, session);

    // Generate QR code as SVG string
    const host   = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    const joinUrl = `${host}/student.html?code=${code}`;
    const qrSvg  = await QRCode.toString(joinUrl, { type: 'svg', margin: 1 });

    // Schedule 24-hour auto-delete
    const deleteTimeout = setTimeout(async () => {
      const s = getSession(code);
      if (s) { clearTimeout(s.deleteTimeout); }
      const { deleteSession } = await import('../storage/index.js');
      deleteSession(code);
    }, 24 * 60 * 60 * 1000);
    session.deleteTimeout = deleteTimeout;
    setSession(code, session);

    return { code, token: session.facilToken, joinUrl, qrSvg };
  });

  /**
   * GET /api/session/:code
   * Public — returns phase and counts.
   */
  app.get('/session/:code', async (req, reply) => {
    const session = getSession(req.params.code);
    if (!session) return reply.code(404).send({ error: 'Session not found.' });
    return {
      code:             session.code,
      phase:            session.phase,
      participantCount: session.participants.size,
    };
  });

  /**
   * GET /api/session/qr/:code
   * Returns the QR code SVG for the session join URL.
   */
  app.get('/session/qr/:code', async (req, reply) => {
    const session = getSession(req.params.code);
    if (!session) return reply.code(404).send({ error: 'Session not found.' });
    const host    = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
    const joinUrl = `${host}/student.html?code=${session.code}`;
    const qrSvg   = await QRCode.toString(joinUrl, { type: 'svg', margin: 1 });
    reply.type('image/svg+xml').send(qrSvg);
  });
}
