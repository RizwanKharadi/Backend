/**
 * Jest/test setup — connects to MySQL test database.
 */
import dotenv from 'dotenv';
dotenv.config();

process.env.NODE_ENV = 'test';
process.env.MYSQL_DATABASE = process.env.MYSQL_TEST_DATABASE || 'finsync360_test';

import { connectDB, disconnectDB } from '../src/config/database.js';

beforeAll(async () => {
  await connectDB();
}, 60000);

afterAll(async () => {
  await disconnectDB();
});
