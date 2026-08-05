const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const controller = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const router = express.Router();
router.post('/login', asyncHandler(controller.login));
router.post('/logout', authenticate, asyncHandler(controller.logout));
router.get('/me', authenticate, controller.me);
module.exports = router;
