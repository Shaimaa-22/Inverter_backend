# Inverter Control Backend

Production-oriented backend for controlling one ESP32-connected inverter using:

- Fly.io Machine for the always-running Node.js service
- Neon PostgreSQL over TLS
- HiveMQ Cloud Serverless over MQTT TLS
- Express, JWT HttpOnly cookies, role-based access, audit logs
- MQTT command acknowledgment, heartbeat monitoring, and timeout handling

## Safety boundary

This software must not be the only safety layer. Use a physical emergency stop, correct contactor/relay isolation, inverter interlocks, electrical protection, and preferably a real run/fault feedback signal. The ESP32 firmware boots with the relay OFF. MQTT command messages are published with `retain=false`.

## Architecture

```text
Browser -> HTTPS/Fly Proxy -> Node.js/Express on Fly.io
                             |-> Neon PostgreSQL (TLS)
                             |-> HiveMQ Cloud (MQTTS 8883)
                                      |-> ESP32 -> isolated relay -> inverter input
```

## Local setup

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run admin:create
npm run dev
```

For local PostgreSQL, temporarily change `DATABASE_URL`, `DATABASE_SSL=false`, `NODE_ENV=development`, `COOKIE_SECURE=false`, and `TRUST_PROXY=0`.

## Production environment

Use the values in `.env.example`. Important production values:

```env
NODE_ENV=production
TRUST_PROXY=1
DATABASE_SSL=true
COOKIE_SECURE=true
MQTT_URL=mqtts://YOUR-CLUSTER.s1.eu.hivemq.cloud:8883
MQTT_REJECT_UNAUTHORIZED=true
```

Do not put MQTT credentials in frontend JavaScript. Create separate HiveMQ credentials for the backend and ESP32.

## HiveMQ permissions

Backend credential:

```text
Publish:   company/inverter-01/command
Subscribe: company/inverter-01/ack
           company/inverter-01/status
           company/inverter-01/heartbeat
           company/inverter-01/availability
```

ESP32 credential:

```text
Subscribe: company/inverter-01/command
Publish:   company/inverter-01/ack
           company/inverter-01/status
           company/inverter-01/heartbeat
           company/inverter-01/availability
```

## Oracle Cloud Ubuntu deployment

1. Create an Ubuntu VM and assign a reserved public IP.
2. In the Oracle VCN security list/NSG, allow inbound TCP 22, 80, and 443 only.
3. Run:

```bash
sudo bash deploy/scripts/oracle-ubuntu-setup.sh
```

4. Upload or clone the project, then:

```bash
cd inverter-control-backend
cp .env.example .env
nano .env
npm ci --omit=dev
npm run db:migrate
npm run admin:create
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup`, then run `pm2 save` again.

5. Replace the domain in `deploy/nginx/inverter-control.conf`, copy it, and enable it:

```bash
sudo cp deploy/nginx/inverter-control.conf /etc/nginx/sites-available/inverter-control
sudo ln -s /etc/nginx/sites-available/inverter-control /etc/nginx/sites-enabled/inverter-control
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
```

6. Before enabling the HTTPS server block, issue the certificate for the real domain:

```bash
sudo certbot --nginx -d control.example.com
sudo systemctl reload nginx
```

The Node.js port 3000 should not be opened in Oracle Cloud or UFW. Nginx reaches it through `127.0.0.1`.

## Neon notes

Use the pooled Neon connection string and retain `?sslmode=require`. This project additionally uses `DATABASE_SSL=true`. The default pool size is intentionally small (`DATABASE_POOL_MAX=5`) for the free tier.

## ESP32 TLS

Open `esp32/esp32_mqtt_inverter.ino` and set:

- Wi-Fi credentials
- exact HiveMQ hostname
- `esp32_user` credentials
- the root CA certificate used by the HiveMQ endpoint

The firmware synchronizes time with NTP before TLS and does not use `setInsecure()`.

## Command lifecycle

1. Authorized user posts `ON` or `OFF`.
2. API writes a `pending` command.
3. Backend publishes to HiveMQ using QoS 1 and `retain=false`.
4. Command becomes `sent`.
5. ESP32 applies the relay state and publishes an ACK with the same UUID.
6. Backend marks it `confirmed` or `failed`.
7. Without an ACK before `COMMAND_TIMEOUT_MS`, it becomes `timeout`.

## Frontend polling example

```js
const create = await fetch('/api/device/command', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ command: 'ON' })
}).then((response) => response.json());

const requestId = create.data.requestId;
const timer = setInterval(async () => {
  const result = await fetch(`/api/device/command/${requestId}`, {
    credentials: 'include'
  }).then((response) => response.json());

  const status = result.data.command.status;
  if (['confirmed', 'failed', 'timeout'].includes(status)) {
    clearInterval(timer);
  }
}, 1000);
```

---

## Fly.io deployment (recommended for this package)

This archive includes a production `Dockerfile`, `.dockerignore`, and `fly.toml`.
The HTTP service listens on `0.0.0.0:3000`, exposes `/api/health`, and disables Fly autostop so the MQTT connection remains active.

### 1. Create the Fly app

From the project folder:

```bash
fly auth login
fly launch --no-deploy
```

If Fly asks whether to overwrite `fly.toml`, choose **No**. If the app name is already taken, change the first line in `fly.toml` to the unique name Fly assigns.

### 2. Add secrets

Never commit `.env`. Set production secrets in Fly:

```bash
fly secrets set \
  DATABASE_URL='YOUR_NEON_POOLED_URL' \
  JWT_SECRET='YOUR_RANDOM_64_PLUS_CHARACTER_SECRET' \
  FRONTEND_ORIGIN='https://your-frontend.vercel.app' \
  MQTT_URL='mqtts://YOUR-CLUSTER.s1.eu.hivemq.cloud:8883' \
  MQTT_USERNAME='backend_user' \
  MQTT_PASSWORD='YOUR_MQTT_PASSWORD' \
  DEVICE_ID='inverter-01' \
  MQTT_COMMAND_TOPIC='company/inverter-01/command' \
  MQTT_ACK_TOPIC='company/inverter-01/ack' \
  MQTT_STATUS_TOPIC='company/inverter-01/status' \
  MQTT_HEARTBEAT_TOPIC='company/inverter-01/heartbeat' \
  MQTT_LWT_TOPIC='company/inverter-01/availability'
```

### 3. Deploy

```bash
fly deploy
```

The release command runs `npm run db:migrate` before the new machine starts.

### 4. Keep exactly one Machine

For this single-device MQTT controller, keep one backend Machine unless you intentionally design multi-instance coordination:

```bash
fly scale count 1
```

The MQTT client ID automatically includes `FLY_MACHINE_ID`, preventing client-ID collisions during rolling deployments.

### 5. Create the first admin

Run the interactive command inside the deployed Machine:

```bash
fly ssh console -C "npm run admin:create"
```

### 6. Verify

```bash
fly status
fly logs
```

Open:

```text
https://YOUR-FLY-APP.fly.dev/api/health
```

Expected result:

```json
{"success":true,"data":{"status":"ok","timestamp":"..."}}
```

### GitHub dashboard deployment

You can also select this repository from the Fly dashboard. Fly will detect the included `Dockerfile` and `fly.toml`. Add all secret values in the app Secrets section before the first successful startup. After deployment, confirm that only one Machine is running and that autostop remains disabled.

## Reliability and security hardening in this revision

- Command timeout starts only after `pending -> sent`, eliminating the fast-ACK race.
- ACKs must match the configured device ID, request ID, and stored command before confirmation/failure is recorded.
- In-flight commands are recovered as `timeout` at backend startup so stale rows cannot permanently block new commands.
- JWTs include a per-user `session_version`; logout increments it and invalidates the current token server-side.
- Unsafe cookie-authenticated requests require the configured frontend `Origin`/`Referer`.
- `/api/health/live` is liveness; `/api/health/ready` checks PostgreSQL and MQTT.
- Database migrations are versioned under `database/migrations` and run with `npm run db:migrate`.
- `npm test` includes command-state transition tests.
- `npm run admin:create` creates only; `npm run admin:reset` is the explicit password reset command.

## ESP32 feedback and MQTT-loss behavior

`INVERTER_FEEDBACK_PIN` is disabled by default (`-1`). Configure it only after connecting a correctly isolated physical inverter run/fault feedback signal. Until then, `inverterState` is `UNKNOWN`; relay state is not treated as proof that the inverter is running.

`FAIL_SAFE_ON_MQTT_LOSS` defaults to `false` because the correct fail-safe behavior depends on the electrical control design. Enable it only after verifying that relay OFF after prolonged MQTT loss is appropriate.
