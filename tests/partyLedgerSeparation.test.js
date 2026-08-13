/**
 * `parties` holds the people we trade with — sundry debtors and creditors.
 * Every other Tally ledger (bank, cash, duty, expense) belongs in
 * `tallyaccounts`, which already stores the whole chart of accounts.
 *
 * The agent sends the full ledger list down the party channel, so the split is
 * enforced here. Without it a company with 8,326 ledgers and 6,960 debtors ended
 * up with all 8,326 in `parties`, duplicating rows that `tallyaccounts` already
 * had and making "total customers" mean two different things depending on which
 * query you asked.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { default: service } = await import('../src/services/tallyWebSocketService.js');

const company = { _id: 'company-1', createdBy: 'user-1' };
const build = (party) => service.buildPartyBulkOp(company, party);

describe('buildPartyBulkOp', () => {
  it('stores a sundry debtor', () => {
    const op = build({ name: 'Sharma Traders', recordType: 'party', tallyParent: 'Sundry Debtors' });

    expect(op).not.toBeNull();
    expect(op.updateOne.update.$set).toMatchObject({
      name: 'Sharma Traders',
      recordType: 'party',
    });
  });

  it('skips a ledger that is not a trading party', () => {
    expect(build({ name: 'HDFC Bank', recordType: 'ledger', tallyParent: 'Bank Accounts' })).toBeNull();
    expect(build({ name: 'Office Rent', recordType: 'ledger', tallyParent: 'Indirect Expenses' })).toBeNull();
    expect(build({ name: 'CGST', recordType: 'ledger', tallyParent: 'Duties & Taxes' })).toBeNull();
  });

  it('treats a row with no recordType as a party, as older agents send', () => {
    const op = build({ name: 'Legacy Party', tallyParent: 'Sundry Debtors' });

    expect(op).not.toBeNull();
    expect(op.updateOne.update.$set.recordType).toBe('party');
  });

  it('gives a nameless row a placeholder name rather than dropping it', () => {
    // Long-standing behaviour, and unreachable from the agent: its mapper
    // already discards ledgers with no name before they are sent.
    expect(build({ recordType: 'party' }).updateOne.update.$set.name).toBe('Unnamed Party');
  });

  it('keys the upsert on the Tally id when there is one', () => {
    const op = build({ name: 'Sharma Traders', recordType: 'party', guid: 'guid-123' });

    expect(op.updateOne.filter).toMatchObject({ 'tallySync.tallyId': 'guid-123' });
    expect(op.updateOne.upsert).toBe(true);
  });

  it('falls back to the name when Tally sent no id', () => {
    const op = build({ name: 'Sharma Traders', recordType: 'party' });

    expect(op.updateOne.filter).toMatchObject({
      company: company._id,
      name: 'Sharma Traders',
      recordType: 'party',
    });
  });
});
