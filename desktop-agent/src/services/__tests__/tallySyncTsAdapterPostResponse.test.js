/**
 * Regression cover for the master-import confirmation bug.
 *
 * tally-sync-ts's parsePostResponse collapses Tally's <IMPORTRESULT> to
 * `{ status, message, masterId: LASTVCHID }`. Ledger and stock-item imports
 * carry no LASTVCHID, no GUID, and alteredId is never populated — the wording
 * is the only confirmation. Reading only the numeric fields turned a real Tally
 * import into "Altered successfully" reported as a failure, so the record sat
 * in the retry queue forever while existing happily in Tally.
 */
const TallySyncTsAdapter = require('../TallySyncTsAdapter');

const adapter = new TallySyncTsAdapter({ enabled: false });
const normalize = (responses, hints) => adapter.normalizePostResponses(responses, hints);

// Exactly what parsePostResponse returns for a master import.
const masterResponse = (message) => [{ status: 'success', message }];

describe('normalizePostResponses — master imports', () => {
  test('accepts "Altered successfully" as confirmation', () => {
    const out = normalize(masterResponse('Altered successfully'), { masterName: 'ABC Traders' });
    expect(out.success).toBe(true);
    expect(out.altered).toBe(1);
    expect(out.alreadyExisted).toBe(true);
    expect(out.lineErrors).toEqual([]);
  });

  test('accepts "Created successfully" as confirmation', () => {
    const out = normalize(masterResponse('Created successfully'), { masterName: 'Widget' });
    expect(out.success).toBe(true);
    expect(out.created).toBe(1);
    expect(out.alreadyExisted).toBe(false);
  });

  test('still rejects "Imported successfully" — Tally changed nothing', () => {
    // The library emits this only when CREATED, ALTERED and DELETED are all 0.
    const out = normalize(masterResponse('Imported successfully'), {});
    expect(out.success).toBe(false);
    expect(out.created).toBe(0);
    expect(out.altered).toBe(0);
  });

  test('still rejects an explicit Tally failure', () => {
    const out = normalize(
      [{ status: 'failure', message: 'Ledger parent does not exist', error: 'Ledger parent does not exist' }],
      {}
    );
    expect(out.success).toBe(false);
    expect(out.lineErrors[0]).toMatch(/parent/i);
  });

  test('still rejects an empty response', () => {
    expect(normalize([], {}).success).toBe(false);
  });
});

describe('normalizePostResponses — voucher imports keep working', () => {
  test('GUID alone is proof', () => {
    const out = normalize(
      [{ status: 'success', message: 'Imported successfully', guid: 'abc-123', name: 'SI/001' }],
      { voucherNumber: 'SI/001' }
    );
    expect(out.success).toBe(true);
    expect(out.tallyGuid).toBe('abc-123');
    expect(out.voucherNumber).toBe('SI/001');
  });

  test('masterId (LASTVCHID) alone is proof', () => {
    const out = normalize([{ status: 'success', message: 'Created successfully', masterId: 42 }], {});
    expect(out.success).toBe(true);
    expect(out.created).toBe(1);
  });
});
