import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { aiService } from '../../services/aiService';

export type AiMessageRole = 'user' | 'assistant' | 'system';

export interface AiMessage {
  id: string;
  role: AiMessageRole;
  text: string;
  timestamp: string;
}

interface AiState {
  messages: AiMessage[];
  isLoading: boolean;
  error: string | null;
}

const initialState: AiState = {
  messages: [],
  isLoading: false,
  error: null,
};

export const askBusinessQuestion = createAsyncThunk(
  'ai/askBusinessQuestion',
  async (question: string, { rejectWithValue }) => {
    try {
      const response = await aiService.askBusiness(question);
      if (!response.success || !response.data) {
        return rejectWithValue(response.message || 'Unable to get answer');
      }
      return response.data;
    } catch (error: any) {
      return rejectWithValue(error.message || 'Unable to get answer');
    }
  }
);

const aiSlice = createSlice({
  name: 'ai',
  initialState,
  reducers: {
    clearAiChat: (state) => {
      state.messages = [];
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(askBusinessQuestion.pending, (state, action) => {
        state.isLoading = true;
        state.error = null;

        const question = action.meta.arg;
        const now = new Date().toISOString();
        state.messages.push({
          id: `user-${now}`,
          role: 'user',
          text: question,
          timestamp: now,
        });
      })
      .addCase(
        askBusinessQuestion.fulfilled,
        (state, action: PayloadAction<{ intent: string | null; summary: any; answer: string }>) => {
          state.isLoading = false;
          const now = new Date().toISOString();
          state.messages.push({
            id: `assistant-${now}`,
            role: 'assistant',
            text: action.payload.answer,
            timestamp: now,
          });
        }
      )
      .addCase(askBusinessQuestion.rejected, (state, action) => {
        state.isLoading = false;
        state.error = (action.payload as string) || 'Unable to get answer';

        const now = new Date().toISOString();
        state.messages.push({
          id: `assistant-error-${now}`,
          role: 'assistant',
          text: state.error,
          timestamp: now,
        });
      });
  },
});

export const { clearAiChat } = aiSlice.actions;
export default aiSlice.reducer;

