// server/routes/facilitator.js
// All facilitator-only endpoints, protected by session PIN (or token after first auth).

import bcrypt from 'bcryptjs';
import { getSession, setSession } from '../storage/index.js';
import { sessionToPublic } from './session.js';

export default async function facilitatorRoutes(app) {
  /**
   * POST /api/facilitator/auth
   * Body: { code, pin }
   * Returns: { token, code }  — use token for subsequent requests
   */
  app.post('/auth', async (req, reply) => {
    const { code, pin } = req.body ?? {};
    if (!code || !pin) return reply.code(400).send({ error: 'code and pin are required.' });

    const session = getSession(code.toUpperCase().trim());
    if (!session) return reply.code(404).send({ error: 'Session not found.' });

    const ok = bcrypt.compareSync(pin, session.pin);
    if (!ok) return reply.code(401).send({ error: 'Incorrect PIN.' });

    return { token: session.facilToken, code: session.code };
  });

  /**
   * GET /api/facilitator/export
   * Query: { code, token }
   * Returns: JSON with full session data (CSV formatting done client-side for now)
   */
  app.get('/export', async (req, reply) => {
    const { code, token } = req.query ?? {};
    const session = await authCheck(code, token, reply);
    if (!session) return;

    return sessionToPublic(session);
  });
}

// ── Auth helper ───────────────────────────────────────────────────────────────

/**
 * Validate facilitator token. Sends 401 and returns null if invalid.
 * @param {string} code
 * @param {string} token
 * @param {import('fastify').FastifyReply} reply
 * @returns {object|null} session or null
 */
export async function authCheck(code, token, reply) {
  if (!code || !token) { reply.code(400).send({ error: 'code and token required.' }); return null; }
  const session = getSession(code.toUpperCase().trim());
  if (!session) { reply.code(404).send({ error: 'Session not found.' }); return null; }
  if (session.facilToken !== token) { reply.code(401).send({ error: 'Invalid token.' }); return null; }
  return session;
}
