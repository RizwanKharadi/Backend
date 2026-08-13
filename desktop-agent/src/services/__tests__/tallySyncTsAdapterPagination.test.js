/**
 * Regression cover for silently truncated master imports.
 *
 * fetchAllPaginated looped `while (pageNum <= totalPages)` with totalPages
 * seeded at 1 and only corrected from the response. When Tally's count tag did
 * not parse — it is suppressed on later pages and can be absent on the first —
 * the loop ended after one page, importing exactly recordsPerPage masters and
 * silently dropping the rest. A company with 8,326 ledgers imported 500 of them,
 * and the only visible symptom was customers "missing" from the app.
 *
 * The guard that was meant to catch this (stop on a short page) could never run,
 * because the while condition had already ended the loop.
 */
const TallySyncTsAdapter = require('../TallySyncTsAdapter');

/**
 * Fake Tally client serving `total` objects in pages.
 * @param {object} opts
 * @param {number|null} opts.reportTotalPages what the first page claims, null to omit
 */
function makeClient(total, { reportTotalPages } = {}) {
  const calls = [];
  return {
    calls,
    async getPaginatedObjects(collectionType, { pageNum, recordsPerPage }) {
      calls.push(pageNum);
      const start = (pageNum - 1) * recordsPerPage;
      const objects = Array.from(
        { length: Math.max(0, Math.min(recordsPerPage, total - start)) },
        (_, i) => ({ name: `Ledger ${start + i + 1}` })
      );
      const page = { objects };
      if (pageNum === 1 && reportTotalPages !== null) page.totalPages = reportTotalPages;
      return page;
    },
  };
}

function makeAdapter(client) {
  const adapter = new TallySyncTsAdapter({ enabled: false });
  adapter.getClient = async () => client;
  adapter.logger = { info: () => {}, warn: () => {}, error: () => {} };
  return adapter;
}

describe('fetchAllPaginated', () => {
  test('fetches every page when Tally does not report a page count', async () => {
    // The failing case: 8,326 ledgers, no usable count, 500 per page.
    const client = makeClient(8326, { reportTotalPages: null });
    const adapter = makeAdapter(client);

    const objects = await adapter.fetchAllPaginated('Ledger', { recordsPerPage: 500 });

    expect(objects).toHaveLength(8326);
    expect(client.calls).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
  });

  test('fetches every page when the reported count is wrong', async () => {
    const client = makeClient(8326, { reportTotalPages: 1 });
    const adapter = makeAdapter(client);

    const objects = await adapter.fetchAllPaginated('Ledger', { recordsPerPage: 500 });

    expect(objects).toHaveLength(8326);
  });

  test('still stops at the end of a collection', async () => {
    const client = makeClient(1200, { reportTotalPages: 3 });
    const adapter = makeAdapter(client);

    const objects = await adapter.fetchAllPaginated('Ledger', { recordsPerPage: 500 });

    expect(objects).toHaveLength(1200);
    // Three pages: 500, 500, then a short 200 that ends it.
    expect(client.calls).toEqual([1, 2, 3]);
  });

  test('does not fetch a second page when the first is short', async () => {
    const client = makeClient(120, { reportTotalPages: 1 });
    const adapter = makeAdapter(client);

    const objects = await adapter.fetchAllPaginated('Ledger', { recordsPerPage: 500 });

    expect(objects).toHaveLength(120);
    expect(client.calls).toEqual([1]);
  });

  test('handles a collection that is exactly one full page', async () => {
    // Ends on the empty page after it, rather than looping forever.
    const client = makeClient(500, { reportTotalPages: 1 });
    const adapter = makeAdapter(client);

    const objects = await adapter.fetchAllPaginated('Ledger', { recordsPerPage: 500 });

    expect(objects).toHaveLength(500);
    expect(client.calls).toEqual([1, 2]);
  });

  test('returns nothing for an empty collection', async () => {
    const client = makeClient(0, { reportTotalPages: null });
    const adapter = makeAdapter(client);

    expect(await adapter.fetchAllPaginated('Ledger', { recordsPerPage: 500 })).toEqual([]);
  });
});
