import axios, { AxiosInstance, AxiosResponse, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { toast } from 'react-hot-toast';
import Cookies from 'js-cookie';

export interface ApiRequestConfig extends InternalAxiosRequestConfig {
  /** Skip error toasts (e.g. optional ML chart data) */
  silentError?: boolean;
}

function getStoredCompanyId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const stored = localStorage.getItem('currentCompany');
    if (!stored) return undefined;
    const company = JSON.parse(stored);
    return company?._id || company?.id;
  } catch {
    return undefined;
  }
}

// Normalize API base (always ends with /api, no trailing slash)
function getApiBaseURL(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';
  const trimmed = raw.replace(/\/+$/, '');
  if (trimmed.endsWith('/api')) {
    return trimmed;
  }
  return `${trimmed}/api`;
}

const apiBaseURL = getApiBaseURL();

// Create axios instance
const api: AxiosInstance = axios.create({
  baseURL: apiBaseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    // Services may use '/api/auth/...' while baseURL already includes '/api'
    if (config.url?.startsWith('/api/')) {
      config.url = config.url.slice(4);
    }

    // Try to get token from cookies first (for SSR), then localStorage
    let token: string | undefined;
    
    if (typeof window !== 'undefined') {
      token = localStorage.getItem('token') || Cookies.get('token');
    } else {
      token = Cookies.get('token');
    }
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    const companyId = getStoredCompanyId();
    if (companyId) {
      const method = (config.method || 'get').toLowerCase();
      if (method === 'get' || method === 'delete') {
        config.params = config.params || {};
        if (!config.params.companyId) {
          if (config.params.company) {
            config.params.companyId = config.params.company;
            delete config.params.company;
          } else {
            config.params.companyId = companyId;
          }
        }
      } else if (config.data && typeof config.data === 'object' && !(config.data instanceof FormData)) {
        const data = config.data as Record<string, unknown>;
        if (!data.companyId && data.company) {
          data.companyId = data.company;
          delete data.company;
        }
      }
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle errors
api.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  (error: AxiosError) => {
    const cfg = error.config as ApiRequestConfig | undefined;
    if (cfg?.silentError) {
      return Promise.reject(error);
    }

    const { response } = error;
    
    if (response) {
      const { status, data } = response;
      
      switch (status) {
        case 401:
          // Unauthorized - clear token and redirect to login
          if (typeof window !== 'undefined') {
            localStorage.removeItem('token');
            Cookies.remove('token');
            
            if (window.location.pathname !== '/login') {
              toast.error('Session expired. Please login again.');
              window.location.href = '/login';
            }
          }
          break;
          
        case 403:
          // Forbidden
          toast.error((data as any)?.message || 'Access denied');
          break;
          
        case 404:
          // Not found
          toast.error((data as any)?.message || 'Resource not found');
          break;
          
        case 422:
          // Validation error
          if ((data as any)?.errors && Array.isArray((data as any).errors)) {
            (data as any).errors.forEach((err: any) => 
              toast.error(err.msg || err.message)
            );
          } else {
            toast.error((data as any)?.message || 'Validation failed');
          }
          break;
          
        case 429:
          // Rate limit exceeded
          toast.error('Too many requests. Please try again later.');
          break;
          
        case 500:
          // Server error
          toast.error('Server error. Please try again later.');
          break;
          
        default:
          // Other errors
          toast.error((data as any)?.message || 'An error occurred');
      }
    } else if (error.request) {
      // Network error
      toast.error('Network error. Please check your connection.');
    } else {
      // Other error
      toast.error('An unexpected error occurred');
    }
    
    return Promise.reject(error);
  }
);

// Helper function to set auth token
export const setAuthToken = (token: string) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('token', token);
  }
  Cookies.set('token', token, { expires: 7 }); // 7 days
};

// Helper function to remove auth token
export const removeAuthToken = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('token');
  }
  Cookies.remove('token');
};

// Helper function to get auth token
export const getAuthToken = (): string | null => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('token') || Cookies.get('token') || null;
  }
  return Cookies.get('token') || null;
};

export default api;
