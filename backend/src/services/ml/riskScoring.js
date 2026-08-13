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

// A bill this far past due escalates the level on its own, whatever the weighted
// score says.
//
// The weights deliberately refuse to call a party high risk without payment
// history, because a new customer using their credit limit looks identical to a
// bad one. That reasoning does not extend to a bill nobody has paid for half a
// year: it is an observed fact, not an inference from thin evidence. Without this,
// a party with a bill 587 days overdue scored 15% and was reported as "Low risk,
// no action needed", which is the kind of answer that costs a user money and
// costs us their trust in every other figure on the screen.
const OVERDUE_MEDIUM_DAYS = 90;
const OVERDUE_HIGH_DAYS = 180;

const LEVEL_RANK = { Low: 0, Medium: 1, High: 2 };
const worseOf = (a, b) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a);

const clamp01 = (n) => Math.min(1, Math.max(0, n));

// Which signals each assessment mode considers.
//   overall — everything, and NOT renormalised. A party with no payment history
//             simply cannot reach a high score on ledger facts alone, which is
//             the intended behaviour: a new customer using their credit limit
//             looks identical to a bad one, and only one of them deserves to be
//             flagged.
//   payment/credit — the caller has explicitly asked about one dimension, so the
//             score is renormalised to that dimension and reads as a full scale.
const MODES = {
  overall: { signals: ['lateRatio', 'avgDelay', 'utilisation', 'currentlyOverdue'], renormalise: false },
  payment: { signals: ['lateRatio', 'avgDelay'], renormalise: true },
  credit: { signals: ['utilisation', 'currentlyOverdue'], renormalise: true },
};

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
 * @param {'overall'|'payment'|'credit'} [input.mode]
 */
export function scoreParty({
  behaviour = null,
  creditLimit = 0,
  outstanding = 0,
  overdueAmount = 0,
  oldestOverdueDays = 0,
  mode = 'overall',
} = {}) {
  const { signals, renormalise } = MODES[mode] || MODES.overall;
  const uses = (signal) => signals.includes(signal);

  const factors = [];
  let score = 0;

  // 1. How often they have paid late before.
  if (uses('lateRatio') && behaviour?.settledCount) {
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

  }

  // 2. How late, when they are late.
  if (uses('avgDelay') && behaviour?.settledCount) {
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
  if (uses('utilisation') && creditLimit > 0) {
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
  if (uses('currentlyOverdue') && overdueAmount > 0) {
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

  // In a focused mode the score is expressed against that dimension's own scale,
  // so "high payment risk" means high for a payment question — not capped at the
  // 0.65 those two signals can reach inside the overall blend.
  if (renormalise) {
    const available = signals.reduce((sum, s) => sum + WEIGHTS[s], 0);
    if (available > 0) score /= available;
  }

  score = clamp01(score);

  // Only the two history signals need evidence to be trustworthy; utilisation and
  // overdue amounts are facts read straight off the current ledger. A mode that
  // drops the history signals therefore has nothing left to be unsure about.
  const usedWeight = signals.reduce((sum, s) => sum + WEIGHTS[s], 0);
  const historyWeight = signals
    .filter((s) => s === 'lateRatio' || s === 'avgDelay')
    .reduce((sum, s) => sum + WEIGHTS[s], 0);
  const ledgerShare = usedWeight > 0 ? (usedWeight - historyWeight) / usedWeight : 1;
  const historyShare = 1 - ledgerShare;
  const confidence = clamp01(ledgerShare + historyShare * (behaviour?.confidence ?? 0));

  let level = riskLevelFor(score);
  let ageingFactor = null;

  // Ageing overrides the weighted score. Never downgrades — only escalates.
  if (
    uses('currentlyOverdue') &&
    overdueAmount > 0 &&
    oldestOverdueDays >= OVERDUE_MEDIUM_DAYS
  ) {
    level = worseOf(level, oldestOverdueDays >= OVERDUE_HIGH_DAYS ? 'High' : 'Medium');

    const months = Math.floor(oldestOverdueDays / 30);
    const years = Math.floor(months / 12);
    ageingFactor = {
      factor: 'Long overdue',
      value: `${oldestOverdueDays} days`,
      // Zero because it added nothing to the weighted score — it changed the
      // level directly. Listed first regardless, since it is the reason.
      impact: 0,
      description:
        years >= 1
          ? `A bill has gone unpaid for over ${years} year${years > 1 ? 's' : ''}. Treat it as at risk of never being collected.`
          : `A bill has been unpaid for about ${months} months, well beyond normal terms.`,
    };
  }

  // Sort by contribution, then put the ageing escalation at the top: it did not
  // score, but it is why the level is what it is.
  const sorted = factors.sort((a, b) => b.impact - a.impact);

  return {
    score: Number(score.toFixed(4)),
    level,
    factors: ageingFactor ? [ageingFactor, ...sorted] : sorted,
    confidence: Number(confidence.toFixed(3)),
    sampleSize: behaviour?.settledCount || 0,
    mode,
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
  } else if (!factors.length) {
    // Only say this when genuinely nothing fired. Saying "no action needed"
    // above a list of risk factors reads as a contradiction and undermines
    // every other number on the screen.
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
