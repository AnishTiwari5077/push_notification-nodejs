const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const notificationService = require('../notificationservice');
const { authenticate } = require('../middleware/auth');
const { validateNotification, validateDeviceNotification } = require('../middleware/validate');

/* =========================================================
 * RATE LIMITERS
 * ======================================================= */

// Strict limit for sending notifications (prevents spam/abuse)
const sendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,                   // max 50 requests per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again later.' },
});

// Relaxed limit for read-only endpoints
const readLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,  // 5 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again later.' },
});

/* =========================================================
 * PUBLIC ROUTES — no authentication required
 * ======================================================= */

// Root info
router.get('/', (req, res) => {
  res.json({
    service: 'Push Notification Server',
    version: '1.0.0',
    status: 'active',
  });
});

// Health check — used by hosting platforms to verify server is alive
router.get('/health', readLimiter, (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

/* =========================================================
 * PROTECTED ROUTES — authentication required on all below
 * Send header: x-api-key: YOUR_API_KEY
 * ======================================================= */

// Send a test notification to all users
router.post('/send-test', authenticate, sendLimiter, async (req, res) => {
  try {
    const title = req.body?.title || 'Test Notification';
    const body = req.body?.body || 'This is a test from your notification server.';

    const result = await notificationService.sendToAll(title, body, {
      type: 'test',
      source: 'api',
    });

    res.json(result);
  } catch (error) {
    console.error('❌ /send-test error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to send test notification' });
  }
});

// Send notification to ALL users (topic broadcast)
router.post(
  '/send-to-all',
  authenticate,
  sendLimiter,
  validateNotification,
  async (req, res) => {
    try {
      const { title, body, data = {} } = req.body;
      const result = await notificationService.sendToAll(title, body, data);
      res.json(result);
    } catch (error) {
      console.error('❌ /send-to-all error:', error.message);
      res.status(500).json({ success: false, error: 'Failed to send notification' });
    }
  }
);

// Send notification to a SPECIFIC device by FCM token
router.post(
  '/send-to-device',
  authenticate,
  sendLimiter,
  validateNotification,
  validateDeviceNotification,
  async (req, res) => {
    try {
      const { token, title, body, data = {} } = req.body;
      const result = await notificationService.sendToDevice(token, title, body, data);
      res.json(result);
    } catch (error) {
      console.error('❌ /send-to-device error:', error.message);
      res.status(500).json({ success: false, error: 'Failed to send notification to device' });
    }
  }
);

// Manually trigger notification for a specific event by ID
router.post('/send-event/:eventId', authenticate, sendLimiter, async (req, res) => {
  try {
    const { eventId } = req.params;

    if (!eventId || typeof eventId !== 'string' || eventId.length > 128) {
      return res.status(400).json({ success: false, error: 'Invalid eventId' });
    }

    const result = await notificationService.sendEventNotification(eventId);
    res.json(result);
  } catch (error) {
    console.error('❌ /send-event error:', error.message);
    const status = error.message === 'Event not found' ? 404 : 500;
    res.status(status).json({ success: false, error: error.message });
  }
});

// Get notification statistics
router.get('/stats', authenticate, readLimiter, async (req, res) => {
  try {
    const stats = await notificationService.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('❌ /stats error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to retrieve stats' });
  }
});

module.exports = router;