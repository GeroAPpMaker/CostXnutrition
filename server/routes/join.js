// server/routes/join.js
// POST /api/join — student joins a session

import { randomUUID } from 'node:crypto';
import { getSession, setSession } from '../storage/index.js';
import { uniqueNickname } from '../logic/dedup.js';
import { DISHES } from '../../config/dishes.js';

export default async function joinRoutes(app) {
  /**
   * POST /api/join
   * Body: { code, nickname, teamName }
   * Returns: { clientId, nickname, teamName }
   *   (nickname may be modified to be unique, e.g. "Juan_2")
   */
  app.post('/join', async (req, reply) => {
    const { code, nickname, teamName } = req.body ?? {};

    if (!code || !nickname || !teamName) {
      return reply.code(400).send({ error: 'code, nickname, and teamName are required.' });
    }

    const session = getSession(code.toUpperCase().trim());
    if (!session) {
      return reply.code(404).send({ error: 'Session not found. Check the code and try again.' });
    }
    if (session.phase === 'RESULTS' || session.endedAt) {
      return reply.code(400).send({ error: 'This session has ended.' });
    }

    const uniqueName = uniqueNickname(nickname, session.participants);
    const normalTeam = teamName.trim().toLowerCase();

    // Create participant
    const clientId = randomUUID();
    const dish     = DISHES[session.dishKey];

    /** @type {import('../storage/memory.js').Participant} */
    const participant = {
      clientId,
      nickname:    uniqueName,
      teamName:    teamName.trim(),
      connected:   false,        // WS not yet attached; set true on REJOIN
      hookAnswers:     { q1: null, q2: null, q3: null },
      discPollAnswers: [null, null],
      currentRecipe:   { ...dish.versionA }, // everyone starts on Version A
      submissions:     [],
      bestScore:       0,
      viabilityFailCount: 0,
      lastSubmitAt:    null,
      exitQuiz:        { answers: [], score: null },
      confidence:      null,
      reflection:      '',
      facilitatorNote: '',
      joinedAt:        new Date(),
    };

    session.participants.set(clientId, participant);

    // Register or update team
    if (!session.teams.has(normalTeam)) {
      session.teams.set(normalTeam, {
        name:              teamName.trim(),
        members:           new Set(),
        bestSubmission:    null,
        speedBonusAwarded: false,
      });
    }
    session.teams.get(normalTeam).members.add(clientId);

    setSession(code, session);

    return { clientId, nickname: uniqueName, teamName: teamName.trim() };
  });
}
