/**
 * One definition of "how risky is this party", shared by every endpoint that
 * shows a risk number.
 *
 * Kept deliberately as a weighted sum of four readable signals rather than a
 * fitted model. Two reasons: a typical customer has a few hundred bills, which is
 * far too little to fit anything that beats the obvious rules; and an accountant
 * asked to chase a customer will ask why, so every score returns the factors that
 * produced it. Callers are expected to show them.
 *
 * `confidence` is separate from the score on purpose. A party with two settled
 * bills can look terrible or perfect on the history signals; the score says how
 * risky, confidence says how much of it rests on real evidence.
 */

const WEIGHTS = {
  lateRatio: 0.4,
  avgDelay: 0.25,
  utilisation: 0.2,
  currentlyOverdue: 0.15,
};

// A delay this long is treated as "as bad as it gets" for scoring purposes;
// beyond it the score is already saturated.
const DELAY_CAP_DAYS = 60;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

export function riskLevelFor(score) {
  if (score >= 0.7) return 'High';
  if (score >= 0.4) return 'Medium';
  return 'Low';
}

/**
 * @param {object} input
 * @param {object} [input.behaviour]  from getPartyPaymentBehaviour()
 * @param {number} [input.creditLimit]
 * @param {number} [input.outstanding] current balance owed
 * @param {number} [input.overdueAmount] portion already past its due date
 * @param {number} [input.oldestOverdueDays]
 */
export function scoreParty({
  behaviour = null,
  creditLimit = 0,
  outstanding = 0,
  overdueAmount = 0,
  oldestOverdueDays = 0,
} = {}) {
  const factors = [];
  let score = 0;

  // 1. How often they have paid late before.
  if (behaviour?.settledCount) {
    const contribution = clamp01(behaviour.lateRatio) * WEIGHTS.lateRatio;
    score += contribution;
    if (behaviour.lateRatio > 0) {
      factors.push({
        factor: 'Late payment history',
        value: `${behaviour.lateCount} of ${behaviour.settledCount} bills paid late`,
        impact: Number(contribution.toFixed(3)),
        description: `Paid late ${Math.round(behaviour.lateRatio * 100)}% of the time.`,
      });
    }

    // 2. How late, when they are late.
    const delay = Math.max(0, behaviour.avgDaysLate || 0);
    const delayContribution = clamp01(delay / DELAY_CAP_DAYS) * WEIGHTS.avgDelay;
    score += delayContribution;
    if (delay > 0) {
      factors.push({
        factor: 'Average delay',
        value: `${delay} days`,
        impact: Number(delayContribution.toFixed(3)),
        description: `Settles about ${delay} days after the due date on average.`,
      });
    }
  }

  // 3. How much of their credit line is already used.
  const utilisation = creditLimit > 0 ? outstanding / creditLimit : 0;
  if (creditLimit > 0) {
    const contribution = clamp01(utilisation) * WEIGHTS.utilisation;
    score += contribution;
    if (utilisation > 0.8) {
      factors.push({
        factor: 'Credit utilisation',
        value: `${Math.round(utilisation * 100)}%`,
        impact: Number(contribution.toFixed(3)),
        description: `Using ${Math.round(utilisation * 100)}% of their credit limit.`,
      });
    }
  }

  // 4. What is overdue right now.
  if (overdueAmount > 0) {
    const share = outstanding > 0 ? clamp01(overdueAmount / outstanding) : 1;
    const contribution = share * WEIGHTS.currentlyOverdue;
    score += contribution;
    factors.push({
      factor: 'Currently overdue',
      value: `₹${Math.round(overdueAmount).toLocaleString('en-IN')}`,
      impact: Number(contribution.toFixed(3)),
      description: oldestOverdueDays
        ? `Oldest bill is ${oldestOverdueDays} days past due.`
        : 'Has bills past their due date.',
    });
  }

  score = clamp01(score);

  // Only the two history signals need evidence to be trustworthy; utilisation and
  // overdue amounts are facts read straight off the current ledger.
  const historyWeight = WEIGHTS.lateRatio + WEIGHTS.avgDelay;
  const ledgerWeight = 1 - historyWeight;
  const confidence = clamp01(ledgerWeight + historyWeight * (behaviour?.confidence ?? 0));

  return {
    score: Number(score.toFixed(4)),
    level: riskLevelFor(score),
    factors: factors.sort((a, b) => b.impact - a.impact),
    confidence: Number(confidence.toFixed(3)),
    sampleSize: behaviour?.settledCount || 0,
  };
}

/** Plain-language next steps, driven by the factors that actually fired. */
export function recommendationsFor(level, factors) {
  const out = [];

  if (level === 'High') {
    out.push('Ask for advance payment or reduce the credit limit before the next order.');
    out.push('Call before the due date rather than after it.');
  } else if (level === 'Medium') {
    out.push('Send a reminder a few days before the due date.');
  } else {
    out.push('No action needed — keep the usual follow-up.');
  }

  for (const f of factors) {
    if (f.factor === 'Credit utilisation') {
      out.push('Review the credit limit — most of it is already used.');
    }
    if (f.factor === 'Currently overdue') {
      out.push('Chase the oldest overdue bill first.');
    }
  }

  return [...new Set(out)];
}

export default { scoreParty, riskLevelFor, recommendationsFor };
