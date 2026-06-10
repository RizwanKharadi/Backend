import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Simple console logger since we can't import the utils logger from scripts
const logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`)
};

const clearTallyCollections = async () => {
  try {
    // Connect to MongoDB
    const mongoURI = process.env.MONGODB_URI;
    if (!mongoURI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    await mongoose.connect(mongoURI);
    logger.info('Connected to MongoDB');

    // Collections to clear
    const collectionsToClear = [
      'companies',
      'items',
      'parties',
      'vouchers',
      'tallyconnections',
      'tallysyncs'
    ];

    // Clear each collection
    for (const collectionName of collectionsToClear) {
      try {
        const collection = mongoose.connection.db.collection(collectionName);
        const count = await collection.countDocuments();
        await collection.deleteMany({});
        logger.info(`Cleared ${count} documents from ${collectionName} collection`);
      } catch (error) {
        logger.warn(`Collection ${collectionName} might not exist or is already empty: ${error.message}`);
      }
    }

    logger.info('All Tally-related collections have been cleared successfully!');

  } catch (error) {
    logger.error('Error clearing collections:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    logger.info('Database connection closed');
  }
};

// Run the script
clearTallyCollections();