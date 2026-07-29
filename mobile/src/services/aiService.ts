import { apiClient } from './apiClient';
import { store } from '../store';

interface AiChatRequest {
  question: string;
}

interface AiChatResponse {
  success: boolean;
  data?: {
    intent: string | null;
    summary: any;
    answer: string;
  };
  message?: string;
}

export const aiService = {
  async askBusiness(question: string): Promise<AiChatResponse> {
    const state = store.getState();
    const companyId = state.company.selectedCompany?.id;

    const payload: AiChatRequest & { companyId?: string } = { question };
    if (companyId) {
      payload.companyId = companyId;
    }

    const response = await apiClient.post<AiChatResponse>('/ai/chat', payload);
    return response.data;
  },
};

