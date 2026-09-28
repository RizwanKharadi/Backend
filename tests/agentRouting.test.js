/**
 * Pushes from the app must reach the right customer's desktop agent.
 *
 * A connected agent was reported as offline to the app ("will sync when the
 * desktop agent connects") because (1) closing a replaced socket deleted the
 * live one, and (2) an agent only matched the single company it connected
 * with. And when exactly one agent was online, pushes for any company went to
 * it — even another customer's.
 */

import { jest } from '@jest/globals';
import { WebSocket } from 'ws';

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// No database: the agent under test is always live, never found via a DB row.
jest.unstable_mockModule('../src/models/TallyConnection.js', () => ({
  default: {
    find: () => ({ sort: () => ({ lean: async () => [] }) }),
    findOne: async () => null,
  },
}));

const { default: service } = await import('../src/services/tallyWebSocketService.js');

const openSocket = () => ({ readyState: WebSocket.OPEN });


const live = (agentId, { companyId = '', organizationId = '' } = {}) => {
  service.connections.set(agentId, { ws: openSocket(), agentId, companyId, organizationId });
};

beforeEach(() => {
  service.connections.clear();
  jest.restoreAllMocks();
});

describe('findConnectedAgentForCompany', () => {
  const company = { _id: 'company-B', organizationId: 'org-1' };

  it('finds the agent of the same organization although it registered with another company', async () => {
    live('agent-1', { companyId: 'company-A', organizationId: 'org-1' });

    await expect(service.findConnectedAgentForCompany(company)).resolves.toBe('agent-1');
  });

  it('never sends a push to the only agent online when it belongs to another organization', async () => {
    live('other-customer', { companyId: 'company-X', organizationId: 'org-2' });

    await expect(service.findConnectedAgentForCompany(company)).resolves.toBeNull();
  });

  it('prefers the agent bound to the company itself', async () => {
    live('agent-org', { companyId: 'company-A', organizationId: 'org-1' });
    live('agent-bound', { companyId: 'company-B', organizationId: 'org-1' });

    await expect(service.findConnectedAgentForCompany(company)).resolves.toBe('agent-bound');
  });
});

describe('handleDisconnection', () => {
  it('ignores the close of a socket that a reconnect already replaced', async () => {
    const oldSocket = openSocket();
    const newSocket = openSocket();
    service.connections.set('agent-1', { ws: newSocket, agentId: 'agent-1' });
    const status = jest.spyOn(service, 'updateConnectionStatus').mockResolvedValue();

    await service.handleDisconnection('agent-1', 1006, Buffer.from(''), oldSocket);

    expect(service.connections.get('agent-1')?.ws).toBe(newSocket);
    expect(status).not.toHaveBeenCalled();
  });

  it('still removes the agent when its live socket closes', async () => {
    const socket = openSocket();
    service.connections.set('agent-1', { ws: socket, agentId: 'agent-1' });
    jest.spyOn(service, 'updateConnectionStatus').mockResolvedValue();

    await service.handleDisconnection('agent-1', 1006, Buffer.from(''), socket);

    expect(service.connections.has('agent-1')).toBe(false);
  });
});

describe('tallyTargetOf', () => {
  it("uses the name Tally reported over the cloud name and the client's name", () => {
    const company = {
      name: 'Prem Supermarket',
      tallyCompanyPath: 'guid-1',
      tallyIntegration: { companyName: 'Prem Supermarket 1' },
    };

    expect(service.tallyTargetOf(company, { companyName: 'Prem Supermarket' })).toEqual({
      companyName: 'Prem Supermarket 1',
      companyGuid: 'guid-1',
    });
  });

  it('falls back to the cloud name until Tally has reported one', () => {
    expect(service.tallyTargetOf({ name: 'Shop' }, {}).companyName).toBe('Shop');
  });
});

describe('rememberTallyCompanyName', () => {
  it('records the Tally name when the agent tagged the upload with this company', async () => {
    const company = { _id: 'c1', tallyIntegration: { companyPath: 'g' }, save: jest.fn() };

    await service.rememberTallyCompanyName(company, 'c1', 'Prem Supermarket 1');

    expect(company.tallyIntegration).toEqual({ companyPath: 'g', companyName: 'Prem Supermarket 1' });
    expect(company.save).toHaveBeenCalledTimes(1);
  });

  it('does not relabel a company the upload was not tagged with', async () => {
    const company = { _id: 'c1', tallyIntegration: {}, save: jest.fn() };

    await service.rememberTallyCompanyName(company, 'c2', 'Someone Else');

    expect(company.save).not.toHaveBeenCalled();
  });

  it('does not write when the name is unchanged', async () => {
    const company = { _id: 'c1', tallyIntegration: { companyName: 'Same' }, save: jest.fn() };

    await service.rememberTallyCompanyName(company, 'c1', 'Same');

    expect(company.save).not.toHaveBeenCalled();
  });
});

describe('import rejected because the company is not open', () => {
  it('turns Tally\'s SVCurrentCompany error into a clear, coded error', async () => {
    const pending = new Promise((resolve, reject) => {
      service.pendingImports.set('req-1', { resolve, reject, timer: null });
    });

    service.handleImportVoucherResponse('agent-1', {
      data: {
        requestId: 'req-1',
        success: false,
        error: "Could not set 'SVCurrentCompany' to 'Prem Supermarket'",
      },
    });

    await expect(pending).rejects.toMatchObject({
      code: 'TALLY_COMPANY_NOT_OPEN',
      message: expect.stringContaining('"Prem Supermarket"'),
    });
  });
});
