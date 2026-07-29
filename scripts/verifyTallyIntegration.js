/**
 * Lightweight Tally integration smoke checks against MySQL models.
 */
import dotenv from 'dotenv';
dotenv.config();
import { newId } from '../src/db/queryUtils.js';
import { connectDB, disconnectDB, getModels } from '../src/config/database.js';

async function main() {
  await connectDB();
  const { TallySync, TallyConnection, Company } = getModels();
  const companyId = newId();
  const userId = newId();

  await Company.create({
    id: companyId,
    name: 'Verify Co',
    createdBy: userId,
  });

  const sync = await TallySync.create({
    company: companyId,
    entityType: 'voucher',
    entityId: newId(),
    tallyId: 'T-1',
    syncStatus: 'pending',
    createdBy: userId,
  });

  const conn = await TallyConnection.create({
    company: companyId,
    agentId: `agent-${Date.now()}`,
    status: 'connected',
    createdBy: userId,
  });

  console.log('TallySync id', sync.id);
  console.log('TallyConnection id', conn.id);
  await TallySync.deleteMany({ company: companyId });
  await TallyConnection.deleteMany({ company: companyId });
  await Company.deleteMany({ id: companyId });
  await disconnectDB();
  console.log('TALLY INTEGRATION VERIFY OK');
}

main().catch(async (e) => {
  console.error(e);
  try { await disconnectDB(); } catch (_) {}
  process.exit(1);
});
