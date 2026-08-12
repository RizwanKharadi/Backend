/**
 * Payment delay prediction and customer risk assessment.
 *
 * Both wrap scoreParty rather than defining their own maths, so a party called
 * high risk on the dashboard cannot come back as low risk here. What this module
 * adds is the per-request framing: how many days late to expect, what a proposed
 * new invoice would do to their exposure, and which dimension the caller asked
 * about.
 *
 * "Predicted days late" is the party's own median, not a fitted regression.
 * A median over a party's settled bills is robust against the one invoice that
 * sat unpaid for nine months, needs no training, and can be explained in a
 * sentence — all of which matter more here than squeezing out error.
 */

import Party from '../../models/Party.js';
import BillHistory from '../../models/BillHistory.js';
import OutstandingReceivable from '../../models/OutstandingReceivable.js';
import { getPartyPaymentBehaviour, normalisePartyKey } from '../billHistoryService.js';
import { scoreParty, recommendationsFor } from './riskScoring.js';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/**
 * Everything the scorer needs for a whole company, fetched once.
 *
 * The service this replaced looped one customer at a time and re-read the
 * database per customer, so a bulk call over 200 parties was 600 queries. This
 * is four, whether it scores one party or all of them.
 */
async function loadCompanyContext(companyId) {
  const [behaviour, parties, report, settledBills] = await Promise.all([
    getPartyPaymentBehaviour({ company: companyId }),
    Party.find({ company: companyId, isActive: true })
      .select('name displayName creditLimit balances category')
      .lean(),
    OutstandingReceivable.findOne({ company: companyId, reportName: 'Bills Receivable' })
      .select('ledgers asOfDate')
      .lean(),
    BillHistory.find({ company: companyId, status: 'settled' }).select('daysLate').lean(),
  ]);

  const exposure = new Map();
  for (const ledger of report?.ledgers || []) {
    const partyName = String(ledger?.partyName || '').trim();
    if (!partyName) continue;

    let overdueAmount = 0;
    for (const bill of Array.isArray(ledger?.bills) ? ledger.bills : []) {
      if (num(bill?.billOverdue) > 0) overdueAmount += Math.abs(num(bill?.closingBalance));
    }

    exposure.set(normalisePartyKey(partyName), {
      partyName,
      outstanding: num(ledger?.totalOutstanding),
      overdueAmount,
      oldestOverdueDays: num(ledger?.oldestOverdueDays),
    });
  }

  const partyByKey = new Map();
  for (const party of parties) {
    partyByKey.set(normalisePartyKey(party.name), party);
    if (party.displayName) {
      const key = normalisePartyKey(party.displayName);
      if (!partyByKey.has(key)) partyByKey.set(key, party);
    }
  }

  // Company-wide fallback for parties with no history of their own.
  const companyMedianDelay = median(
    settledBills.map((b) => b.daysLate).filter((d) => d != null && d > 0)
  );

  return { behaviour, partyByKey, exposure, companyMedianDelay, asOfDate: report?.asOfDate || null };
}

/** Accepts a party id or the name shown in the app, as the old endpoint did. */
function resolveParty(context, customerId) {
  const raw = String(customerId || '').trim();
  if (!raw) return null;

  const byId = [...context.partyByKey.values()].find((p) => String(p.id) === raw);
  if (byId) return byId;

  return context.partyByKey.get(normalisePartyKey(raw)) || null;
}

/**
 * Score one party against a company context that is already loaded.
 * @param {number} [amount] value of a proposed new invoice, if any
 */
function predictForParty(context, party, key, { amount = 0, daysAhead = 30 } = {}) {
  const behaviour = context.behaviour.get(key) || null;
  const exposure = context.exposure.get(key) || {
    partyName: party?.displayName || party?.name || key,
    outstanding: num(party?.balances?.current?.amount),
    overdueAmount: 0,
    oldestOverdueDays: 0,
  };

  const creditLimit = num(party?.creditLimit?.amount);
  const currentOutstanding = exposure.outstanding || num(party?.balances?.current?.amount);

  // A proposed invoice is scored against the exposure it would create, which is
  // the question actually being asked: "if I ship this, will it be paid late?"
  const projectedOutstanding = currentOutstanding + Math.max(0, amount);

  const risk = scoreParty({
    behaviour,
    creditLimit,
    outstanding: projectedOutstanding,
    overdueAmount: exposure.overdueAmount,
    oldestOverdueDays: exposure.oldestOverdueDays,
  });

  const factors = { ...Object.fromEntries(risk.factors.map((f) => [f.factor, f.impact])) };

  if (amount > 0 && creditLimit > 0) {
    const projected = projectedOutstanding / creditLimit;
    if (projected > 1) {
      factors['Would exceed credit limit'] = Number(Math.min(1, projected - 1).toFixed(3));
    }
  }

  // Their own median when there is history, the company's when there is not, and
  // zero only when nothing has ever been settled — with confidence saying which.
  let predictedDays = 0;
  let basis = 'no_history';
  if (behaviour?.settledCount) {
    predictedDays = Math.max(0, behaviour.medianDaysLate ?? 0);
    basis = 'party_history';
  } else if (context.companyMedianDelay != null) {
    predictedDays = Math.max(0, context.companyMedianDelay);
    basis = 'company_average';
  }

  return {
    customer_id: party?.id ? String(party.id) : key,
    customer_name: exposure.partyName,
    delay_probability: risk.score,
    predicted_delay_days: predictedDays,
    risk_level: risk.level,
    confidence_score: risk.confidence,
    factors,
    meta: {
      basis,
      settled_bills: behaviour?.settledCount || 0,
      outstanding: Math.round(currentOutstanding),
      projected_outstanding: Math.round(projectedOutstanding),
      credit_limit: creditLimit,
      days_ahead: daysAhead,
    },
  };
}

export async function predictPaymentDelay(companyId, { customerId, amount = 0, daysAhead = 30 } = {}) {
  const context = await loadCompanyContext(companyId);
  const party = resolveParty(context, customerId);
  const key = party ? normalisePartyKey(party.name) : normalisePartyKey(customerId);

  // A party can be known to the outstanding report without having a party row,
  // since bills identify parties by name. Score those too rather than 404ing.
  if (!party && !context.exposure.has(key)) return null;

  return predictForParty(context, party, key, { amount, daysAhead });
}

export async function predictPaymentDelayBulk(companyId, { customerIds = [], daysAhead = 30 } = {}) {
  const context = await loadCompanyContext(companyId);

  // An empty list means "everyone we have exposure to", which is what the risk
  // screens actually want.
  const keys = customerIds.length
    ? customerIds.map((id) => {
        const party = resolveParty(context, id);
        return { key: party ? normalisePartyKey(party.name) : normalisePartyKey(id), party };
      })
    : [...context.exposure.keys()].map((key) => ({
        key,
        party: context.partyByKey.get(key) || null,
      }));

  const predictions = [];
  for (const { key, party } of keys) {
    if (!party && !context.exposure.has(key)) continue;
    predictions.push(predictForParty(context, party, key, { daysAhead }));
  }

  const counts = { High: 0, Medium: 0, Low: 0 };
  for (const p of predictions) counts[p.risk_level] += 1;

  const avg = predictions.length
    ? predictions.reduce((sum, p) => sum + p.delay_probability, 0) / predictions.length
    : 0;

  return {
    predictions: predictions.sort((a, b) => b.delay_probability - a.delay_probability),
    summary: {
      total_customers: customerIds.length || predictions.length,
      successful_predictions: predictions.length,
      high_risk_customers: counts.High,
      medium_risk_customers: counts.Medium,
      low_risk_customers: counts.Low,
      average_delay_probability: Number(avg.toFixed(4)),
    },
  };
}

export async function assessCustomerRisk(companyId, customerId, assessmentType = 'overall') {
  const mode = ['credit', 'payment', 'overall'].includes(assessmentType) ? assessmentType : 'overall';

  const context = await loadCompanyContext(companyId);
  const party = resolveParty(context, customerId);
  const key = party ? normalisePartyKey(party.name) : normalisePartyKey(customerId);

  if (!party && !context.exposure.has(key)) return null;

  const behaviour = context.behaviour.get(key) || null;
  const exposure = context.exposure.get(key) || {
    partyName: party?.displayName || party?.name || key,
    outstanding: num(party?.balances?.current?.amount),
    overdueAmount: 0,
    oldestOverdueDays: 0,
  };

  const creditLimit = num(party?.creditLimit?.amount);
  const outstanding = exposure.outstanding || num(party?.balances?.current?.amount);

  const risk = scoreParty({
    behaviour,
    creditLimit,
    outstanding,
    overdueAmount: exposure.overdueAmount,
    oldestOverdueDays: exposure.oldestOverdueDays,
    mode,
  });

  return {
    customer_id: party?.id ? String(party.id) : key,
    customer_name: exposure.partyName,
    risk_score: risk.score,
    risk_level: risk.level,
    risk_factors: risk.factors,
    recommendations: recommendationsFor(risk.level, risk.factors),
    assessment_date: new Date().toISOString(),
    assessment_type: mode,
    confidence: risk.confidence,
    meta: {
      settled_bills: behaviour?.settledCount || 0,
      outstanding: Math.round(outstanding),
      credit_limit: creditLimit,
      overdue_amount: Math.round(exposure.overdueAmount),
      as_of: context.asOfDate,
    },
  };
}

export default { predictPaymentDelay, predictPaymentDelayBulk, assessCustomerRisk };
