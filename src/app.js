const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const authRoutes = require('./routes/authRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const userRoutes = require('./routes/userRoutes');
const logRoutes = require('./routes/logRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { requireSameOrigin } = require('./middleware/csrf');
const db = require('./config/db');
const mqttService = require('./services/mqttService');

const app = express();
if (env.trustProxy) app.set('trust proxy', env.trustProxy);
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: env.frontendOrigin, credentials: true, methods: ['GET', 'POST', 'PATCH', 'OPTIONS'] }));
app.use(express.json({ limit: '50kb' }));
app.use(cookieParser());
app.use(requireSameOrigin);
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true }));

app.get('/api/health/live', (_req, res) => res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } }));
app.get('/api/health/ready', async (_req, res, next) => {
  try {
    await db.query('SELECT 1');
    if (!mqttService.isMqttReady()) return res.status(503).json({ success: false, data: { status: 'not_ready', checks: { database: 'ok', mqtt: 'down' } } });
    res.json({ success: true, data: { status: 'ready', checks: { database: 'ok', mqtt: 'ok' } } });
  } catch (error) { next(error); }
});
app.get('/api/health', (_req, res) => res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } }));
app.use('/api/auth', authRoutes);
app.use('/api/device', deviceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/logs', logRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
