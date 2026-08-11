import AsyncStorage from '@react-native-async-storage/async-storage';
import EncryptedStorage from 'react-native-encrypted-storage';
import ReactNativeBiometrics from 'react-native-biometrics';
import { apiClient } from './apiClient';
import { LoginCredentials, RegisterData, AuthResponse, User, OtpPurpose } from '../types';

const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'auth_refresh_token';
const USER_KEY = 'user_data';
const BIOMETRIC_KEY = 'biometric_credentials';

/** Map API user object to app User type (handles missing isActive / dates). */
export function normalizeUser(raw: Record<string, unknown> | null | undefined): User {
  if (!raw) {
    return {
      id: '',
      name: '',
      email: '',
      phone: '',
      role: 'user',
      isEmailVerified: false,
      isActive: true,
      companies: [],
      createdAt: '',
      updatedAt: '',
    };
  }
  return {
    id: String(raw.id || raw._id || ''),
    name: String(raw.name || ''),
    email: String(raw.email || ''),
    phone: String(raw.phone || ''),
    role: (raw.role as User['role']) || 'user',
    isEmailVerified: Boolean(raw.isEmailVerified),
    isActive: raw.isActive !== false,
    companies: Array.isArray(raw.companies) ? (raw.companies as string[]) : [],
    createdAt: raw.createdAt ? String(raw.createdAt) : '',
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : '',
    lastLogin: raw.lastLogin ? String(raw.lastLogin) : null,
  };
}

class AuthService {
  private biometrics: ReactNativeBiometrics;

  constructor() {
    this.biometrics = new ReactNativeBiometrics({
      allowDeviceCredentials: true,
    });
  }

  private normalizeCredentials(credentials: LoginCredentials): LoginCredentials {
    return {
      email: (credentials.email || '').toLowerCase().trim(),
      password: credentials.password ?? '',
      rememberMe: credentials.rememberMe ?? true,
    };
  }

  /**
   * Login user with email and password
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const normalized = this.normalizeCredentials(credentials);
    if (!normalized.email || !normalized.password) {
      throw new Error('Email and password are required');
    }

    try {
      const response = await apiClient.post('/auth/login', normalized);
      
      if (response.data.success) {
        const { token, refreshToken, user: rawUser } = response.data.data;
        const user = normalizeUser(rawUser);
        
        await EncryptedStorage.setItem(TOKEN_KEY, token);
        if (refreshToken) {
          await EncryptedStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
        }
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
        
        if (normalized.rememberMe) {
          await this.storeBiometricCredentials(normalized);
        }
        
        return {
          success: true,
          token,
          refreshToken: refreshToken || null,
          user,
        };
      }
      
      throw new Error(response.data.message || 'Login failed');
    } catch (error: any) {
      // A 403 with requiresVerification means the password was right but the
      // address is unverified. Flag it on the thrown error so the screen can
      // open the OTP flow instead of showing "wrong password".
      const data = error.response?.data;
      const err = new Error(data?.message || error.message || 'Login failed') as Error & {
        requiresVerification?: boolean;
        email?: string;
      };
      if (data?.requiresVerification) {
        err.requiresVerification = true;
        err.email = data.email || normalized.email;
      }
      throw err;
    }
  }

  /**
   * Register new user
   */
  async register(userData: RegisterData): Promise<AuthResponse> {
    const normalized: RegisterData = {
      ...userData,
      email: (userData.email || '').toLowerCase().trim(),
      name: (userData.name || '').trim(),
      phone: (userData.phone || '').trim(),
    };
    try {
      const response = await apiClient.post('/auth/register', normalized);

      // Registration no longer returns a session: the account is unusable until
      // the emailed OTP is confirmed. The caller routes to the OTP screen.
      if (response.data.success && response.data.requiresVerification) {
        return {
          success: true,
          requiresVerification: true,
          email: response.data.email || normalized.email,
          token: null,
          refreshToken: null,
          user: null,
        } as AuthResponse;
      }

      if (response.data.success) {
        const { token, refreshToken, user: rawUser } = response.data.data;
        const user = normalizeUser(rawUser);
        
        await EncryptedStorage.setItem(TOKEN_KEY, token);
        if (refreshToken) {
          await EncryptedStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
        }
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
        
        return {
          success: true,
          token,
          refreshToken: refreshToken || null,
          user,
        };
      }
      
      throw new Error(response.data.message || 'Registration failed');
    } catch (error: any) {
      const apiErrors = error.response?.data?.errors;
      const firstMsg =
        Array.isArray(apiErrors) && apiErrors.length > 0
          ? apiErrors[0]?.msg || apiErrors[0]?.message
          : null;
      throw new Error(
        firstMsg ||
          error.response?.data?.message ||
          error.message ||
          'Registration failed'
      );
    }
  }

  /**
   * Logout user
   */
  async logout(): Promise<void> {
    try {
      // Call logout endpoint
      await apiClient.post('/auth/logout');
    } catch (error) {
      // Continue with local logout even if API call fails
      console.warn('Logout API call failed:', error);
    } finally {
      // Clear local storage
      await this.clearAuthData();
    }
  }

  /**
   * Refresh authentication token
   */
  async refreshToken(): Promise<AuthResponse> {
    try {
      const storedRefresh = await EncryptedStorage.getItem(REFRESH_TOKEN_KEY);
      if (!storedRefresh) {
        throw new Error('Please sign in again.');
      }

      const response = await apiClient.post('/auth/refresh', {
        refreshToken: storedRefresh,
      });
      
      if (response.data.success) {
        const { token, refreshToken, user: rawUser } = response.data.data;
        const user = normalizeUser(rawUser);
        
        await EncryptedStorage.setItem(TOKEN_KEY, token);
        if (refreshToken) {
          await EncryptedStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
        }
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
        
        return {
          success: true,
          token,
          refreshToken: refreshToken || storedRefresh,
          user,
        };
      }
      
      throw new Error('Token refresh failed');
    } catch (error: any) {
      // Clear auth data if refresh fails
      await this.clearAuthData();
      throw new Error(error.response?.data?.message || 'Token refresh failed');
    }
  }

  /**
   * Get stored authentication token
   */
  async getToken(): Promise<string | null> {
    try {
      return await EncryptedStorage.getItem(TOKEN_KEY);
    } catch (error) {
      console.error('Failed to get token:', error);
      return null;
    }
  }

  /**
   * Get stored user data
   */
  async getUser(): Promise<User | null> {
    try {
      const userData = await AsyncStorage.getItem(USER_KEY);
      return userData ? JSON.parse(userData) : null;
    } catch (error) {
      console.error('Failed to get user data:', error);
      return null;
    }
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return !!token;
  }

  /**
   * Verify password with the server, then store credentials for biometric login.
   */
  async enableBiometricLogin(credentials: LoginCredentials): Promise<boolean> {
    const normalized = this.normalizeCredentials(credentials);
    if (!normalized.email || !normalized.password) {
      throw new Error('Email and password are required');
    }

    const { available } = await this.biometrics.isSensorAvailable();
    if (!available) {
      throw new Error('Biometric authentication is not available on this device');
    }

    let response;
    try {
      response = await apiClient.post('/auth/login', normalized);
    } catch (error: any) {
      throw new Error(
        error?.response?.data?.message || error?.message || 'Invalid credentials'
      );
    }

    if (!response.data?.success) {
      throw new Error(response.data?.message || 'Invalid credentials');
    }

    const { token, user } = response.data.data;
    await EncryptedStorage.setItem(TOKEN_KEY, token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));

    try {
      await this.biometrics.createKeys();
    } catch (error) {
      console.warn('Biometric key creation skipped:', error);
    }

    await this.storeBiometricCredentials(normalized);
    return true;
  }

  /**
   * Update stored credentials after a successful password login (no extra API call).
   */
  async refreshBiometricCredentials(credentials: LoginCredentials): Promise<void> {
    const { available } = await this.biometrics.isSensorAvailable();
    if (!available) return;
    await this.storeBiometricCredentials(credentials);
  }

  /**
   * Setup biometric authentication (alias — validates password before storing).
   */
  async setupBiometric(credentials: LoginCredentials): Promise<boolean> {
    return this.enableBiometricLogin(credentials);
  }

  /**
   * Biometric prompt + login using stored credentials.
   */
  async biometricSignIn(): Promise<AuthResponse> {
    const { available } = await this.biometrics.isSensorAvailable();
    if (!available) {
      throw new Error('Biometric authentication is not available on this device');
    }

    const { success } = await this.biometrics.simplePrompt({
      promptMessage: 'Sign in with biometrics',
      cancelButtonText: 'Cancel',
    });

    if (!success) {
      throw new Error('Biometric verification was cancelled');
    }

    const credentials = await this.getBiometricCredentials();
    if (!credentials?.email || !credentials?.password) {
      throw new Error(
        'No saved login found. Sign in with your password, then enable biometrics in Settings.'
      );
    }

    try {
      return await this.login(credentials);
    } catch (error: any) {
      const msg = String(error?.message || '').toLowerCase();
      if (msg.includes('invalid credentials')) {
        await this.clearBiometricCredentials();
        throw new Error(
          'Saved password is incorrect or outdated. Sign in with your password, then turn biometrics off and on again in Settings.'
        );
      }
      throw error;
    }
  }

  /**
   * Remove stored biometric login credentials (settings toggle off / logout optional)
   */
  async clearBiometricCredentials(): Promise<void> {
    try {
      await EncryptedStorage.removeItem(BIOMETRIC_KEY);
    } catch (error) {
      console.error('Failed to clear biometric credentials:', error);
    }
  }

  /**
   * Whether email/password are stored for biometric sign-in
   */
  async hasBiometricCredentials(): Promise<boolean> {
    return this.hasStoredBiometricCredentials();
  }

  /**
   * Verify biometric authentication
   */
  async verifyBiometric(): Promise<{ success: boolean; credentials?: LoginCredentials }> {
    try {
      const { available } = await this.biometrics.isSensorAvailable();
      
      if (!available) {
        throw new Error('Biometric authentication not available');
      }

      // Prompt for biometric verification
      const { success } = await this.biometrics.simplePrompt({
        promptMessage: 'Verify your identity',
        cancelButtonText: 'Cancel',
      });

      if (success) {
        const credentials = await this.getBiometricCredentials();
        if (!credentials?.email || !credentials?.password) {
          return { success: false };
        }
        return { success: true, credentials };
      }

      return { success: false };
    } catch (error) {
      console.error('Biometric verification failed:', error);
      return { success: false };
    }
  }

  /**
   * Check if biometric is available and enabled
   */
  async isBiometricAvailable(): Promise<boolean> {
    try {
      const { available } = await this.biometrics.isSensorAvailable();
      const hasCredentials = await this.hasStoredBiometricCredentials();
      return available && hasCredentials;
    } catch (error) {
      return false;
    }
  }

  /**
   * Store biometric credentials securely
   */
  private async storeBiometricCredentials(credentials: LoginCredentials): Promise<void> {
    const normalized = this.normalizeCredentials(credentials);
    await EncryptedStorage.setItem(BIOMETRIC_KEY, JSON.stringify(normalized));
  }

  /**
   * Get stored biometric credentials
   */
  private async getBiometricCredentials(): Promise<LoginCredentials | null> {
    try {
      const data = await EncryptedStorage.getItem(BIOMETRIC_KEY);
      if (!data) return null;
      const parsed = JSON.parse(data) as LoginCredentials;
      const normalized = this.normalizeCredentials(parsed);
      if (!normalized.email || !normalized.password) {
        return null;
      }
      return normalized;
    } catch (error) {
      console.error('Failed to get biometric credentials:', error);
      return null;
    }
  }

  /**
   * Email saved for biometric login (for login form prefill).
   */
  async getStoredBiometricEmail(): Promise<string | null> {
    const credentials = await this.getBiometricCredentials();
    return credentials?.email ?? null;
  }

  /**
   * Check if biometric credentials are stored
   */
  private async hasStoredBiometricCredentials(): Promise<boolean> {
    const credentials = await this.getBiometricCredentials();
    return !!(credentials?.email && credentials?.password);
  }

  /**
   * Validate stored token against backend (user still exists).
   */
  async validateSession(): Promise<{ valid: boolean; user?: User; token?: string }> {
    const token = await this.getToken();
    if (!token) {
      return { valid: false };
    }
    try {
      const response = await apiClient.get('/auth/profile');
      if (response.data?.success) {
        const user = normalizeUser(response.data.data.user);
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
        return { valid: true, user, token };
      }
    } catch (error: any) {
      const status = error?.status ?? error?.response?.status;
      const message = String(
        error?.message || error?.response?.data?.message || ''
      ).toLowerCase();
      if (
        status === 401 ||
        status === 404 ||
        message.includes('not exist') ||
        message.includes('not found') ||
        message.includes('invalid token')
      ) {
        await this.clearLocalSession();
      }
    }
    return { valid: false };
  }

  /** Clear local credentials without calling logout API */
  async clearLocalSession(): Promise<void> {
    await this.clearAuthData();
  }

  /**
   * Clear session tokens only — keep biometric credentials so sign-in with
   * fingerprint/face still works after logout.
   */
  private async clearAuthData(): Promise<void> {
    try {
      await Promise.all([
        EncryptedStorage.removeItem(TOKEN_KEY),
        EncryptedStorage.removeItem(REFRESH_TOKEN_KEY),
        AsyncStorage.removeItem(USER_KEY),
      ]);
    } catch (error) {
      console.error('Failed to clear auth data:', error);
    }
  }

  /**
   * Confirm an emailed OTP.
   *
   * For `email_verification` the server hands back a session, because verifying
   * is the final step of signing up — the user should not have to type their
   * password again. For `password_reset` it returns a short-lived ticket that
   * authorises exactly one password change.
   */
  async verifyOtp(
    email: string,
    otp: string,
    purpose: OtpPurpose
  ): Promise<{ success: boolean; resetTicket?: string; user?: User }> {
    try {
      const response = await apiClient.post('/auth/verify-otp', {
        email: email.toLowerCase().trim(),
        otp: otp.trim(),
        purpose,
      });

      const data = response.data?.data || {};

      if (purpose === 'email_verification' && data.token) {
        const user = normalizeUser(data.user);
        await EncryptedStorage.setItem(TOKEN_KEY, data.token);
        if (data.refreshToken) {
          await EncryptedStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
        }
        await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
        return { success: true, user };
      }

      return { success: true, resetTicket: data.resetTicket };
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || error.message || 'Could not verify that code'
      );
    }
  }

  /** Ask for a new OTP. The server enforces the cooldown. */
  async resendOtp(email: string, purpose: OtpPurpose): Promise<{ message: string }> {
    try {
      const response = await apiClient.post('/auth/resend-otp', {
        email: email.toLowerCase().trim(),
        purpose,
      });
      return { message: response.data?.message || 'Code sent' };
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || error.message || 'Could not send a new code'
      );
    }
  }

  /** Start a password reset. Always succeeds, whether or not the account exists. */
  async forgotPassword(email: string): Promise<{ message: string }> {
    try {
      const response = await apiClient.post('/auth/forgot-password', {
        email: email.toLowerCase().trim(),
      });
      return { message: response.data?.message || 'Check your email' };
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || error.message || 'Could not start password reset'
      );
    }
  }

  /** Finish a password reset with the ticket from verifyOtp. */
  async resetPassword(
    resetTicket: string,
    password: string
  ): Promise<{ success: boolean; user: User }> {
    try {
      const response = await apiClient.post('/auth/reset-password', {
        resetTicket,
        password,
      });

      const { token, refreshToken, user: rawUser } = response.data.data;
      const user = normalizeUser(rawUser);

      await EncryptedStorage.setItem(TOKEN_KEY, token);
      if (refreshToken) {
        await EncryptedStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      }
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));

      return { success: true, user };
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || error.message || 'Could not update your password'
      );
    }
  }

  /**
   * Whether the login screen should offer biometric sign-in.
   */
  async canUseBiometricLogin(): Promise<boolean> {
    try {
      const { available } = await this.biometrics.isSensorAvailable();
      if (!available) return false;
      return this.hasStoredBiometricCredentials();
    } catch {
      return false;
    }
  }
}

export const authService = new AuthService();
