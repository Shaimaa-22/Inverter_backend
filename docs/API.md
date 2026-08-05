# API summary
All protected requests must include cookies: `fetch(url, { credentials: 'include' })`.

- `POST /api/auth/login` `{ "username": "admin", "password": "..." }`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/device/status`
- `POST /api/device/command` `{ "command": "ON" }`
- `GET /api/device/command/:requestId`
- `GET /api/users` admin
- `POST /api/users` admin
- `PATCH /api/users/:id` admin
- `GET /api/logs/commands?page=1&limit=20`
- `GET /api/logs/audit?page=1&limit=20` admin

## Health

- `GET /api/health/live` — process liveness.
- `GET /api/health/ready` — PostgreSQL and MQTT readiness; returns `503` if a dependency is unavailable.
- `GET /api/health` — backward-compatible liveness endpoint.

## Command access

Operators can read only their own command records. Admins can read all command records.
