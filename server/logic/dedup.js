// server/logic/dedup.js
// Ensure nickname is unique within a session.
// If "Juan" is taken, tries "Juan_2", "Juan_3", etc.

/**
 * @param {string} requested - the nickname the student wants
 * @param {Map<string, import('../storage/memory.js').Participant>} participants
 * @returns {string} unique nickname for this session
 */
export function uniqueNickname(requested, participants) {
  const taken = new Set([...participants.values()].map(p => p.nickname.toLowerCase()));
  let candidate = requested.trim().slice(0, 30);
  if (!taken.has(candidate.toLowerCase())) return candidate;
  let n = 2;
  while (taken.has(`${candidate}_${n}`.toLowerCase())) n++;
  return `${candidate}_${n}`;
}
