// FlowCube - M5Stack Core2 主程序
// 功能：IMU 翻转检测 + 屏幕颜色 + 提示音 + 震动 + 串口输出 + WebSocket / HTTP 上报
//
// 交互规则：
//   屏幕朝上 (Z > 0.8G)  → 蓝屏 + 清脆单音  + 短震 1 次 → {"action":"study"}
//   左侧朝上 (X > 0.8G)  → 红屏 + 心跳双音  + 短震 2 次 → {"action":"sport"}
//   右侧朝上 (X < -0.8G) → 绿屏 + 低沉长音  + 长震 1 次 → {"action":"end"}
//
// 依赖库（Arduino IDE 库管理器安装）：
//   - M5Core2          (by M5Stack)
//   - ArduinoJson      (by Benoit Blanchon)
//   - WebSocketsClient (by Markus Sattler)
//
// 配置：将 config.h.example 复制为 config.h 并填入 WiFi 和服务器信息。

#include <M5Core2.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WebSocketsClient.h>
#include "config.h"

// ── 检测阈值 ──────────────────────────────────────────────────────
#define TILT_THRESHOLD   0.8f   // 按规格：0.8 G
#define STABLE_FRAMES    8      // 连续稳定帧数才触发事件
#define POLL_INTERVAL_MS 100    // IMU 采样间隔（ms）
#define PING_INTERVAL_MS 20000  // WebSocket keepalive 间隔（ms）

// ── 姿态定义 ──────────────────────────────────────────────────────
//   FACE_IDLE    : 未识别到有效姿态（等待状态）
//   FACE_STUDY   : 屏幕朝上  → action = "study"
//   FACE_SPORT   : 左侧朝上  → action = "sport"
//   FACE_END     : 右侧朝上  → action = "end"
enum Face { FACE_IDLE, FACE_STUDY, FACE_SPORT, FACE_END, FACE_UNKNOWN };

const char* faceActions[] = { "",       "study",    "sport",   "end",      "" };
const char* faceLabels[]  = { "待机",  "学  习",   "运  动",  "结  束",  "未知" };

// ── 全局状态 ──────────────────────────────────────────────────────
Face     currentFace  = FACE_UNKNOWN;
Face     lastSentFace = FACE_UNKNOWN;
int      stableCount  = 0;
bool     wsConnected  = false;
bool     wifiConnected = false;
uint32_t lastPingMs   = 0;
uint32_t lastImuMs    = 0;

WebSocketsClient wsClient;

// ─────────────────────────────────────────────────────────────────
// 震动马达（AXP192 LDO3 控制）
// ─────────────────────────────────────────────────────────────────
static inline void motorOn()  { M5.Axp.SetLDOEnable(3, true);  }
static inline void motorOff() { M5.Axp.SetLDOEnable(3, false); }

// count  : 震动次数
// onMs   : 单次震动时长（ms）
// offMs  : 两次之间间隔（ms）
void vibrate(int count, int onMs, int offMs) {
  for (int i = 0; i < count; i++) {
    motorOn();
    delay(onMs);
    motorOff();
    if (i < count - 1) delay(offMs);
  }
}

// ─────────────────────────────────────────────────────────────────
// 提示音（M5.Speaker.tone 为非阻塞，需配合 delay + mute）
// ─────────────────────────────────────────────────────────────────

// 清脆单音：1000 Hz × 150 ms
void playStudySound() {
  M5.Speaker.tone(1000, 150);
  delay(200);
  M5.Speaker.mute();
}

// 心跳双音：440 Hz，两下，中间短暂停顿
void playSportSound() {
  M5.Speaker.tone(440, 100);
  delay(150);
  M5.Speaker.mute();
  delay(80);
  M5.Speaker.tone(440, 100);
  delay(150);
  M5.Speaker.mute();
}

// 低沉长音：220 Hz × 500 ms
void playEndSound() {
  M5.Speaker.tone(220, 500);
  delay(560);
  M5.Speaker.mute();
}

// ─────────────────────────────────────────────────────────────────
// 屏幕绘制
// ─────────────────────────────────────────────────────────────────
void drawScreen(Face face) {
  // 背景色
  uint32_t bg;
  switch (face) {
    case FACE_STUDY: bg = TFT_BLUE;  break;
    case FACE_SPORT: bg = TFT_RED;   break;
    case FACE_END:   bg = TFT_GREEN; break;
    default:         bg = TFT_BLACK; break;
  }
  M5.Lcd.fillScreen(bg);

  // 待机 / 未知：简单提示
  if (face == FACE_IDLE || face == FACE_UNKNOWN) {
    M5.Lcd.setTextColor(0x888888);
    M5.Lcd.setTextSize(2);
    M5.Lcd.drawCentreString("FlowCube", 160, 90, 2);
    M5.Lcd.setTextSize(1);
    M5.Lcd.drawCentreString("翻转以开始", 160, 145, 1);
    return;
  }

  // 文字颜色：绿色背景用黑字，其余用白字
  uint32_t fg = (face == FACE_END) ? TFT_BLACK : TFT_WHITE;

  // 大字：模式名
  M5.Lcd.setTextColor(fg);
  M5.Lcd.setTextSize(4);
  M5.Lcd.drawCentreString(faceLabels[face], 160, 70, 4);

  // 小字：action 值
  M5.Lcd.setTextSize(2);
  char actionBuf[24];
  snprintf(actionBuf, sizeof(actionBuf), "action: %s", faceActions[face]);
  M5.Lcd.drawCentreString(actionBuf, 160, 158, 2);

  // 底部状态行：WiFi / WS
  M5.Lcd.setTextSize(1);
  M5.Lcd.setTextColor(fg);
  M5.Lcd.drawString(wifiConnected ? "WiFi OK" : "WiFi --", 4,  222);
  M5.Lcd.drawString(wsConnected   ? "WS OK"   : "WS --",  88, 222);
}

// ─────────────────────────────────────────────────────────────────
// 姿态事件处理：屏幕 → 声音 → 震动 → 串口 → 网络上报
// ─────────────────────────────────────────────────────────────────
void handleFaceEvent(Face face) {
  // 1. 屏幕颜色
  drawScreen(face);

  // 2. 声音 + 震动（仅有效姿态触发）
  switch (face) {
    case FACE_STUDY:
      playStudySound();
      vibrate(1, 100, 0);     // 短震 1 次
      break;
    case FACE_SPORT:
      playSportSound();
      vibrate(2, 100, 120);   // 短震 2 次
      break;
    case FACE_END:
      playEndSound();
      vibrate(1, 400, 0);     // 长震 1 次
      break;
    default:
      return;  // FACE_IDLE / FACE_UNKNOWN 不输出事件
  }

  // 3. 串口 JSON 输出
  StaticJsonDocument<64> serialDoc;
  serialDoc["action"] = faceActions[face];
  serializeJson(serialDoc, Serial);
  Serial.println();

  // 4. WebSocket 上报
  if (wsConnected) {
    StaticJsonDocument<128> wsDoc;
    wsDoc["type"]      = "orientation";
    wsDoc["device_id"] = DEVICE_ID;
    wsDoc["face"]      = faceActions[face];
    wsDoc["timestamp"] = millis();
    char wsBuf[128];
    serializeJson(wsDoc, wsBuf);
    wsClient.sendTXT(wsBuf);
    Serial.printf("[WS] Sent: %s\n", faceActions[face]);
  }

  // 5. HTTP POST 上报（/device/orientation）
  if (wifiConnected) {
    HTTPClient http;
    char url[96];
    snprintf(url, sizeof(url), "http://%s:%d/device/orientation", SERVER_HOST, SERVER_PORT);
    http.begin(url);
    http.addHeader("Content-Type", "application/json");

    StaticJsonDocument<128> postDoc;
    postDoc["deviceId"]    = DEVICE_ID;
    postDoc["event"]       = "flip";
    postDoc["orientation"] = faceActions[face];
    postDoc["ts"]          = (uint32_t)(millis() / 1000);
    char postBuf[128];
    serializeJson(postDoc, postBuf);

    int code = http.POST(postBuf);
    Serial.printf("[HTTP] POST /device/orientation => %d\n", code);
    http.end();
  }
}

// ─────────────────────────────────────────────────────────────────
// IMU 翻转检测
// ─────────────────────────────────────────────────────────────────
Face detectFace() {
  float ax, ay, az;
  M5.IMU.getAccelData(&ax, &ay, &az);

  // Z 轴正值 = 屏幕朝上
  if (az >  TILT_THRESHOLD) return FACE_STUDY;
  // X 轴正值 = 左侧朝上，负值 = 右侧朝上
  if (ax >  TILT_THRESHOLD) return FACE_SPORT;
  if (ax < -TILT_THRESHOLD) return FACE_END;

  return FACE_IDLE;
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
      drawScreen(currentFace);  // 刷新状态栏显示 WS OK
      break;

    case WStype_DISCONNECTED:
      wsConnected = false;
      Serial.println("[WS] Disconnected");
      drawScreen(currentFace);
      break;

    case WStype_TEXT: {
      StaticJsonDocument<256> doc;
      if (deserializeJson(doc, payload, length) == DeserializationError::Ok) {
        const char* msgType = doc["type"];
        if (msgType && strcmp(msgType, "handshake_ack") == 0) {
          Serial.println("[WS] Handshake ACK");
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
  M5.Lcd.fillScreen(TFT_BLACK);
  M5.Lcd.setTextColor(0x888888);
  M5.Lcd.setTextSize(2);
  M5.Lcd.drawCentreString("FLOWCUBE", 160, 70, 2);
  M5.Lcd.setTextSize(1);
  M5.Lcd.drawCentreString("WiFi 连接中...", 160, 130, 1);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    attempts++;
  }

  wifiConnected = (WiFi.status() == WL_CONNECTED);
  if (wifiConnected) {
    Serial.printf("[WiFi] Connected, IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("[WiFi] Failed — running offline");
  }
}

// ─────────────────────────────────────────────────────────────────
// Setup & Loop
// ─────────────────────────────────────────────────────────────────
void setup() {
  M5.begin();
  Serial.begin(115200);
  M5.IMU.Init();
  M5.Lcd.setTextDatum(MC_DATUM);

  // 开机画面
  M5.Lcd.fillScreen(TFT_BLACK);
  M5.Lcd.setTextColor(TFT_BLUE);
  M5.Lcd.setTextSize(3);
  M5.Lcd.drawCentreString("FLOWCUBE", 160, 80, 3);
  M5.Lcd.setTextSize(1);
  M5.Lcd.setTextColor(0x888888);
  M5.Lcd.drawCentreString("心流魔方 v2.0", 160, 140, 1);
  delay(1200);

  connectWiFi();

  if (wifiConnected) {
    wsClient.begin(SERVER_HOST, SERVER_PORT, SERVER_PATH);
    wsClient.onEvent(onWsEvent);
    wsClient.setReconnectInterval(5000);
    Serial.printf("[WS] Connecting to %s:%d%s\n", SERVER_HOST, SERVER_PORT, SERVER_PATH);
  }

  currentFace  = detectFace();
  lastSentFace = FACE_UNKNOWN;
  drawScreen(currentFace);
}

void loop() {
  M5.update();
  uint32_t now = millis();

  // ── WebSocket loop + keepalive ──
  if (wifiConnected) {
    wsClient.loop();
    if (wsConnected && (now - lastPingMs > PING_INTERVAL_MS)) {
      sendPing();
      lastPingMs = now;
    }
  }

  // ── IMU 采样与稳定判断 ──
  if (now - lastImuMs >= POLL_INTERVAL_MS) {
    lastImuMs = now;
    Face raw = detectFace();

    if (raw == currentFace) {
      stableCount = min(stableCount + 1, STABLE_FRAMES);
    } else {
      stableCount = 0;
      currentFace = raw;
    }

    // 连续稳定 STABLE_FRAMES 帧后触发一次事件
    if (stableCount == STABLE_FRAMES && currentFace != lastSentFace) {
      lastSentFace = currentFace;
      Serial.printf("[IMU] Stable face: %s\n", faceActions[currentFace]);
      handleFaceEvent(currentFace);
    }
  }

  delay(10);
}
