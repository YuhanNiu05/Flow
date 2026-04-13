require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

const authRoutes = require('./routes/auth');
const sessionsRoutes = require('./routes/sessions');
const statsRoutes = require('./routes/stats');

const app = express();
const server = http.createServer(app);

// ── WebSocket server (for M5Stack hardware communication) ──────────────────
const wss = new WebSocket.Server({ server, path: '/ws' });

// Map from deviceId -> WebSocket client (M5Stack device)
const devices = new Map();
// Map from deviceId -> WebSocket client (browser app waiting for hardware events)
const browsers = new Map();

wss.on('connection', (ws, req) => {
  let clientId = null;
  let clientType = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    // First message must be a handshake: { type: "handshake", client_type: "device"|"app", device_id: "..." }
    if (!clientId) {
      if (msg.type !== 'handshake' || !msg.device_id || !msg.client_type) {
        ws.send(JSON.stringify({ type: 'error', message: 'First message must be a handshake' }));
        ws.close();
        return;
      }
      clientId = msg.device_id;
      clientType = msg.client_type;

      if (clientType === 'device') {
        devices.set(clientId, ws);
        console.log(`[WS] M5Stack device connected: ${clientId}`);
      } else {
        browsers.set(clientId, ws);
        console.log(`[WS] Browser app connected for device: ${clientId}`);
      }

      ws.send(JSON.stringify({ type: 'handshake_ack', device_id: clientId }));
      return;
    }

    // Orientation / flip event from M5Stack device → forward to paired browser
    if (clientType === 'device' && msg.type === 'orientation') {
      const browserWs = browsers.get(clientId);
      if (browserWs && browserWs.readyState === WebSocket.OPEN) {
        browserWs.send(JSON.stringify({
          type: 'orientation',
          device_id: clientId,
          face: msg.face,          // "study" | "exercise" | "rest" | "idle"
          timestamp: msg.timestamp || Date.now()
        }));
      }
    }

    // Ping / keepalive
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
    }
  });

  ws.on('close', () => {
    if (clientId) {
      if (clientType === 'device') devices.delete(clientId);
      else browsers.delete(clientId);
      console.log(`[WS] Disconnected: ${clientType} ${clientId}`);
    }
  });

  ws.on('error', (err) => console.error('[WS] Error:', err.message));
});

// ── HTTP middleware ────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(express.json());

// ── Routes ─────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/stats', statsRoutes);

// ── Static files (for web app) ───────────────────────────────────────────────
const path = require('path');
app.use(express.static(path.join(__dirname, '../../..')));

// ── Handle SPA fallback ─────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../..', 'index.html'));
});

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`FlowCube API server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
});
