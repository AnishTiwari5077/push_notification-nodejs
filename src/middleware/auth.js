const crypto = require('crypto');

/**
 * API Key Authentication Middleware
 * All protected routes require the header: x-api-key: YOUR_API_KEY
 */
const authenticate = (req, res, next) => {
  // In development with no API_KEY set, skip auth with a warning
  if (!process.env.API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ FATAL: API_KEY is not set in production!');
      return res.status(500).json({ error: 'Server misconfiguration' });
    }
    console.warn('⚠️  WARNING: API_KEY not set — authentication is disabled (development only)');
    return next();
  }

  const providedKey = req.headers['x-api-key'];

  if (!providedKey) {
    return res.status(401).json({
      success: false,
      error: 'Missing x-api-key header',
    });
  }

  // Constant-time comparison prevents timing attacks
  const expectedBuffer = Buffer.from(process.env.API_KEY);
  const providedBuffer = Buffer.from(providedKey);

  const keysMatch =
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer);

  if (!keysMatch) {
    console.warn(`⚠️  Unauthorized request from IP: ${req.ip}`);
    return res.status(401).json({
      success: false,
      error: 'Invalid API key',
    });
  }

  next();
};

module.exports = { authenticate };