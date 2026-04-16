# flowcube

FlowCube is a focus-tracking app powered by an **M5Stack Core2** physical cube.  
The device detects which face is up (study / exercise / rest / idle) and reports orientation events to the backend, which then pushes them to connected web clients via WebSocket.

---

## Project Structure

```
Flow/
├── Web_MVP/
│   └── server/          # Node.js / Express backend
│       ├── src/
│       │   ├── server.js          # Entry point, HTTP + WebSocket server
│       │   └── routes/
│       │       ├── auth.js        # POST /api/auth/register|login
│       │       ├── sessions.js    # CRUD /api/sessions
│       │       ├── stats.js       # GET /api/stats
│       │       └── device.js      # POST /device/orientation  ← NEW
│       ├── package.json
│       └── .env.example
├── M5Stack_Hardware_Code/   # Arduino / M5Stack firmware (C++)
├── device-test.html         # WebSocket test page  ← NEW
└── index.html               # Main web app SPA
```

---

## Backend Setup

### 1. Install dependencies

```bash
cd Web_MVP/server
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET at minimum; Supabase vars are optional (demo mode works without them)
```

### 3. Start the server

```bash
# Production
npm start

# Development (auto-reload)
npm run dev
```

The server starts on **port 3000** by default (configurable via `PORT` in `.env`).

Startup output:
```
FlowCube API server running on port 3000
WebSocket endpoint: ws://localhost:3000/ws
Device orientation: POST http://localhost:3000/device/orientation
```

---

## Device Orientation API

### `POST /device/orientation`

Receives a flip/orientation event from the M5Stack hardware.

**Required body fields:**

| Field | Type | Description |
|---|---|---|
| `deviceId` | string | Device identifier (e.g. `"core2-001"`) |
| `event` | string | Event type (e.g. `"flip"`) |
| `orientation` | string | `"face_up"` \| `"face_down"` \| `"study"` \| etc. |
| `ts` | number | Timestamp (Unix seconds or ms) |

**Optional fields:** `ax`, `ay`, `az`, `battery`, or any extra fields — all forwarded to WebSocket subscribers.

**Responses:**

- `200 OK` → `{ "ok": true }`
- `400 Bad Request` → `{ "error": "Missing required fields: ..." }`

### Test with curl

```bash
curl -X POST http://localhost:3000/device/orientation \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"core2-001","event":"flip","orientation":"face_down","ts":123456}'
# → {"ok":true}
```

With optional accelerometer data:

```bash
curl -X POST http://localhost:3000/device/orientation \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"core2-001","event":"flip","orientation":"face_up","ts":123457,"ax":0.02,"ay":0.01,"az":0.98}'
```

---

## WebSocket API

**Endpoint:** `ws://localhost:3000/ws`

### Browser / web client

Connect with a `deviceId` query parameter to receive events for that specific device:

```
ws://localhost:3000/ws?deviceId=core2-001
```

Omit `deviceId` to receive events from **all** devices (wildcard):

```
ws://localhost:3000/ws
```

When connecting without a query param, send a handshake as the first message:

```json
{ "type": "handshake", "client_type": "app", "device_id": "core2-001" }
```

Or for wildcard:

```json
{ "type": "handshake", "client_type": "app" }
```

The server replies with:

```json
{ "type": "handshake_ack", "device_id": "core2-001" }
```

### Orientation event (pushed by server)

When `POST /device/orientation` is received, the server broadcasts to all subscribed browser clients:

```json
{
  "type": "orientation",
  "deviceId": "core2-001",
  "event": "flip",
  "orientation": "face_down",
  "ts": 123456,
  "receivedAt": 1710000000000
}
```

### M5Stack device (WebSocket alternative)

Devices can also connect via WebSocket and send orientation events directly (no HTTP POST needed):

```json
{ "type": "handshake", "client_type": "device", "device_id": "core2-001" }
```

Then send orientation events:

```json
{ "type": "orientation", "face": "study", "timestamp": 1710000000 }
```

---

## Web Test Page

Open **`http://localhost:3000/device-test.html`** in a browser.

- Enter a `deviceId` (or leave blank to receive all events).
- Click **连接** to open the WebSocket connection.
- Run the `curl` command above — the event appears in the page in real time.

You can also pass the deviceId via URL:

```
http://localhost:3000/device-test.html?deviceId=core2-001
```

---

## Health Check

```bash
curl http://localhost:3000/health
# → {"status":"ok","timestamp":"..."}
```
