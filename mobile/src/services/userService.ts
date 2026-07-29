import { apiClient } from './apiClient';
import { normalizeUser } from './authService';
import { User } from '../types';

export const userService = {
  async getProfile(): Promise<User> {
    const res = await apiClient.get('/auth/profile');
    const raw = res.data?.data?.user;
    return normalizeUser(raw);
  },
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<{ success: boolean; message?: string }> {
    const res = await apiClient.put(`/users/${userId}/change-password`, {
      currentPassword,
      newPassword,
    });
    return res.data;
  },

  async resendEmailVerification(): Promise<{
    success: boolean;
    message?: string;
    verificationToken?: string;
  }> {
    const res = await apiClient.post('/auth/resend-verification');
    return res.data;
  },
};

export default userService;
