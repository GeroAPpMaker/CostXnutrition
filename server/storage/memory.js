// server/storage/memory.js
// In-memory session store. Replace this module with a DB-backed one
// without changing any other file — all access goes through storage/index.js.

const sessions = new Map();

export function getSession(code) {
  return sessions.get(code) ?? null;
}

export function setSession(code, session) {
  sessions.set(code, session);
}

export function deleteSession(code) {
  sessions.delete(code);
}

export function listSessions() {
  return [...sessions.values()];
}
