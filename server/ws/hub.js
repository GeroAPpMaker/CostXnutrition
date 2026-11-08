// server/ws/hub.js
// WebSocket connection manager.
// Tracks connections by sessionCode + clientId.
// All broadcasts go through this module.

/** @type {Map<string, Map<string, import('ws').WebSocket>>} */
// connections: sessionCode → Map<clientId, ws>
const connections = new Map();

/**
 * Register a WS connection.
 */
export function register(sessionCode, clientId, ws) {
  if (!connections.has(sessionCode)) connections.set(sessionCode, new Map());
  connections.get(sessionCode).set(clientId, ws);
}

/**
 * Remove a WS connection.
 */
export function unregister(sessionCode, clientId) {
  connections.get(sessionCode)?.delete(clientId);
}

/**
 * Send a message to one client.
 */
export function sendTo(sessionCode, clientId, payload) {
  const ws = connections.get(sessionCode)?.get(clientId);
  if (ws && ws.readyState === 1 /* OPEN */) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * Broadcast to all clients in a session.
 * @param {string} [excludeClientId]
 */
export function broadcast(sessionCode, payload, excludeClientId) {
  const room = connections.get(sessionCode);
  if (!room) return;
  const msg = JSON.stringify(payload);
  for (const [cid, ws] of room) {
    if (cid === excludeClientId) continue;
    if (ws.readyState === 1) ws.send(msg);
  }
}

/**
 * Attach the WS server and wire up connection/message handling.
 * handlers.js is imported lazily on first message to break the circular dep.
 * @param {import('ws').WebSocketServer} wss
 */
export function attachHub(wss) {
  // Lazy-loaded handlers module reference
  let handlers = null;
  async function getHandlers() {
    if (!handlers) handlers = await import('./handlers.js');
    return handlers;
  }

  wss.on('connection', (ws) => {
    ws._meta = { sessionCode: null, clientId: null, role: null };

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      const h = await getHandlers();
      h.routeMessage(ws, msg);
    });

    ws.on('close', async () => {
      const { sessionCode, clientId, role } = ws._meta;
      if (sessionCode && clientId) {
        unregister(sessionCode, clientId);
        if (role === 'student') {
          const h = await getHandlers();
          h.handleDisconnect(sessionCode, clientId);
        }
      }
    });

    ws.on('error', (err) => {
      console.error('WS error:', err.message);
    });
  });
}
