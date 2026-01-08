require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initializeFirebase } = require('./firebase');
const notificationService = require('./notificationservice');
const notificationRoutes = require('./routes/notificationRoutes');

class NotificationServer {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    // Enable CORS
    this.app.use(cors());
    
    // Parse JSON bodies
    this.app.use(express.json());
    
    // Parse URL-encoded bodies
    this.app.use(express.urlencoded({ extended: true }));
  }

  setupRoutes() {
    // API Routes
    this.app.use('/api', notificationRoutes);
    
    // 404 Handler
    this.app.use((req, res) => {
      res.status(404).json({
        success: false,
        error: 'Route not found',
      });
    });
    
    // Error handler
    this.app.use((err, req, res, next) => {
      console.error('Server error:', err);
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined,
      });
    });
  }

  async start() {
    try {
      // Initialize Firebase
      initializeFirebase();
      
      // Start notification services
      notificationService.startEventListener();
      notificationService.scheduleDailyReminders();
      
      // Start server
      this.server = this.app.listen(this.port, () => {
        console.log(`🚀 Push Notification Server running on port ${this.port}`);
        console.log(`📡 API available at http://localhost:${this.port}/api`);
        console.log(`🏥 Health check: http://localhost:${this.port}/api/health`);
      });
      
      // Handle graceful shutdown
      this.setupGracefulShutdown();
      
    } catch (error) {
      console.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }

  setupGracefulShutdown() {
    const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    
    signals.forEach(signal => {
      process.on(signal, () => {
        console.log(`\n${signal} received, shutting down gracefully...`);
        
        if (this.server) {
          this.server.close(() => {
            console.log('✅ HTTP server closed');
            process.exit(0);
          });
        } else {
          process.exit(0);
        }
        
        // Force shutdown after 10 seconds
        setTimeout(() => {
          console.log('⚠️  Force shutdown after timeout');
          process.exit(1);
        }, 10000);
      });
    });
  }
}

// Start server if this file is run directly
if (require.main === module) {
  const server = new NotificationServer();
  server.start();
}

module.exports = NotificationServer;