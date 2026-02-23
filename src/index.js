require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { initializeFirebase } = require('./firebase');
const notificationService = require('./notificationservice');
const notificationRoutes = require('./routes/notificationRoutes');

class NotificationServer {
  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT, 10) || 3000;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // Trust reverse proxy (Railway, Render, Fly.io, nginx)
    // Required so req.ip returns real client IP, not proxy IP
    if (process.env.TRUST_PROXY === 'true') {
      this.app.set('trust proxy', 1);
    }

    // Security headers (X-Content-Type-Options, X-Frame-Options, etc.)
    this.app.use(helmet());

    // CORS configuration
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
      : [];

    this.app.use(
      cors({
        origin: (origin, callback) => {
          // Allow requests with no origin (mobile apps, Postman, curl)
          if (!origin) return callback(null, true);
          // Allow all in development
          if (process.env.NODE_ENV !== 'production') return callback(null, true);
          // In production, check whitelist
          if (allowedOrigins.includes(origin)) return callback(null, true);
          callback(new Error(`CORS: Origin "${origin}" is not allowed`));
        },
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type', 'x-api-key'],
      })
    );

    // HTTP request logging
    this.app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

    // Body parsers with size limits (prevents large payload attacks)
    this.app.use(express.json({ limit: '16kb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '16kb' }));
  }

  setupRoutes() {
    this.app.use('/api', notificationRoutes);

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({ success: false, error: 'Route not found' });
    });

    // Global error handler — never exposes stack traces in production
    // eslint-disable-next-line no-unused-vars
    this.app.use((err, req, res, next) => {
      console.error('❌ Unhandled server error:', err.message);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        ...(process.env.NODE_ENV !== 'production' && { message: err.message }),
      });
    });
  }

  validateEnvironment() {
    const errors = [];
    const warnings = [];

    if (!process.env.API_KEY) {
      if (process.env.NODE_ENV === 'production') {
        errors.push('API_KEY is required in production');
      } else {
        warnings.push('API_KEY not set — all routes are unauthenticated (development only)');
      }
    } else if (process.env.API_KEY.length < 32) {
      warnings.push('API_KEY is too short — use at least 32 characters for security');
    }

    if (!process.env.FIREBASE_CREDENTIALS && process.env.NODE_ENV === 'production') {
      errors.push('FIREBASE_CREDENTIALS is required in production');
    }

    if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
      warnings.push('ALLOWED_ORIGINS not set — all CORS origins are blocked in production');
    }

    warnings.forEach((w) => console.warn(`⚠️  WARNING: ${w}`));

    if (errors.length > 0) {
      errors.forEach((e) => console.error(`❌ ENV ERROR: ${e}`));
      throw new Error('Missing required environment variables. Server cannot start.');
    }
  }

  async start() {
    try {
      // Validate env vars before starting anything
      this.validateEnvironment();

      // Initialize Firebase
      initializeFirebase();

      // Start background services
      notificationService.startEventListener();
      notificationService.scheduleDailyReminders();

      // Start HTTP server
      this.server = this.app.listen(this.port, () => {
        console.log('');
        console.log('🚀 Push Notification Server started');
        console.log(`📡 Port:        ${this.port}`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🏥 Health:      http://localhost:${this.port}/api/health`);
        console.log(`📊 Stats:       http://localhost:${this.port}/api/stats`);
        console.log('');
      });

      this.setupGracefulShutdown();
    } catch (error) {
      console.error('❌ Failed to start server:', error.message);
      process.exit(1);
    }
  }

  setupGracefulShutdown() {
    const shutdown = (signal) => {
      console.log(`\n${signal} received — shutting down gracefully...`);
      if (this.server) {
        this.server.close(() => {
          console.log('✅ Server closed');
          process.exit(0);
        });
      } else {
        process.exit(0);
      }
      // Force kill after 10 seconds if something hangs
      setTimeout(() => {
        console.error('⚠️  Forced shutdown after timeout');
        process.exit(1);
      }, 10_000);
    };

    ['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach((sig) =>
      process.on(sig, () => shutdown(sig))
    );

    // Catch unhandled errors so server doesn't crash silently
    process.on('unhandledRejection', (reason) => {
      console.error('❌ Unhandled Promise Rejection:', reason);
    });

    process.on('uncaughtException', (err) => {
      console.error('❌ Uncaught Exception:', err.message);
      process.exit(1);
    });
  }
}

// Start the server
const server = new NotificationServer();
server.start();

module.exports = NotificationServer;