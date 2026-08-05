/*
  ESP32 reference firmware for HiveMQ Cloud Serverless over TLS.

  Electrical safety:
  - The ESP32 relay must drive an isolated control circuit / interposing relay,
    not the inverter mains supply directly.
  - Use an emergency stop, inverter interlocks, protection devices, and a
    qualified electrician.
  - The boot state is OFF and MQTT command messages must never be retained.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>

// ---------------- Wi-Fi ----------------
const char* WIFI_SSID = "CHANGE_ME";
const char* WIFI_PASSWORD = "CHANGE_ME";

// ---------------- HiveMQ Cloud ----------------
// Copy the exact cluster hostname from HiveMQ Cloud. Do not use an IP address.
const char* MQTT_HOST = "YOUR-CLUSTER.s1.eu.hivemq.cloud";
const uint16_t MQTT_PORT = 8883;
const char* MQTT_USER = "esp32_user";
const char* MQTT_PASSWORD = "CHANGE_ME";

// Paste the root CA used by your HiveMQ Cloud endpoint here.
// Keep the BEGIN/END lines. Do not use secureClient.setInsecure() in production.
static const char HIVEMQ_ROOT_CA[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
PASTE_HIVEMQ_ROOT_CA_CERTIFICATE_HERE
-----END CERTIFICATE-----
)EOF";

// ---------------- Device ----------------
const char* DEVICE_ID = "inverter-01";
const char* COMMAND_TOPIC = "company/inverter-01/command";
const char* ACK_TOPIC = "company/inverter-01/ack";
const char* STATUS_TOPIC = "company/inverter-01/status";
const char* HEARTBEAT_TOPIC = "company/inverter-01/heartbeat";
const char* AVAILABILITY_TOPIC = "company/inverter-01/availability";

const int RELAY_PIN = 26;
const bool RELAY_ACTIVE_HIGH = true;
// Configure only after wiring a correctly isolated physical run/fault feedback input.
const int INVERTER_FEEDBACK_PIN = -1;
const bool INVERTER_FEEDBACK_ACTIVE_HIGH = true;
const unsigned long FEEDBACK_VERIFY_TIMEOUT_MS = 3000;
// Set true only if the electrical design requires relay OFF after prolonged MQTT loss.
const bool FAIL_SAFE_ON_MQTT_LOSS = false;
const unsigned long MQTT_FAIL_SAFE_TIMEOUT_MS = 30000;
const unsigned long HEARTBEAT_INTERVAL_MS = 10000;
const unsigned long WIFI_RETRY_MS = 10000;
const unsigned long MQTT_RETRY_MS = 5000;

WiFiClientSecure secureClient;
PubSubClient mqtt(secureClient);

unsigned long lastHeartbeat = 0;
unsigned long lastWifiAttempt = 0;
unsigned long lastMqttAttempt = 0;
unsigned long mqttDisconnectedSince = 0;
bool clockSynced = false;
bool relayOn = false;
String lastRequestId;

void setRelay(bool on) {
  relayOn = on;
  digitalWrite(RELAY_PIN, RELAY_ACTIVE_HIGH ? HIGH : LOW);
  if (!on) digitalWrite(RELAY_PIN, RELAY_ACTIVE_HIGH ? LOW : HIGH);
}

bool publishJson(const char* topic, JsonDocument& doc, bool retained = false) {
  char buffer[768];
  const size_t length = serializeJson(doc, buffer, sizeof(buffer));
  if (length == 0 || length >= sizeof(buffer)) return false;
  return mqtt.publish(topic, reinterpret_cast<const uint8_t*>(buffer), length, retained);
}

void publishAvailability(const char* status) {
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["status"] = status;
  publishJson(AVAILABILITY_TOPIC, doc, true);
}

const char* inverterState() {
  if (INVERTER_FEEDBACK_PIN < 0) return "UNKNOWN";
  const bool active = digitalRead(INVERTER_FEEDBACK_PIN) == (INVERTER_FEEDBACK_ACTIVE_HIGH ? HIGH : LOW);
  return active ? "RUNNING" : "STOPPED";
}

bool inverterFeedbackMatches(bool expectedOn) {
  if (INVERTER_FEEDBACK_PIN < 0) return true;
  const unsigned long startedAt = millis();
  while (millis() - startedAt < FEEDBACK_VERIFY_TIMEOUT_MS) {
    const bool active = digitalRead(INVERTER_FEEDBACK_PIN) == (INVERTER_FEEDBACK_ACTIVE_HIGH ? HIGH : LOW);
    if (active == expectedOn) return true;
    delay(25);
  }
  return false;
}

void publishStatus() {
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["relayState"] = relayOn ? "ON" : "OFF";
  doc["inverterState"] = inverterState();
  doc["wifiRssi"] = WiFi.RSSI();
  doc["uptime"] = millis() / 1000;
  doc["firmwareVersion"] = "1.2.0";
  publishJson(STATUS_TOPIC, doc, true);
}

void acknowledge(const char* requestId, const char* command, bool success, const char* error = nullptr) {
  JsonDocument doc;
  doc["requestId"] = requestId;
  doc["deviceId"] = DEVICE_ID;
  doc["command"] = command;
  doc["result"] = success ? "success" : "failed";
  doc["relayState"] = relayOn ? "ON" : "OFF";
  doc["inverterState"] = inverterState();
  if (error != nullptr) doc["error"] = error;
  publishJson(ACK_TOPIC, doc, false);
}

void onMessage(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, COMMAND_TOPIC) != 0 || length == 0 || length > 700) return;

  JsonDocument doc;
  const DeserializationError parseError = deserializeJson(doc, payload, length);
  if (parseError) return;

  const char* requestId = doc["requestId"] | "";
  const char* deviceId = doc["deviceId"] | "";
  const char* command = doc["command"] | "";

  if (strcmp(deviceId, DEVICE_ID) != 0 || strlen(requestId) == 0) return;

  // MQTT QoS 1 may redeliver a command. ON/OFF are idempotent, and this also
  // avoids executing the same request twice after a reconnect.
  if (lastRequestId == requestId) {
    acknowledge(requestId, command, true);
    return;
  }

  if (strcmp(command, "ON") == 0) {
    setRelay(true);
  } else if (strcmp(command, "OFF") == 0) {
    setRelay(false);
  } else {
    acknowledge(requestId, command, false, "Unsupported command");
    return;
  }

  const bool expectedOn = strcmp(command, "ON") == 0;
  const bool verified = inverterFeedbackMatches(expectedOn);
  lastRequestId = requestId;
  acknowledge(requestId, command, verified, verified ? nullptr : "Inverter feedback did not reach the expected state");
  publishStatus();
}

void startWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void syncClockForTls() {
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com", "time.google.com");
  time_t now = time(nullptr);
  unsigned long startedAt = millis();

  while (now < 1700000000 && millis() - startedAt < 30000) {
    delay(500);
    now = time(nullptr);
  }
}

bool connectMqttOnce() {
  String clientId = String("esp32-") + DEVICE_ID + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  const char* willPayload = "{\"deviceId\":\"inverter-01\",\"status\":\"offline\"}";

  const bool ok = mqtt.connect(
    clientId.c_str(),
    MQTT_USER,
    MQTT_PASSWORD,
    AVAILABILITY_TOPIC,
    1,
    true,
    willPayload
  );

  if (!ok) return false;

  mqtt.subscribe(COMMAND_TOPIC, 1);
  publishAvailability("online");
  publishStatus();
  return true;
}

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  if (INVERTER_FEEDBACK_PIN >= 0) pinMode(INVERTER_FEEDBACK_PIN, INPUT);
  setRelay(false); // Fail-safe boot state.

  startWifi();

  secureClient.setCACert(HIVEMQ_ROOT_CA);
  secureClient.setHandshakeTimeout(20);

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMessage);
  mqtt.setBufferSize(1024);
  mqtt.setKeepAlive(30);
  mqtt.setSocketTimeout(15);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    clockSynced = false;
    if (millis() - lastWifiAttempt >= WIFI_RETRY_MS) {
      lastWifiAttempt = millis();
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
    delay(10);
    return;
  }

  if (!clockSynced) {
    syncClockForTls();
    clockSynced = true;
  }

  if (!mqtt.connected()) {
    if (mqttDisconnectedSince == 0) mqttDisconnectedSince = millis();
    if (FAIL_SAFE_ON_MQTT_LOSS && millis() - mqttDisconnectedSince >= MQTT_FAIL_SAFE_TIMEOUT_MS) setRelay(false);
    if (millis() - lastMqttAttempt >= MQTT_RETRY_MS) {
      lastMqttAttempt = millis();
      if (connectMqttOnce()) mqttDisconnectedSince = 0;
    }
    delay(10);
    return;
  }

  mqttDisconnectedSince = 0;
  mqtt.loop();

  if (millis() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeat = millis();
    JsonDocument doc;
    doc["deviceId"] = DEVICE_ID;
    doc["wifiRssi"] = WiFi.RSSI();
    doc["uptime"] = millis() / 1000;
    doc["firmwareVersion"] = "1.2.0";
    publishJson(HEARTBEAT_TOPIC, doc, false);
  }
}
