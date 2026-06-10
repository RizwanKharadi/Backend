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

export const explainSummary = async ({ question, intent, summary }) => {
  const model = process.env.AI_MODEL || 'gpt-4o-mini';
  const maxTokens = Number(process.env.AI_MAX_OUTPUT_TOKENS || 300);

  const safeSummary = JSON.stringify(summary ?? {}, null, 2);

  const systemPrompt = [
    'You are a concise business assistant for an accounting app.',
    'The backend has already queried the accounting database and is sending you ONLY a small JSON summary.',
    'You MUST NOT invent new numbers or customers. Only explain what is present in the summary.',
    'If the summary indicates data is missing (e.g., hasReport=false), clearly say that the required report is not yet available.',
    'Keep answers short and to the point. Prefer 2-4 sentences.',
  ].join(' ');

  const userContent = [
    `User question: ${question || ''}`,
    '',
    'System intent (for your context):',
    intent || 'unknown',
    '',
    'Pre-computed business summary JSON (do not re-calc, just explain):',
    safeSummary
  ].join('\n');

  try {
    const openai = getClient();
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
    });

    const answer = response.choices?.[0]?.message?.content?.trim() || '';

    return {
      answer,
      model,
    };
  } catch (error) {
    logger.error('AI narration error', { error: error.message });
    throw new Error('Failed to generate AI explanation');
  }
};

