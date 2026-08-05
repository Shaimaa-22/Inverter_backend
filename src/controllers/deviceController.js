const { z } = require('zod');
const deviceService = require('../services/deviceService');
const { writeAuditLog } = require('../utils/audit');

const commandSchema = z.object({ command: z.enum(['ON', 'OFF']) });
const requestIdSchema = z.string().uuid();

async function status(_req, res) {
  const device = await deviceService.getDeviceStatus();
  res.json({ success: true, data: { device } });
}

async function command(req, res) {
  const { command } = commandSchema.parse(req.body);
  const result = await deviceService.sendCommand({ command, userId: req.user.id });
  await writeAuditLog(req, {
    action: `device.command.${command.toLowerCase()}`,
    resource: 'command', resourceId: result.requestId,
    details: { deviceId: 'inverter-01', command }
  });
  res.status(202).json({ success: true, data: result });
}

async function commandStatus(req, res) {
  const requestId = requestIdSchema.parse(req.params.requestId);
  const result = await deviceService.getCommand(requestId, { userId: req.user.id, role: req.user.role });
  res.json({ success: true, data: { command: result } });
}

module.exports = { status, command, commandStatus };
