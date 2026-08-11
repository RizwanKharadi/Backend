import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { authService } from '../../services/authService';
import { User, LoginCredentials, RegisterData } from '../../types';

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** True after startup token validation (or no stored token) */
  sessionChecked: boolean;
  error: string | null;
  biometricEnabled: boolean;
  lastLoginTime: string | null;
}

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  sessionChecked: false,
  error: null,
  biometricEnabled: false,
  lastLoginTime: null,
};

// Async thunks
export const login = createAsyncThunk(
  'auth/login',
  async (credentials: LoginCredentials, { rejectWithValue, getState }) => {
    try {
      const response = await authService.login(credentials);
      const state = getState() as { settings?: { biometricEnabled?: boolean } };
      if (state.settings?.biometricEnabled) {
        try {
          await authService.refreshBiometricCredentials(credentials);
        } catch (error) {
          console.warn('Biometric credential refresh failed:', error);
        }
      }
      return response;
    } catch (error: any) {
      // Reject with the shape, not just the text. A correct password against an
      // unverified address has to be distinguishable from a wrong password, and
      // flattening this to a string left LoginScreen with no way to tell —
      // so it showed "login failed" and the OTP screen was unreachable.
      return rejectWithValue({
        message: error.message || 'Login failed',
        requiresVerification: Boolean(error.requiresVerification),
        email: error.email,
      });
    }
  }
);

export const register = createAsyncThunk(
  'auth/register',
  async (userData: RegisterData, { rejectWithValue }) => {
    try {
      const response = await authService.register(userData);
      return response;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Registration failed');
    }
  }
);

export const logout = createAsyncThunk(
  'auth/logout',
  async (_, { rejectWithValue }) => {
    try {
      await authService.logout();
      return true;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Logout failed');
    }
  }
);

export const refreshToken = createAsyncThunk(
  'auth/refreshToken',
  async (_, { rejectWithValue }) => {
    try {
      const response = await authService.refreshToken();
      return response;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Token refresh failed');
    }
  }
);

export const validateSession = createAsyncThunk(
  'auth/validateSession',
  async (_, { rejectWithValue }) => {
    try {
      const result = await authService.validateSession();
      if (result.valid && result.user && result.token) {
        return result;
      }
      await authService.clearLocalSession();
      return { valid: false as const };
    } catch (error: any) {
      await authService.clearLocalSession();
      return rejectWithValue(error.message || 'Session validation failed');
    }
  }
);

export const verifyBiometric = createAsyncThunk(
  'auth/verifyBiometric',
  async (_, { rejectWithValue }) => {
    try {
      const result = await authService.verifyBiometric();
      return result;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Biometric verification failed');
    }
  }
);

export const biometricLogin = createAsyncThunk(
  'auth/biometricLogin',
  async (_, { rejectWithValue }) => {
    try {
      return await authService.biometricSignIn();
    } catch (error: any) {
      return rejectWithValue(error.message || 'Biometric login failed');
    }
  }
);

// Auth slice
const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    setUser: (state, action: PayloadAction<User>) => {
      state.user = action.payload;
    },
    setBiometricEnabled: (state, action: PayloadAction<boolean>) => {
      state.biometricEnabled = action.payload;
    },
    updateLastLoginTime: (state) => {
      state.lastLoginTime = new Date().toISOString();
    },
    restoreSession: (
      state,
      action: PayloadAction<{ user: User; token: string }>
    ) => {
      state.isAuthenticated = true;
      state.user = action.payload.user;
      state.token = action.payload.token;
      state.error = null;
    },
    forceLogout: (state) => {
      state.isAuthenticated = false;
      state.user = null;
      state.token = null;
      state.error = null;
      state.isLoading = false;
    },
  },
  extraReducers: (builder) => {
    // Login
    builder
      .addCase(login.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(login.fulfilled, (state, action) => {
        state.isLoading = false;
        state.isAuthenticated = true;
        state.user = action.payload.user;
        state.token = action.payload.token;
        state.lastLoginTime = new Date().toISOString();
        state.error = null;
      })
      .addCase(login.rejected, (state, action) => {
        state.isLoading = false;
        state.isAuthenticated = false;
        // The payload is now an object; older callers still expect state.error
        // to read as plain text.
        const payload = action.payload as { message?: string } | string | undefined;
        state.error =
          typeof payload === 'string' ? payload : payload?.message || 'Login failed';
      });

    // Register
    builder
      .addCase(register.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(register.fulfilled, (state, action) => {
        state.isLoading = false;
        state.error = null;

        // Registering no longer signs you in — the account is unusable until
        // the emailed code is confirmed, so the response carries no token.
        // Flipping isAuthenticated here anyway swapped the navigator to the
        // main stack with a null token, which tore down the auth stack before
        // RegisterScreen could reach the OTP screen and then bounced back to
        // Login on the first unauthorised request.
        if (!action.payload.token) {
          state.isAuthenticated = false;
          return;
        }

        state.isAuthenticated = true;
        state.user = action.payload.user;
        state.token = action.payload.token;
        state.lastLoginTime = new Date().toISOString();
      })
      .addCase(register.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });

    // Logout
    builder
      .addCase(logout.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(logout.fulfilled, (state) => {
        state.isLoading = false;
        state.isAuthenticated = false;
        state.user = null;
        state.token = null;
        state.error = null;
      })
      .addCase(logout.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });

    // Refresh token
    builder
      .addCase(refreshToken.fulfilled, (state, action) => {
        state.token = action.payload.token;
        state.user = action.payload.user;
      })
      .addCase(refreshToken.rejected, (state) => {
        state.isAuthenticated = false;
        state.user = null;
        state.token = null;
      });

    // Biometric login (fingerprint/face + stored credentials)
    builder
      .addCase(biometricLogin.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(biometricLogin.fulfilled, (state, action) => {
        state.isLoading = false;
        state.isAuthenticated = true;
        state.user = action.payload.user;
        state.token = action.payload.token;
        state.lastLoginTime = new Date().toISOString();
        state.error = null;
      })
      .addCase(biometricLogin.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      });

    // Startup session validation
    builder
      .addCase(validateSession.pending, (state) => {
        state.isLoading = true;
      })
      .addCase(validateSession.fulfilled, (state, action) => {
        state.isLoading = false;
        state.sessionChecked = true;
        const payload = action.payload as {
          valid?: boolean;
          user?: User;
          token?: string;
        };
        if (payload?.valid && payload.user && payload.token) {
          state.isAuthenticated = true;
          state.user = payload.user;
          state.token = payload.token;
          state.error = null;
        } else {
          state.isAuthenticated = false;
          state.user = null;
          state.token = null;
        }
      })
      .addCase(validateSession.rejected, (state) => {
        state.isLoading = false;
        state.sessionChecked = true;
        state.isAuthenticated = false;
        state.user = null;
        state.token = null;
      });
  },
});

export const {
  clearError,
  setUser,
  setBiometricEnabled,
  updateLastLoginTime,
  restoreSession,
  forceLogout,
} = authSlice.actions;
export default authSlice.reducer;
