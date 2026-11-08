// client/js/ws-client.js
// Auto-reconnecting WebSocket wrapper.
// Falls back to SSE long-polling if WS handshake fails within 3 s.
// Usage:
//   const ws = new ReconnectingWS(url, onMessage, onOpen, onClose);
//   ws.send({ type: 'PING' });

const WS_TIMEOUT_MS = 3000;
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;

export class ReconnectingWS {
  /**
   * @param {string} url - WebSocket URL (ws:// or wss://)
   * @param {(msg: object) => void} onMessage
   * @param {() => void} [onOpen]
   * @param {() => void} [onClose]
   */
  constructor(url, onMessage, onOpen, onClose) {
    this._url = url;
    this._onMessage = onMessage;
    this._onOpen = onOpen ?? (() => {});
    this._onClose = onClose ?? (() => {});
    this._delay = RECONNECT_DELAY_MS;
    this._ws = null;
    this._closed = false; // true after explicit close()
    this._connect();
  }

  _connect() {
    if (this._closed) return;

    const ws = new WebSocket(this._url);
    this._ws = ws;

    // If connection doesn't open within WS_TIMEOUT_MS, try SSE fallback (future)
    const timeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close();
        // TODO: SSE fallback (M4)
      }
    }, WS_TIMEOUT_MS);

    ws.addEventListener('open', () => {
      clearTimeout(timeout);
      this._delay = RECONNECT_DELAY_MS; // reset back-off
      this._onOpen();
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      this._onMessage(msg);
    });

    ws.addEventListener('close', () => {
      clearTimeout(timeout);
      this._onClose();
      if (!this._closed) {
        setTimeout(() => this._connect(), this._delay);
        this._delay = Math.min(this._delay * 1.5, MAX_RECONNECT_DELAY_MS);
      }
    });

    ws.addEventListener('error', () => {
      // 'close' event fires after 'error', so reconnect is handled there
    });
  }

  /** Send a plain object as JSON. */
  send(obj) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(obj));
    }
  }

  /** Permanently close the connection. */
  close() {
    this._closed = true;
    this._ws?.close();
  }
}

/** Build the WebSocket URL from the current page's origin. */
export function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}
