// server/storage/index.js
// Public storage interface. Swap memory.js for a DB module here only.
export { getSession, setSession, deleteSession, listSessions } from './memory.js';
