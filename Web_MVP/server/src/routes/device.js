const express = require('express');

// Fields that are already promoted into the payload object; don't copy them again
const REQUIRED_FIELDS = new Set(['deviceId', 'event', 'orientation', 'ts']);

/**
 * Creates the device router.
 * @param {function(string, object): void} broadcastOrientation
 *   Called with (deviceId, payload) to push the event to all subscribed WebSocket clients.
 * @returns {import('express').Router}
 */
module.exports = function createDeviceRouter(broadcastOrientation) {
  const router = express.Router();

  // POST /device/orientation
  // Accepts orientation / flip events reported by M5Stack hardware via HTTP POST.
  // Required body fields: deviceId, event, orientation, ts
  // Optional fields: ax, ay, az, battery, etc.
  router.post('/orientation', (req, res) => {
    const { deviceId, event, orientation, ts } = req.body || {};

    if (!deviceId || !event || !orientation || ts == null || typeof ts !== 'number') {
      return res.status(400).json({
        error: 'Missing required fields: deviceId, event, orientation, ts'
      });
    }

    console.log(
      `[Device] orientation event | deviceId=${deviceId} orientation=${orientation} ts=${ts}`
    );

    // Build the payload broadcast to WebSocket subscribers.
    // Include all body fields so optional data (ax, ay, az, battery, …) flows through.
    const payload = {
      type: 'orientation',
      deviceId,
      event,
      orientation,
      ts,
      receivedAt: Date.now()
    };

    // Copy optional extra fields (e.g. ax, ay, az, battery)
    for (const [key, value] of Object.entries(req.body)) {
      if (!REQUIRED_FIELDS.has(key)) payload[key] = value;
    }

    broadcastOrientation(deviceId, payload);

    return res.json({ ok: true });
  });

  return router;
};
