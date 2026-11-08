// server/index.js
import Fastify from 'fastify';
import FastifyStatic from '@fastify/static';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import sessionRoutes from './routes/session.js';
import joinRoutes from './routes/join.js';
import facilitatorRoutes from './routes/facilitator.js';
import { attachHub } from './ws/hub.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT      = parseInt(process.env.PORT ?? '3000', 10);

const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });

// Serve static client files
app.register(FastifyStatic, {
  root:   join(__dirname, '../client'),
  prefix: '/',
});

// API routes
app.register(sessionRoutes,    { prefix: '/api' });
app.register(joinRoutes,       { prefix: '/api' });
app.register(facilitatorRoutes,{ prefix: '/api/facilitator' });

// Health check
app.get('/health', async () => ({ ok: true }));

// Start listening — Fastify creates its own http.Server internally
const start = async () => {
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });

    // Attach WS server to Fastify's underlying http.Server
    const wss = new WebSocketServer({ server: app.server });
    attachHub(wss);

    console.log(`CostPlate running on http://localhost:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

export default app;
