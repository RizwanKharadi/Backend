import { detectIntent } from '../services/aiQueryRouter.js';
import {
  handleSalesToday,
  handleSalesRange,
  handleOutstandingTopCustomers,
  handleProfitThisMonth,
  handleExpensesTrend
} from '../services/aiQueryHandlers.js';
import { explainSummary } from '../services/aiNarrationService.js';
import { llmDetectIntent } from '../services/aiIntentService.js';
import logger from '../utils/logger.js';

const INTENT_HANDLERS = {
  sales_today: handleSalesToday,
  sales_range: handleSalesRange,
  outstanding_top_customers: handleOutstandingTopCustomers,
  profit_this_month: handleProfitThisMonth,
  expenses_trend: handleExpensesTrend
};

export const chatWithBusiness = async (req, res) => {
  try {
    const { question } = req.body || {};
    const companyId = req.company?._id || req.companyId || req.body?.companyId || req.query?.companyId;

    if (!question || typeof question !== 'string' || question.trim().length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid question'
      });
    }

    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company context is required'
      });
    }

    let intent = detectIntent(question);
    let intentParams = {};

    // If not matched by rules, use a tiny LLM call to extract a SAFE intent + params (no accounting data sent).
    if (!intent) {
      const llm = await llmDetectIntent(question);
      intent = llm.intent;
      intentParams = llm.params || {};
    }

    if (!intent || !INTENT_HANDLERS[intent]) {
      return res.status(200).json({
        success: true,
        data: {
          intent: null,
          summary: null,
          answer: 'I could not understand that question yet. Try asking about sales for a date range (example: “sales in May 2026” or “sales from 2026-05-01 to 2026-05-31”), pending payments/highest outstanding, profit this month, or why expenses are increasing.'
        }
      });
    }

    const handler = INTENT_HANDLERS[intent];

    const { summary } = await handler(companyId, intentParams);

    // Very small prompt: only question + compact summary
    const narration = await explainSummary({ question, intent, summary });

    logger.info('AI chat answered', {
      userId: req.user?.id,
      companyId: companyId?.toString?.() || companyId,
      intent
    });

    return res.status(200).json({
      success: true,
      data: {
        intent,
        summary,
        answer: narration.answer
      }
    });
  } catch (error) {
    logger.error('AI chat error', { error: error.message });
    return res.status(500).json({
      success: false,
      message: 'Unable to answer this question right now. Please try again later.'
    });
  }
};

