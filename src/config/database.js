import { Sequelize } from 'sequelize';
import logger from '../utils/logger.js';
import { defineAllModels } from '../db/defineModels.js';

let sequelize = null;
let models = null;
let sequelizeModels = null;

export function getSequelize() {
  return sequelize;
}

export function getModels() {
  return models;
}

export async function connectDB() {
  try {
    if (process.env.NODE_ENV === 'development' && process.env.SKIP_MYSQL === 'true') {
      logger.info('Skipping MySQL connection in development mode');
      return { connected: false, connection: { host: 'localhost (skipped)' } };
    }

    const isTest = process.env.NODE_ENV === 'test';
    const database =
      (isTest ? process.env.MYSQL_TEST_DATABASE : process.env.MYSQL_DATABASE) ||
      (isTest ? 'finsync360_test' : 'finsync360');
    const host = process.env.MYSQL_HOST || '127.0.0.1';
    const port = Number(process.env.MYSQL_PORT) || 3306;
    const username = process.env.MYSQL_USER || 'finsync';
    const password = process.env.MYSQL_PASSWORD || 'finsyncpass';

    // Support DATABASE_URL style: mysql://user:pass@host:port/db
    const url = process.env.DATABASE_URL || process.env.MYSQL_URL;

    if (url) {
      sequelize = new Sequelize(url, {
        logging: process.env.SQL_LOG === 'true' ? (msg) => logger.debug(msg) : false,
        dialect: 'mysql',
        pool: {
          max: Number(process.env.MYSQL_POOL_MAX) || 10,
          min: 0,
          acquire: 30000,
          idle: 10000,
        },
        define: {
          timestamps: true,
          underscored: false,
        },
      });
    } else {
      sequelize = new Sequelize(database, username, password, {
        host,
        port,
        dialect: 'mysql',
        logging: process.env.SQL_LOG === 'true' ? (msg) => logger.debug(msg) : false,
        pool: {
          max: Number(process.env.MYSQL_POOL_MAX) || 10,
          min: 0,
          acquire: 30000,
          idle: 10000,
        },
        define: {
          timestamps: true,
          underscored: false,
        },
      });
    }

    await sequelize.authenticate();
    logger.info(`MySQL Connected: ${host}:${port}/${database}`);

    const defined = defineAllModels(sequelize);
    models = defined.models;
    sequelizeModels = defined.sequelizeModels;

    // Fresh start: sync schema (alter in dev for easier iteration)
    const syncAlter = process.env.MYSQL_SYNC_ALTER === 'true';
    const syncForce = process.env.MYSQL_SYNC_FORCE === 'true';
    await sequelize.sync({ alter: syncAlter, force: syncForce });
    logger.info('MySQL schema synchronized');

    return { connected: true, connection: { host, port, database }, models };
  } catch (error) {
    logger.error('Database connection failed:', error);

    if (process.env.NODE_ENV === 'development') {
      logger.warn('Continuing in development mode without database...');
      return { connected: false, connection: { host: 'localhost (failed)' } };
    }

    process.exit(1);
  }
}

export async function disconnectDB() {
  try {
    if (sequelize) {
      await sequelize.close();
      logger.info('MySQL disconnected successfully');
    }
  } catch (error) {
    logger.error('Error disconnecting from database:', error);
  }
}

export { sequelize, models, sequelizeModels };
