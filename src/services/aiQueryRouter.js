// Simple deterministic intent router for business questions.
// This never calls the LLM; it only classifies the question so we can run safe MongoDB summaries.

export const detectIntent = (rawQuestion) => {
  if (!rawQuestion || typeof rawQuestion !== 'string') {
    return null;
  }

  const q = rawQuestion.toLowerCase();

  // Sales today / this period
  if (
    (q.includes('sales') || q.includes('revenue') || q.includes('turnover')) &&
    (q.includes('today') || q.includes('current day'))
  ) {
    return 'sales_today';
  }

  // Outstanding / pending payments / receivables
  if (
    (q.includes('pending') || q.includes('overdue') || q.includes('outstanding')) &&
    (q.includes('payment') || q.includes('receivable') || q.includes('customer') || q.includes('party'))
  ) {
    return 'outstanding_top_customers';
  }
  if (q.includes('highest outstanding') || q.includes('top outstanding')) {
    return 'outstanding_top_customers';
  }

  // Profit this month
  if (
    (q.includes('profit') || q.includes('loss')) &&
    (q.includes('this month') || q.includes('current month'))
  ) {
    return 'profit_this_month';
  }

  // Expenses increasing / cost going up
  if (
    (q.includes('expense') || q.includes('cost')) &&
    (q.includes('increasing') || q.includes('going up') || q.includes('higher') || q.includes('rise'))
  ) {
    return 'expenses_trend';
  }

  return null;
};

