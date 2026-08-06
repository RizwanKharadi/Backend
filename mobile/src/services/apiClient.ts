import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import { API_BASE_URL as ENV_API_URL } from '@env';
import { authService } from './authService';
import { store } from '../store';
import { forceLogout } from '../store/slices/authSlice';
import { setOfflineMode } from '../store/slices/offlineSlice';
import { setOnlineStatus } from '../store/slices/syncSlice';
import { resolveEndpoint, PRODUCTION_API_URL } from '../utils/apiHost';

// Fallback when .env is missing, and the guard against a dev URL reaching a
// release build — see src/utils/apiHost.ts.
export const API_BASE_URL = resolveEndpoint(ENV_API_URL, PRODUCTION_API_URL, 'API_BASE_URL');

export interface ApiError {
  message: string;
  status?: number;
  code?: string;
}

class ApiClient {
  private client: AxiosInstance;
  private refreshInFlight: Promise<boolean> | null = null;

  constructor() {
    console.log('-----------------------------------------');
    console.log('🌐 API CONFIGURATION');
    console.log('URL:', API_BASE_URL);
    console.log('SOURCE:', ENV_API_URL ? '.env file' : 'Production Fallback');
    console.log('-----------------------------------------');
    
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    this.client.interceptors.request.use(
      async (config) => {
        const token = await authService.getToken();
        if (token) config.headers.Authorization = `Bearer ${token}`;
        const payload =
          config.data !== undefined
            ? config.data
            : config.params !== undefined
              ? config.params
              : {};
        console.log(
          `📤 SENDING: ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`,
          typeof payload === 'string' ? payload : JSON.stringify(payload ?? {}, null, 2)
        );
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => {
        console.log(`📥 RECEIVED: ${response.status} from ${response.config.url}`);
        this.markApiReachable();
        return response;
      },
      async (error: AxiosError) => {
        console.log('❌ NETWORK ERROR DETAILS:');
        console.log('- Message:', error.message);
        console.log('- Code:', error.code);
        console.log('- URL:', error.config?.url);
        
        if (!error.response) {
          console.log('- Reason: Server unreachable. Check if your backend is running and the IP is correct.');
        }

        this.handleNetworkError(error);
        const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };
        if (
          error.response?.status === 401 &&
          originalRequest &&
          !originalRequest._retry &&
          !String(originalRequest.url || '').includes('/auth/refresh') &&
          !String(originalRequest.url || '').includes('/auth/login')
        ) {
          originalRequest._retry = true;
          try {
            const renewed = await this.tryRefreshSession();
            if (renewed && originalRequest.headers) {
              const token = await authService.getToken();
              if (token) {
                originalRequest.headers.Authorization = `Bearer ${token}`;
              }
              return this.client.request(originalRequest);
            }
          } catch {
            // fall through to logout
          }
          void this.handleUnauthorized();
        } else if (error.response?.status === 401) {
          void this.handleUnauthorized();
        }
        return Promise.reject(this.transformError(error));
      }
    );
  }

  private async tryRefreshSession(): Promise<boolean> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = authService
        .refreshToken()
        .then(() => true)
        .catch(() => false)
        .finally(() => {
          this.refreshInFlight = null;
        });
    }
    return this.refreshInFlight;
  }

  private async handleUnauthorized(): Promise<void> {
    try {
      await authService.clearLocalSession();
      store.dispatch(forceLogout());
    } catch (e) {
      console.warn('Failed to clear session after 401:', e);
    }
  }

  /** Successful API call — leave device network state to NetInfo; clear API-offline flag */
  private markApiReachable(): void {
    const manualOffline = store.getState().settings?.offlineMode;
    if (!manualOffline) {
      store.dispatch(setOfflineMode(false));
      store.dispatch(setOnlineStatus(true));
    }
  }

  private handleNetworkError(error: AxiosError): void {
    if (error.response) return;
    // Phone may still have Wi‑Fi; only mark "can't reach backend" for cached UI
    store.dispatch(setOfflineMode(true));
    store.dispatch(setOnlineStatus(false));
  }

  private transformError(error: AxiosError): ApiError {
    if (error.response) {
      return {
        status: error.response.status,
        message: (error.response.data as any)?.message || error.message,
      };
    }
    return {
      message: 'Network error. Please check if your backend server is running and accessible.',
    };
  }

  async post<T = any>(url: string, data?: any): Promise<AxiosResponse<T>> {
    return this.client.post(url, data);
  }
  
  async get<T = any>(
  url: string,
  config?: AxiosRequestConfig
): Promise<AxiosResponse<T>> {
  return this.client.get(url, config);
}
async put<T = any>(
  url: string,
  data?: any,
  config?: AxiosRequestConfig
): Promise<AxiosResponse<T>> {
  return this.client.put(url, data, config);
}

async delete<T = any>(
  url: string,
  config?: AxiosRequestConfig
): Promise<AxiosResponse<T>> {
  return this.client.delete(url, config);
}

async download<T = any>(
  url: string,
  config?: AxiosRequestConfig
): Promise<AxiosResponse<T>> {
  return this.client.get(url, {
    ...config,
    responseType: 'blob',
  });
}
}

export const apiClient = new ApiClient();
