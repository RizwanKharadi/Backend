import mongoose from 'mongoose';
import logger from '../utils/logger.js';

/** Drop legacy unique index on company+type+number; sync uses Tally GUID per company. */
export async function migrateVoucherIndexes() {
  if (mongoose.connection.readyState !== 1) return;

  const coll = mongoose.connection.collection('vouchers');
  try {
    const indexes = await coll.indexes();
    for (const idx of indexes) {
      const keys = idx.key || {};
      if (
        idx.unique &&
        keys.company === 1 &&
        keys.voucherType === 1 &&
        keys.voucherNumber === 1
      ) {
        await coll.dropIndex(idx.name);
        logger.info(`Dropped legacy voucher unique index: ${idx.name}`);
      }
    }
  } catch (error) {
    if (error.code !== 27 && error.codeName !== 'IndexNotFound') {
      logger.warn('Legacy voucher index migration skipped', { message: error.message });
    }
  }

  try {
    const Voucher = (await import('../models/Voucher.js')).default;
    await Voucher.syncIndexes();
    logger.info('Voucher indexes synchronized');
  } catch (error) {
    logger.warn('Voucher syncIndexes failed', { message: error.message });
  }
}

export const connectDB = async () => {
  try {
    // Check if we're in development mode without MongoDB
    if (process.env.NODE_ENV === 'development' && process.env.SKIP_MONGODB === 'true') {
      logger.info('Skipping MongoDB connection in development mode');
      return { connected: false, connection: { host: 'localhost (skipped)' } };
    }

    const mongoURI = process.env.NODE_ENV === 'test'
      ? process.env.MONGODB_TEST_URI
      : process.env.MONGODB_URI;

    if (!mongoURI) {
      throw new Error('MongoDB URI is not defined in environment variables');
    }

    const options = {
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 15000, // Allow more time for Atlas server selection
      socketTimeoutMS: Number(process.env.MONGODB_SOCKET_TIMEOUT_MS) || 120000, // Allow long bulkWrite batches
      bufferCommands: false, // Disable mongoose buffering
    };

    const conn = await mongoose.connect(mongoURI, options);

    logger.info(`MongoDB Connected: ${conn.connection.host}`);

    await migrateVoucherIndexes();

    // Connection event listeners
    mongoose.connection.on('connected', () => {
      logger.info('Mongoose connected to MongoDB');
    });

    mongoose.connection.on('error', (err) => {
      logger.error('Mongoose connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('Mongoose disconnected from MongoDB');
    });

    // Handle application termination
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      logger.info('Mongoose connection closed due to application termination');
      process.exit(0);
    });

    return { connected: true, connection: conn.connection };
  } catch (error) {
    logger.error('Database connection failed:', error);

    // In development mode, continue without database
    if (process.env.NODE_ENV === 'development') {
      logger.warn('Continuing in development mode without database...');
      return { connected: false, connection: { host: 'localhost (failed)' } };
    }

    process.exit(1);
  }
};

export const disconnectDB = async () => {
  try {
    await mongoose.connection.close();
    logger.info('Database disconnected successfully');
  } catch (error) {
    logger.error('Error disconnecting from database:', error);
  }
};

