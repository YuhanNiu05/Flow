// FlowCube - M5Stack Core2 主程序
// 功能：IMU 翻转检测 + WiFi + WebSocket 通信 + 屏幕显示
//
// 依赖库（Arduino IDE / PlatformIO）：
//   - M5Core2 (by M5Stack)
//   - ArduinoJson (by Benoit Blanchon)
//   - WebSocketsClient (by Markus Sattler)
//
// 配置：将 config.h.example 复制为 config.h 并填入 WiFi 和服务器信息。

#include <M5Core2.h>
#include <WiFi.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include "config.h"

// ── 翻转检测阈值 ──────────────────────────────────────────────────
#define TILT_THRESHOLD   0.6f   // |cos θ| 分量阈值（0~1）
#define STABLE_FRAMES    8      // 连续稳定帧数才触发事件
#define POLL_INTERVAL_MS 100    // IMU 采样间隔（ms）
#define PING_INTERVAL_MS 20000  // WebSocket keepalive 间隔（ms）

// ── 面定义 ─────────────────────────────────────────────────────────
// M5Stack Core2 放置约定：
//   屏幕朝上 → 待机 (idle)
//   屏幕朝下 → 学习模式 (study)
//   左侧朝上 → 运动模式 (exercise)
//   右侧朝上 → 休息 (rest)
enum Face { FACE_IDLE, FACE_STUDY, FACE_EXERCISE, FACE_REST, FACE_UNKNOWN };

const char* faceNames[] = { "idle", "study", "exercise", "rest", "unknown" };
const char* faceLabels[] = { "待机", "学习模式", "运动模式", "休息", "未知" };

// ── 颜色常量 ──────────────────────────────────────────────────────
#define COLOR_BG      TFT_BLACK
#define COLOR_BLUE    0x64C8FF  // #64c8ff 近似 → TFT 16-bit
#define COLOR_GREEN   TFT_GREEN
#define COLOR_ORANGE  0xFF8C3C
#define COLOR_PURPLE  0xC88FFF
#define COLOR_DIM     0x8899AA
#define COLOR_WHITE   TFT_WHITE

// ── 全局状态 ──────────────────────────────────────────────────────
Face       currentFace    = FACE_UNKNOWN;
Face       lastSentFace   = FACE_UNKNOWN;
int        stableCount    = 0;
bool       wsConnected    = false;
bool       wifiConnected  = false;
uint32_t   timerSeconds   = 0;
bool       timerRunning   = false;
uint32_t   lastTimerTick  = 0;
uint32_t   lastPingMs     = 0;
uint32_t   lastImuMs      = 0;
uint32_t   lastDisplayMs  = 0;

WebSocketsClient wsClient;

// ─────────────────────────────────────────────────────────────────
// IMU 翻转检测
// ─────────────────────────────────────────────────────────────────
Face detectFace() {
  float ax, ay, az;
  M5.IMU.getAccelData(&ax, &ay, &az);

  // Z 轴：正值 = 屏幕朝上，负值 = 屏幕朝下
  if (az >  TILT_THRESHOLD) return FACE_IDLE;
  if (az < -TILT_THRESHOLD) return FACE_STUDY;

  // X 轴：左右翻转
  if (ax >  TILT_THRESHOLD) return FACE_EXERCISE;
  if (ax < -TILT_THRESHOLD) return FACE_REST;

  return FACE_UNKNOWN;
}

// ─────────────────────────────────────────────────────────────────
// 屏幕绘制
// ─────────────────────────────────────────────────────────────────
void drawStatusBar() {
  M5.Lcd.fillRect(0, 0, 320, 24, COLOR_BG);
  M5.Lcd.setTextSize(1);
  M5.Lcd.setTextColor(wifiConnected ? COLOR_GREEN : COLOR_DIM);
  M5.Lcd.drawString(wifiConnected ? "WiFi OK" : "WiFi --", 4, 6);
  M5.Lcd.setTextColor(wsConnected  ? COLOR_BLUE  : COLOR_DIM);
  M5.Lcd.drawString(wsConnected    ? "WS OK"   : "WS --",  80, 6);
}

void drawFace(Face face) {
  M5.Lcd.fillRect(0, 26, 320, 160, COLOR_BG);

  uint32_t accent = COLOR_WHITE;
  switch (face) {
    case FACE_STUDY:    accent = COLOR_BLUE;    break;
    case FACE_EXERCISE: accent = COLOR_ORANGE;  break;
    case FACE_REST:     accent = COLOR_PURPLE;  break;
    default:            accent = COLOR_DIM;     break;
  }

  M5.Lcd.setTextColor(accent);
  M5.Lcd.setTextSize(2);
  M5.Lcd.drawCentreString(faceLabels[face], 160, 60, 2);

  // 图标提示
  M5.Lcd.setTextSize(1);
  M5.Lcd.setTextColor(COLOR_DIM);
  const char* hint = "";
  switch (face) {
    case FACE_IDLE:     hint = "flip to start focus"; break;
    case FACE_STUDY:    hint = "screen down -> study"; break;
    case FACE_EXERCISE: hint = "left up -> exercise";  break;
    case FACE_REST:     hint = "right up -> rest";     break;
    default: break;
  }
  M5.Lcd.drawCentreString(hint, 160, 100, 1);
}

void drawTimer() {
  M5.Lcd.fillRect(0, 186, 320, 54, COLOR_BG);
  if (!timerRunning && timerSeconds == 0) return;

  uint32_t h   = timerSeconds / 3600;
  uint32_t min = (timerSeconds % 3600) / 60;
  uint32_t sec = timerSeconds % 60;

  char buf[12];
  if (h > 0) snprintf(buf, sizeof(buf), "%02u:%02u:%02u", h, min, sec);
  else       snprintf(buf, sizeof(buf), "%02u:%02u", min, sec);

  uint32_t col = (currentFace == FACE_EXERCISE) ? COLOR_ORANGE : COLOR_BLUE;
  M5.Lcd.setTextColor(col);
  M5.Lcd.setTextSize(3);
  M5.Lcd.drawCentreString(buf, 160, 196, 3);
}

void drawAll() {
  drawStatusBar();
  drawFace(currentFace);
  drawTimer();
}

// ─────────────────────────────────────────────────────────────────
// WebSocket
// ─────────────────────────────────────────────────────────────────
void sendHandshake() {
  StaticJsonDocument<128> doc;
  doc["type"]        = "handshake";
  doc["client_type"] = "device";
  doc["device_id"]   = DEVICE_ID;
  char buf[128];
  serializeJson(doc, buf);
  wsClient.sendTXT(buf);
  Serial.println("[WS] Handshake sent");
}

void sendOrientation(Face face) {
  StaticJsonDocument<128> doc;
  doc["type"]      = "orientation";
  doc["device_id"] = DEVICE_ID;
  doc["face"]      = faceNames[face];
  doc["timestamp"] = millis();
  char buf[128];
  serializeJson(doc, buf);
  wsClient.sendTXT(buf);
  Serial.printf("[WS] Orientation sent: %s\n", faceNames[face]);
}

void sendPing() {
  StaticJsonDocument<64> doc;
  doc["type"] = "ping";
  char buf[64];
  serializeJson(doc, buf);
  wsClient.sendTXT(buf);
}

void onWsEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsConnected = true;
      Serial.println("[WS] Connected");
      sendHandshake();
      drawStatusBar();
      break;

    case WStype_DISCONNECTED:
      wsConnected = false;
      Serial.println("[WS] Disconnected");
      drawStatusBar();
      break;

    case WStype_TEXT: {
      StaticJsonDocument<256> doc;
      if (deserializeJson(doc, payload, length) == DeserializationError::Ok) {
        const char* msgType = doc["type"];
        if (strcmp(msgType, "handshake_ack") == 0) {
          Serial.println("[WS] Handshake acknowledged");
        } else if (strcmp(msgType, "pong") == 0) {
          // keepalive acknowledged
        }
      }
      break;
    }
    default:
      break;
  }
}

// ─────────────────────────────────────────────────────────────────
// WiFi 连接
// ─────────────────────────────────────────────────────────────────
void connectWiFi() {
  Serial.printf("[WiFi] Connecting to %s ...\n", WIFI_SSID);
  M5.Lcd.setTextColor(COLOR_DIM);
  M5.Lcd.setTextSize(1);
  M5.Lcd.drawCentreString("Connecting to WiFi...", 160, 110, 1);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    attempts++;
    M5.Lcd.drawCentreString(".....", 160, 130, 1);
  }

  wifiConnected = (WiFi.status() == WL_CONNECTED);
  if (wifiConnected) {
    Serial.printf("[WiFi] Connected, IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[WiFi] Connection failed, running offline");
  }
}

// ─────────────────────────────────────────────────────────────────
// Setup & Loop
// ─────────────────────────────────────────────────────────────────
void setup() {
  M5.begin();
  Serial.begin(115200);

  M5.IMU.Init();
  M5.Lcd.fillScreen(COLOR_BG);
  M5.Lcd.setTextDatum(MC_DATUM);

  // Splash screen
  M5.Lcd.setTextColor(COLOR_BLUE);
  M5.Lcd.setTextSize(3);
  M5.Lcd.drawCentreString("FLOWCUBE", 160, 80, 3);
  M5.Lcd.setTextSize(1);
  M5.Lcd.setTextColor(COLOR_DIM);
  M5.Lcd.drawCentreString("心流魔方 v1.0", 160, 130, 1);
  delay(1200);

  M5.Lcd.fillScreen(COLOR_BG);

  connectWiFi();

  if (wifiConnected) {
    wsClient.begin(SERVER_HOST, SERVER_PORT, SERVER_PATH);
    wsClient.onEvent(onWsEvent);
    wsClient.setReconnectInterval(5000);
    Serial.printf("[WS] Connecting to %s:%d%s\n", SERVER_HOST, SERVER_PORT, SERVER_PATH);
  }

  currentFace = detectFace();
  drawAll();
}

void loop() {
  M5.update();

  uint32_t now = millis();

  // ── WebSocket loop ──
  if (wifiConnected) {
    wsClient.loop();
    // Keepalive ping
    if (wsConnected && (now - lastPingMs > PING_INTERVAL_MS)) {
      sendPing();
      lastPingMs = now;
    }
  }

  // ── IMU poll ──
  if (now - lastImuMs >= POLL_INTERVAL_MS) {
    lastImuMs = now;
    Face raw = detectFace();

    if (raw == currentFace) {
      stableCount = min(stableCount + 1, STABLE_FRAMES);
    } else {
      stableCount = 0;
      currentFace = raw;
    }

    // Trigger orientation event once face has been stable for N frames
    if (stableCount == STABLE_FRAMES && currentFace != lastSentFace) {
      lastSentFace = currentFace;
      Serial.printf("[IMU] Stable face: %s\n", faceNames[currentFace]);

      // Update timer state
      if (currentFace == FACE_STUDY || currentFace == FACE_EXERCISE) {
        if (!timerRunning) {
          timerSeconds  = 0;
          timerRunning  = true;
          lastTimerTick = now;
        }
      } else if (currentFace == FACE_REST || currentFace == FACE_IDLE) {
        timerRunning = false;
      }

      // Send to app via WebSocket
      if (wsConnected) sendOrientation(currentFace);
      drawAll();
    }
  }

  // ── Timer tick ──
  if (timerRunning && (now - lastTimerTick >= 1000)) {
    lastTimerTick += 1000;
    timerSeconds++;
    // Refresh timer display every second (light update only)
    drawTimer();
  }

  // ── Button A: manual focus toggle ──
  if (M5.BtnA.wasPressed()) {
    if (!timerRunning) {
      // Force study mode if idle
      currentFace  = FACE_STUDY;
      lastSentFace = FACE_STUDY;
      timerSeconds = 0;
      timerRunning = true;
      lastTimerTick = now;
      if (wsConnected) sendOrientation(FACE_STUDY);
    } else {
      timerRunning = false;
      currentFace  = FACE_IDLE;
      lastSentFace = FACE_IDLE;
      if (wsConnected) sendOrientation(FACE_IDLE);
    }
    drawAll();
  }

  // ── Button B: reset timer ──
  if (M5.BtnB.wasPressed()) {
    timerRunning = false;
    timerSeconds = 0;
    currentFace  = FACE_IDLE;
    lastSentFace = FACE_IDLE;
    if (wsConnected) sendOrientation(FACE_IDLE);
    drawAll();
  }

  delay(10);
}
