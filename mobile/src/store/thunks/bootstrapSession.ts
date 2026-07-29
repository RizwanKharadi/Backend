import { createAsyncThunk } from '@reduxjs/toolkit';
import { authService, initializeRealtimeServices } from '../../services';
import { restoreSession, forceLogout } from '../slices/authSlice';
import { fetchCompanies, setSelectedCompany } from '../slices/companySlice';
import { setSelectedCompany as setPersistedCompanyId } from '../slices/settingsSlice';
import { fetchVoucherStats } from '../slices/voucherSlice';
import { fetchInventoryStats } from '../slices/inventorySlice';
import { pickDefaultCompany } from '../../utils/companySelection';
import type { RootState } from '../index';

function normalizeCompany(company: any) {
  const id = String(company.id || company._id || '');
  return { ...company, id };
}

/**
 * Restores workspace (company) after auth rehydrate and warms caches for main tabs.
 */
export const bootstrapSession = createAsyncThunk(
  'app/bootstrapSession',
  async (_, { dispatch, getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      let isAuthenticated = state.auth.isAuthenticated;

      if (!isAuthenticated) {
        const session = await authService.validateSession();
        if (!session.valid || !session.user || !session.token) {
          return { companyReady: false };
        }
        dispatch(restoreSession({ user: session.user, token: session.token }));
        isAuthenticated = true;
      }

      let list: any[] = [];
      try {
        const companies = await dispatch(fetchCompanies({})).unwrap();
        list = Array.isArray(companies) ? companies : [];
      } catch {
        list = Array.isArray(state.company.companies) ? state.company.companies : [];
      }

      let selected = state.company.selectedCompany;
      if (!selected?.id && list.length > 0) {
        const savedId = state.settings.selectedCompanyId;
        const match = savedId
          ? list.find((c: any) => String(c.id || c._id) === String(savedId))
          : null;
        const chosen = normalizeCompany(match || pickDefaultCompany(list));
        dispatch(setSelectedCompany(chosen));
        dispatch(setPersistedCompanyId(chosen.id));
        selected = chosen;
      } else if (selected?.id) {
        dispatch(setPersistedCompanyId(String(selected.id)));
      }

      if (selected?.id) {
        const companyId = String(selected.id);
        dispatch(fetchVoucherStats(companyId));
        dispatch(fetchInventoryStats(companyId));
        try {
          await initializeRealtimeServices();
        } catch {
          /* real-time optional when agent/Tally offline */
        }
      }

      return { companyReady: !!selected?.id };
    } catch (error: any) {
      const status = error?.status;
      const message = String(error?.message || '').toLowerCase();
      if (
        status === 401 ||
        message.includes('not exist') ||
        message.includes('not found') ||
        message.includes('unauthorized')
      ) {
        await authService.clearLocalSession();
        dispatch(forceLogout());
        return rejectWithValue(error.message || 'Bootstrap failed');
      }
      const fallbackCompany = (getState() as RootState).company.selectedCompany;
      if (fallbackCompany?.id) {
        return { companyReady: true };
      }
      return rejectWithValue(error.message || 'Bootstrap failed');
    }
  }
);
