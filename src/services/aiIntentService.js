import OpenAI from 'openai';
import logger from '../utils/logger.js';

let client = null;

const getClient = () => {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured');
    }
    client = new OpenAI({ apiKey });
  }
  return client;
};

const ALLOWED_INTENTS = new Set([
  'sales_range',
  'sales_today',
  'outstanding_top_customers',
  'profit_this_month',
  'expenses_trend'
]);

const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export const llmDetectIntent = async (question) => {
  const model = process.env.AI_INTENT_MODEL || process.env.AI_MODEL || 'gpt-4o-mini';

  const systemPrompt = [
    'You route accounting questions to a SAFE intent for a backend that queries MongoDB.',
    'Return STRICT JSON only, with keys: intent, params.',
    'intent must be one of: sales_range, sales_today, outstanding_top_customers, profit_this_month, expenses_trend.',
    'params must be a JSON object.',
    'For sales_range, params must include startDate and endDate in YYYY-MM-DD format.',
    'If you are not confident, return {"intent": null, "params": {}}.',
    'Do not include any explanation or extra text.'
  ].join(' ');

  const userPrompt = `Question: ${question}`;

  try {
    const openai = getClient();
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0,
      max_tokens: 120,
      response_format: { type: 'json_object' },
    });

    const content = resp.choices?.[0]?.message?.content || '';
    const parsed = JSON.parse(content);
    const intent = parsed?.intent ?? null;
    const params = parsed?.params && typeof parsed.params === 'object' ? parsed.params : {};

    if (intent == null) return { intent: null, params: {} };
    if (!ALLOWED_INTENTS.has(intent)) return { intent: null, params: {} };

    if (intent === 'sales_range') {
      const { startDate, endDate } = params;
      if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
        return { intent: null, params: {} };
      }
      return { intent, params: { startDate, endDate } };
    }

    return { intent, params: {} };
  } catch (error) {
    logger.warn('LLM intent detection failed', { error: error.message });
    return { intent: null, params: {} };
  }
};

