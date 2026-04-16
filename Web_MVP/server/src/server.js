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
// Map from deviceId -> Set<WebSocket> (browser clients subscribed to that device)
const browsers = new Map();
// Set of browser clients subscribed to all devices (no deviceId filter)
const wildcardBrowsers = new Set();

/**
 * Broadcast an orientation payload to all browser clients subscribed to deviceId,
 * plus any wildcard clients (subscribed to all devices).
 * @param {string} deviceId
 * @param {object} payload
 */
function broadcastOrientation(deviceId, payload) {
  const msg = JSON.stringify(payload);
  const deviceSet = browsers.get(deviceId);
  if (deviceSet) {
    for (const ws of deviceSet) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }
  for (const ws of wildcardBrowsers) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

wss.on('connection', (ws, req) => {
  // Support ?deviceId=... URL query param for browser auto-registration (no handshake needed)
  const url = new URL(req.url, 'http://localhost');
  const queryDeviceId = url.searchParams.get('deviceId');

  let clientId = null;
  let clientType = null;

  if (queryDeviceId) {
    clientId = queryDeviceId;
    clientType = 'app';
    if (!browsers.has(clientId)) browsers.set(clientId, new Set());
    browsers.get(clientId).add(ws);
    ws.send(JSON.stringify({ type: 'handshake_ack', device_id: clientId }));
    console.log(`[WS] Browser connected for device: ${clientId} (via URL param)`);
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    // First message must be a handshake (if not already registered via URL param)
    if (!clientId) {
      if (msg.type !== 'handshake' || !msg.client_type) {
        ws.send(JSON.stringify({ type: 'error', message: 'First message must be a handshake' }));
        ws.close();
        return;
      }
      clientType = msg.client_type;
      clientId = msg.device_id || null;

      if (clientType === 'device') {
        if (!clientId) {
          ws.send(JSON.stringify({ type: 'error', message: 'device_id required for device handshake' }));
          ws.close();
          return;
        }
        devices.set(clientId, ws);
        console.log(`[WS] M5Stack device connected: ${clientId}`);
      } else {
        // Browser / app client
        if (clientId) {
          if (!browsers.has(clientId)) browsers.set(clientId, new Set());
          browsers.get(clientId).add(ws);
          console.log(`[WS] Browser connected for device: ${clientId} (via handshake)`);
        } else {
          // No deviceId → wildcard (receives all events)
          wildcardBrowsers.add(ws);
          console.log(`[WS] Wildcard browser connected (receives all events)`);
        }
      }

      ws.send(JSON.stringify({ type: 'handshake_ack', device_id: clientId }));
      return;
    }

    // Orientation / flip event from M5Stack device → broadcast to subscribed browsers
    if (clientType === 'device' && msg.type === 'orientation') {
      broadcastOrientation(clientId, {
        type: 'orientation',
        device_id: clientId,
        face: msg.face,          // "study" | "exercise" | "rest" | "idle"
        timestamp: msg.timestamp || Date.now()
      });
    }

    // Ping / keepalive
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
    }
  });

  ws.on('close', () => {
    if (clientId) {
      if (clientType === 'device') {
        devices.delete(clientId);
      } else {
        const set = browsers.get(clientId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) browsers.delete(clientId);
        }
      }
      console.log(`[WS] Disconnected: ${clientType} ${clientId}`);
    } else {
      wildcardBrowsers.delete(ws);
      console.log(`[WS] Wildcard browser disconnected`);
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

// Device routes — pass broadcastOrientation so the handler can push to WS clients
const deviceRoutes = require('./routes/device')(broadcastOrientation);
app.use('/device', deviceRoutes);

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
  console.log(`Device orientation: POST http://localhost:${PORT}/device/orientation`);
});
