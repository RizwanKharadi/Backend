'use strict';

/**
 * Retries an async function with exponential back-off.
 * @param {Function} fn
 * @param {object} opts
 * @param {number} opts.retries
 * @param {number} opts.baseMs
 * @param {Function} opts.shouldRetry - (err) => boolean
 * @param {string} opts.label
 */
async function withRetry(fn, { retries = 3, baseMs = 1500, shouldRetry, label = 'operation' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryable = shouldRetry ? shouldRetry(err) : true;
      if (!retryable || attempt >= retries) {
        break;
      }
      const delay = baseMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { withRetry, sleep };
