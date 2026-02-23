/**
 * Input Validation Middleware
 * Validates and sanitizes all request bodies before they reach handlers.
 */

const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 1000;
const MAX_DATA_KEYS = 20;
const MAX_DATA_VALUE_LENGTH = 500;

/**
 * Validates the data object sent with notifications.
 * FCM only accepts string, number, or boolean values.
 */
function validateDataObject(data) {
  if (typeof data !== 'object' || Array.isArray(data) || data === null) {
    return 'data must be a plain object';
  }

  const keys = Object.keys(data);

  if (keys.length > MAX_DATA_KEYS) {
    return `data must not have more than ${MAX_DATA_KEYS} keys`;
  }

  for (const key of keys) {
    if (typeof key !== 'string' || key.length > 100) {
      return 'All data keys must be strings under 100 characters';
    }
    const val = data[key];
    const valType = typeof val;
    if (!['string', 'number', 'boolean'].includes(valType)) {
      return `data values must be string, number, or boolean (got "${valType}" for key "${key}")`;
    }
    if (String(val).length > MAX_DATA_VALUE_LENGTH) {
      return `data value for "${key}" exceeds ${MAX_DATA_VALUE_LENGTH} characters`;
    }
  }

  return null; // no error
}

/**
 * Validates title and body fields on all notification requests
 */
const validateNotification = (req, res, next) => {
  const { title, body, data = {} } = req.body;

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'title is required and must be a non-empty string',
    });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return res.status(400).json({
      success: false,
      error: `title must not exceed ${MAX_TITLE_LENGTH} characters`,
    });
  }

  if (!body || typeof body !== 'string' || body.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'body is required and must be a non-empty string',
    });
  }
  if (body.length > MAX_BODY_LENGTH) {
    return res.status(400).json({
      success: false,
      error: `body must not exceed ${MAX_BODY_LENGTH} characters`,
    });
  }

  const dataError = validateDataObject(data);
  if (dataError) {
    return res.status(400).json({ success: false, error: dataError });
  }

  // Sanitize
  req.body.title = title.trim();
  req.body.body = body.trim();

  next();
};

/**
 * Validates device token on send-to-device requests
 */
const validateDeviceNotification = (req, res, next) => {
  const { token } = req.body;

  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'token is required and must be a non-empty string',
    });
  }
  if (token.length > 500) {
    return res.status(400).json({
      success: false,
      error: 'token is too long',
    });
  }

  req.body.token = token.trim();
  next();
};

module.exports = { validateNotification, validateDeviceNotification };