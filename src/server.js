import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import mongoSanitize from 'express-mongo-sanitize';
import xss from 'xss';
import hpp from 'hpp';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import logger from './utils/logger.js';
import errorHandler from './middleware/errorHandler.js';
import createMlProxy from './middleware/mlProxy.js';
import { connectDB } from './config/database.js';
import tallyWebSocketService from './services/tallyWebSocketService.js';
import tallySyncService from './services/tallySyncService.js';
import { swaggerUi, swaggerSpec } from './config/swagger.js';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import companyRoutes from './routes/companies.js';
import voucherRoutes from './routes/vouchers.js';
import transactionRoutes from './routes/transactions.js';
import inventoryRoutes from './routes/inventory.js';
import partyRoutes from './routes/parties.js';
import masterRoutes from './routes/masters.js';
import paymentRoutes from './routes/payments.js';
import tallyRoutes from './routes/tally.js';
import deviceRoutes from './routes/devices.js';
import billingRoutes from './routes/billing.js';
import aiRoutes from './routes/ai.js';
import adminRoutes from './routes/admin.js';
import { protect, checkCompanyAccess } from './middleware/auth.js';
import { requireActiveSubscription } from './middleware/license.js';
import {
  getProfitLossReport,
  getOutstandingReceivable,
  getOutstandingReceivableLedger
} from './controllers/reportController.mjs';

// ES6 module routes will be loaded dynamically
let budgetRoutes, gstRoutes, reportRoutes, notificationRoutes;

// Initialize dotenv
dotenv.config();

const app = express();

// Trust proxy for rate limiting
app.set('trust proxy', 1);

// Security middleware - Configure Helmet to allow Swagger UI
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));
// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = process.env.NODE_ENV === 'production'
      ? [
          'https://finsync-frontend-62084a54426d.herokuapp.com',
          'https://finsync-frontend-nextjs.herokuapp.com',
          'https://your-domain.com',
          process.env.FRONTEND_URL,
          ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : [])
        ].filter(Boolean)
      : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'];

    if (allowedOrigins.includes(origin) || process.env.CORS_ORIGIN === '*') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count']
};

app.use(cors(corsOptions));

// Rate limiting (disabled in development unless RATE_LIMIT_ENFORCE=true)
const isProduction = process.env.NODE_ENV === 'production';
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max:
    parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) ||
    (isProduction ? 100 : 5000),
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !isProduction && process.env.RATE_LIMIT_ENFORCE !== 'true',
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ML microservice (FastAPI) — after body parser; mobile → /api/ml/api/v1/...
app.use('/api/ml', createMlProxy());
app.use('/ml', createMlProxy());

// Data sanitization
app.use(mongoSanitize());
app.use(hpp());

// Compression
app.use(compression());

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl} - ${req.ip}`);
  next();
});

// Swagger API Documentation
// Serve OpenAPI spec as JSON
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Serve Swagger UI
app.use('/api-docs', swaggerUi.serve);
app.get('/api-docs', swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'FinSync360 API Documentation',
  customfavIcon: '/favicon.ico'
}));

// Health check endpoint
/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     security: []
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: OK
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                   example: 12345.67
 *                 environment:
 *                   type: string
 *                   example: development
 */
app.get(['/health', '/api/health'], (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// API routes (CommonJS)
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/parties', partyRoutes);
app.use('/api/masters', masterRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/tally', tallyRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/admin', adminRoutes);

// ES6 module routes (loaded dynamically in startServer)

// Serve uploaded files
app.use('/uploads', express.static('uploads'));

// Connect to database and start server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    const dbResult = await connectDB();
    if (dbResult.connected) {
      tallySyncService.initialize();
    } else {
      logger.warn('Skipping Tally sync service because MongoDB is not connected.');
    }

    // Load ES6 module routes dynamically
    try {
      const budgetModule = await import('./routes/budgets.mjs');
      const gstModule = await import('./routes/gst.mjs');
      const reportModule = await import('./routes/reports.mjs');
      const notificationModule = await import('./routes/notifications.mjs');
      
      budgetRoutes = budgetModule.default;
      gstRoutes = gstModule.default;
      reportRoutes = reportModule.default;
      notificationRoutes = notificationModule.default;
      
      // Mount ES6 module routes
      app.use('/api/budgets', budgetRoutes);
      app.use('/api/gst', gstRoutes);
      app.use('/api/reports', reportRoutes);
      app.use('/api/notifications', notificationRoutes);
      
      logger.info('ES6 module routes loaded successfully');
    } catch (error) {
      logger.error('Error loading ES6 module routes:', error);
      logger.warn('Continuing without ES6 module routes');
    }

    // Fallback / direct route registration in case dynamic report routing fails
    app.get('/api/reports/profit-loss', protect, requireActiveSubscription, checkCompanyAccess, getProfitLossReport);
    app.post('/api/reports/profit-loss', protect, requireActiveSubscription, checkCompanyAccess, getProfitLossReport);
    app.get(
      '/api/reports/outstanding-receivable',
      protect,
      requireActiveSubscription,
      checkCompanyAccess,
      getOutstandingReceivable
    );
    app.get(
      '/api/reports/outstanding-receivable/ledger',
      protect,
      requireActiveSubscription,
      checkCompanyAccess,
      getOutstandingReceivableLedger
    );

    // 404 handler
    app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        message: 'Route not found'
      });
    });

    // Global error handler
    app.use(errorHandler);

    const server = createServer(app);
    const io = new SocketIOServer(server, {
      cors: {
        origin: true,
        methods: ['GET', 'POST'],
        credentials: true
      }
    });

    io.use((socket, next) => {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) {
        return next(new Error('Authentication token missing'));
      }

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.data.user = decoded;
        return next();
      } catch (error) {
        logger.warn('Socket.IO auth failed', { error: error.message });
        return next(new Error('Authentication failed'));
      }
    });

    io.on('connection', (socket) => {
      logger.info('Socket.IO mobile client connected', {
        socketId: socket.id,
        userId: socket.data?.user?.id
      });

      socket.emit('connected', {
        message: 'Socket.IO realtime connection established',
        timestamp: new Date().toISOString()
      });

      socket.onAny((event, ...args) => {
        logger.debug('Socket.IO event received', { event, args, socketId: socket.id });
      });

      socket.on('disconnect', (reason) => {
        logger.info('Socket.IO mobile client disconnected', { socketId: socket.id, reason });
      });
    });

    server.listen(PORT, () => {
      logger.info(`FinSync360 Backend Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
    });

    if (dbResult.connected) {
      tallyWebSocketService.initialize(server, '/tally-agent');
      logger.info('Tally WebSocket service initialized');
    } else {
      logger.warn('Skipping Tally WebSocket service because MongoDB is not connected.');
    }

    // Graceful shutdown
    const gracefulShutdown = () => {
      logger.info('Shutting down gracefully...');

      // Stop Tally sync service
      tallySyncService.stopAllJobs();

      // Close WebSocket connections
      tallyWebSocketService.shutdown();
      io.close();

      server.close(() => {
        logger.info('HTTP server closed');
        mongoose.connection.close(() => {
          logger.info('Database connection closed');
          process.exit(0);
        });
      });
    };

    process.on('SIGTERM', () => {
      logger.info('SIGTERM received');
      gracefulShutdown();
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received');
      gracefulShutdown();
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      gracefulShutdown();
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      gracefulShutdown();
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;
