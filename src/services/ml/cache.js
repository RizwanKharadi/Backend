/**
 * Short-lived response cache for the insights endpoints.
 *
 * These reports scan a year of vouchers and every bill on record. That is cheap
 * for one request and wasteful when four mobile screens ask within a second of
 * each other, which is exactly what happens when someone opens the insights tab.
 *
 * Correctness before speed: entries are stamped with the company's data version,
 * and any Tally sync that writes to that company bumps it. A cached figure can
 * therefore be a few minutes stale relative to the clock, but never stale
 * relative to the data — which is the promise that matters for a product whose
 * numbers have to reconcile with Tally.
 */

import logger from '../../utils/logger.js';

const DEFAULT_TTL_MS = 3 * 60 * 1000;

// A hard ceiling so a large tenant browsing every report cannot grow this
// without bound. Eviction is oldest-first, which is fine for a cache this small.
const MAX_ENTRIES = 500;

const entries = new Map();
const versions = new Map();

const versionOf = (companyId) => versions.get(String(companyId)) || 0;

/**
 * Mark a company's data as changed. Everything cached for it is now suspect and
 * will be recomputed on next request.
 */
export function bumpCompanyVersion(companyId) {
  if (!companyId) return;
  const key = String(companyId);
  versions.set(key, versionOf(key) + 1);
}

function evictIfNeeded() {
  if (entries.size <= MAX_ENTRIES) return;
  const overflow = entries.size - MAX_ENTRIES;
  let removed = 0;
  for (const key of entries.keys()) {
    entries.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

/**
 * Run `compute` unless an identical, still-valid result is already held.
 *
 * @param {string} companyId
 * @param {string} key       identifies the report and its parameters
 * @param {() => Promise<any>} compute
 */
export async function withCache(companyId, key, compute, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const cacheKey = `${companyId}::${key}`;
  const hit = entries.get(cacheKey);
  const now = Date.now();

  if (hit && hit.expiresAt > now && hit.version === versionOf(companyId)) {
    return hit.value;
  }

  const value = await compute();

  entries.set(cacheKey, {
    value,
    expiresAt: now + ttlMs,
    version: versionOf(companyId),
  });
  evictIfNeeded();

  return value;
}

/** Drop everything held for one company, e.g. when a user forces a refresh. */
export function clearCompany(companyId) {
  const prefix = `${companyId}::`;
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
  logger.info('Insights cache cleared', { company: String(companyId) });
}

/** Test seam. */
export function resetCache() {
  entries.clear();
  versions.clear();
}

export function cacheStats() {
  return { entries: entries.size, companies: versions.size };
}

export default { withCache, bumpCompanyVersion, clearCompany, resetCache, cacheStats };
