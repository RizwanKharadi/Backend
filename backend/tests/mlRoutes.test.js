/**
 * Insights API surface: authentication, company scoping, and honest reporting of
 * what the data can and cannot support yet.
 *
 * Company scoping is the point of these tests. The service this replaced ran
 * unauthenticated and filtered by nothing, so one tenant could read another's
 * turnover; the cases below pin that shut.
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';

const state = {
  user: null,
  billHistory: [],
  vouchers: [],
  outstanding: null,
  companyLookup: null,
  analyticsThrows: false,
  customerMissing: false,
};

const countMatching = (rows, filter) =>
  rows.filter((row) =>
    Object.entries(filter).every(([key, cond]) => {
      const value = row[key];
      if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
        if ('$in' in cond) return cond.$in.includes(value);
        if ('$gte' in cond) return value != null && new Date(value) >= new Date(cond.$gte);
      }
      return value === cond;
    })
  ).length;

jest.unstable_mockModule('../src/middleware/auth.js', () => ({
  protect: (req, res, next) => {
    if (!state.user) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }
    req.user = state.user;
    next();
  },
}));

jest.unstable_mockModule('../src/models/BillHistory.js', () => {
  const model = {
    countDocuments: async (filter) => countMatching(state.billHistory, filter),
    find: (filter) => {
      const rows = state.billHistory.filter((r) => r.company === filter.company);
      const chain = {
        sort: () => chain,
        limit: () => chain,
        lean: async () => rows,
      };
      return chain;
    },
  };
  return { default: model, BillHistory: model };
});

jest.unstable_mockModule('../src/models/Voucher.js', () => {
  const model = { countDocuments: async (filter) => countMatching(state.vouchers, filter) };
  return { default: model, Voucher: model };
});

jest.unstable_mockModule('../src/models/OutstandingReceivable.js', () => {
  const model = {
    findOne: (filter) => {
      const row =
        state.outstanding && state.outstanding.company === filter.company
          ? state.outstanding
          : null;
      const chain = { select: () => chain, lean: async () => row };
      return chain;
    },
  };
  return { default: model, OutstandingReceivable: model };
});

jest.unstable_mockModule('../src/models/Company.js', () => {
  const model = {
    findOne: () => ({ select: async () => state.companyLookup }),
  };
  return { default: model, Company: model };
});

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// The analytics maths has its own suite; here we only care that the router hands
// each handler the resolved company and surfaces the result.
const analyticsCalls = [];
const analyticsStub = (name) => async (companyId, ...rest) => {
  analyticsCalls.push({ name, companyId, rest });
  if (state.analyticsThrows) throw new Error('boom');
  if (name === 'customer' && state.customerMissing) return null;
  return { ok: true, name, company: companyId };
};

jest.unstable_mockModule('../src/services/ml/analyticsService.js', () => ({
  getBusinessMetrics: analyticsStub('business'),
  getCustomerInsights: analyticsStub('customer'),
  getInventoryAnalytics: analyticsStub('inventory'),
  getPaymentTrends: analyticsStub('trends'),
  getRiskDashboard: analyticsStub('risk'),
}));

const { default: mlRoutes } = await import('../src/routes/ml.js');

const app = express();
app.use(express.json());
app.use('/ml/api/v1', mlRoutes);

const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

const settledBill = (company, i) => ({
  company,
  status: 'settled',
  daysLate: 5,
  firstSeenAt: new Date(Date.now() - 90 * 86400000),
  billRef: `INV-${i}`,
});

beforeEach(() => {
  state.user = { _id: 'user-1', role: 'user', companies: [{ _id: COMPANY_A, isActive: true }] };
  state.billHistory = [];
  state.vouchers = [];
  state.outstanding = null;
  state.companyLookup = null;
  state.analyticsThrows = false;
  state.customerMissing = false;
  analyticsCalls.length = 0;
});

describe('authentication', () => {
  it('rejects unauthenticated requests', async () => {
    state.user = null;
    await request(app).get('/ml/api/v1/health').expect(401);
  });

  it('serves health once authenticated', async () => {
    const res = await request(app).get('/ml/api/v1/health').expect(200);
    expect(res.body.status).toBe('healthy');
  });
});

describe('company scoping', () => {
  it('refuses a company the user is not a member of', async () => {
    const res = await request(app)
      .get('/ml/api/v1/models/status')
      .query({ companyId: COMPANY_B })
      .expect(403);

    expect(res.body.message).toMatch(/not authorized/i);
  });

  it('allows a company the user belongs to', async () => {
    state.user.companies.push({ _id: COMPANY_B, isActive: true });
    await request(app)
      .get('/ml/api/v1/models/status')
      .query({ companyId: COMPANY_B })
      .expect(200);
  });

  it('counts only the requesting company data', async () => {
    state.billHistory = [
      ...Array.from({ length: 25 }, (_, i) => settledBill(COMPANY_A, i)),
      ...Array.from({ length: 40 }, (_, i) => settledBill(COMPANY_B, i)),
    ];

    const res = await request(app).get('/ml/api/v1/models/status').expect(200);

    // 25, not 65 — the other tenant's bills must be invisible.
    expect(res.body.models.payment_delay_predictor.sample_size).toBe(25);
  });

  it('falls back to the user active company when none is given', async () => {
    state.billHistory = [settledBill(COMPANY_A, 1)];
    const res = await request(app).get('/ml/api/v1/health/detailed').expect(200);
    expect(res.body.company).toBe(COMPANY_A);
  });

  it('asks for a company when the user has none', async () => {
    state.user.companies = [];
    const res = await request(app).get('/ml/api/v1/models/status').expect(400);
    expect(res.body.code).toBe('no_company');
  });
});

describe('models/status', () => {
  it('reports collecting_data and never invents an accuracy', async () => {
    state.billHistory = Array.from({ length: 3 }, (_, i) => settledBill(COMPANY_A, i));

    const res = await request(app).get('/ml/api/v1/models/status').expect(200);
    const model = res.body.models.payment_delay_predictor;

    expect(model.status).toBe('collecting_data');
    expect(model.accuracy).toBeNull();
    expect(model.sample_size).toBe(3);
    expect(model.message).toMatch(/3 so far/);
  });

  it('turns active once enough settled bills have accumulated', async () => {
    state.billHistory = Array.from({ length: 25 }, (_, i) => settledBill(COMPANY_A, i));

    const res = await request(app).get('/ml/api/v1/models/status').expect(200);

    expect(res.body.models.payment_delay_predictor.status).toBe('active');
    expect(res.body.models.payment_delay_predictor.readiness).toBe(1);
  });

  it('summarises overall health across features', async () => {
    state.billHistory = [{ company: COMPANY_A, status: 'open', billRef: 'INV-1' }];

    const res = await request(app).get('/ml/api/v1/models/status').expect(200);

    expect(res.body.models.risk_assessment.status).toBe('active');
    expect(res.body.models.inventory_forecast.status).toBe('collecting_data');
    expect(res.body.overall_health).toBe('partial');
  });
});

describe('analytics endpoints', () => {
  it.each([
    ['/ml/api/v1/business-metrics', 'business'],
    ['/ml/api/v1/inventory-analytics', 'inventory'],
    ['/ml/api/v1/payment-trends', 'trends'],
    ['/ml/api/v1/risk-dashboard', 'risk'],
  ])('serves %s scoped to the resolved company', async (path, name) => {
    const res = await request(app).get(path).expect(200);

    expect(res.body).toMatchObject({ ok: true, name });
    expect(analyticsCalls.at(-1)).toMatchObject({ name, companyId: COMPANY_A });
  });

  it('passes days_back through to business metrics, clamped', async () => {
    await request(app).get('/ml/api/v1/business-metrics').query({ days_back: 9000 }).expect(200);
    expect(analyticsCalls.at(-1).rest[0]).toBe(365);

    await request(app).get('/ml/api/v1/business-metrics').query({ days_back: -5 }).expect(200);
    expect(analyticsCalls.at(-1).rest[0]).toBe(1);
  });

  it('404s an unknown customer instead of returning an empty profile', async () => {
    state.customerMissing = true;
    const res = await request(app).get('/ml/api/v1/customer-insights/nobody').expect(404);
    expect(res.body.success).toBe(false);
  });

  it('answers 500 without leaking internals when a report fails', async () => {
    state.analyticsThrows = true;
    const res = await request(app).get('/ml/api/v1/risk-dashboard').expect(500);
    expect(res.body.message).toMatch(/failed to build/i);
    expect(JSON.stringify(res.body)).not.toMatch(/boom/);
  });

  it('still refuses another company on an analytics route', async () => {
    await request(app)
      .get('/ml/api/v1/risk-dashboard')
      .query({ companyId: COMPANY_B })
      .expect(403);
  });
});

describe('unbuilt endpoints', () => {
  it.each([
    ['post', '/ml/api/v1/payment-delay'],
    ['post', '/ml/api/v1/risk-assessment'],
    ['post', '/ml/api/v1/inventory-forecast'],
  ])('answers 501 for %s %s rather than fake data', async (method, path) => {
    const res = await request(app)[method](path).expect(501);
    expect(res.body.code).toBe('not_implemented');
  });

  it('still requires auth before reporting not implemented', async () => {
    state.user = null;
    await request(app).get('/ml/api/v1/business-metrics').expect(401);
  });

  it('404s an unknown insights path', async () => {
    await request(app).get('/ml/api/v1/nope').expect(404);
  });
});
