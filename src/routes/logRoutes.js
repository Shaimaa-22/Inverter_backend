const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const controller = require('../controllers/logController');
const { authenticate, authorize } = require('../middleware/auth');
const router = express.Router();
router.use(authenticate);
router.get('/commands', asyncHandler(controller.commands));
router.get('/audit', authorize('admin'), asyncHandler(controller.audit));
module.exports = router;
