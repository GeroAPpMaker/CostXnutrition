// server/logic/timer.js
// Server-side countdown timer per session.
// Keeps the client in sync; clients display server's `remaining` — never Date.now().

import { broadcast } from '../ws/hub.js';
import { getSession, setSession } from '../storage/index.js';

const TICK_INTERVAL_MS = 1000;

/** @type {Map<string, ReturnType<typeof setInterval>>} */
const intervals = new Map();

/**
 * Start (or restart) the countdown for a session.
 * @param {string} sessionCode
 * @param {number} totalSeconds  - countdown duration
 */
export function startTimer(sessionCode, totalSeconds) {
  stopTimer(sessionCode);

  const session = getSession(sessionCode);
  if (!session) return;

  session.timer = { running: true, remaining: totalSeconds, total: totalSeconds };
  setSession(sessionCode, session);

  const iv = setInterval(() => {
    const s = getSession(sessionCode);
    if (!s || !s.timer.running) { clearInterval(iv); return; }

    s.timer.remaining -= 1;
    setSession(sessionCode, s);

    broadcast(sessionCode, { type: 'TICK', remaining: s.timer.remaining });

    if (s.timer.remaining <= 0) {
      s.timer.running = false;
      setSession(sessionCode, s);
      clearInterval(iv);
      intervals.delete(sessionCode);
      broadcast(sessionCode, { type: 'TIMER_ENDED' });
    }
  }, TICK_INTERVAL_MS);

  intervals.set(sessionCode, iv);
}

/**
 * Stop (pause) the timer without resetting it.
 * @param {string} sessionCode
 */
export function stopTimer(sessionCode) {
  const iv = intervals.get(sessionCode);
  if (iv) { clearInterval(iv); intervals.delete(sessionCode); }

  const session = getSession(sessionCode);
  if (session?.timer) {
    session.timer.running = false;
    setSession(sessionCode, session);
  }
}

/**
 * Reset timer to its total duration without starting it.
 * @param {string} sessionCode
 */
export function resetTimer(sessionCode) {
  stopTimer(sessionCode);
  const session = getSession(sessionCode);
  if (session?.timer) {
    session.timer.remaining = session.timer.total;
    session.timer.running   = false;
    setSession(sessionCode, session);
  }
}
