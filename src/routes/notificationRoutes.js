const express = require('express');
const router = express.Router();
const notificationService = require('../notificationservice');

// Health check
router.get('/', (req, res) => {
  res.json({
    status: 'active',
    service: 'Push Notification Server',
    version: '1.0.0',
    endpoints: [
      'GET  /health',
      'POST /send-test',
      'POST /send-to-all',
      'POST /send-to-device',
      'GET  /stats',
    ]
  });
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Send test notification
router.post('/send-test', async (req, res) => {
  try {
    const { title = 'Test Notification', body = 'This is a test notification' } = req.body;
    
    const result = await notificationService.sendToAll(title, body, {
      type: 'test',
      source: 'api',
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Send notification to all users
router.post('/send-to-all', async (req, res) => {
  try {
    const { title, body, data = {} } = req.body;
    
    if (!title || !body) {
      return res.status(400).json({
        success: false,
        error: 'Title and body are required',
      });
    }

    const result = await notificationService.sendToAll(title, body, data);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Send notification to specific device
router.post('/send-to-device', async (req, res) => {
  try {
    const { token, title, body, data = {} } = req.body;
    
    if (!token || !title || !body) {
      return res.status(400).json({
        success: false,
        error: 'Token, title, and body are required',
      });
    }

    const result = await notificationService.sendToDevice(token, title, body, data);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get notification statistics
router.get('/stats', async (req, res) => {
  try {
    const stats = await notificationService.getStats();
    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;