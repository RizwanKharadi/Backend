/**
 * Choose which workspace to show after login/register when the user has access to multiple companies.
 * Prefer a company linked to Tally (sync), otherwise the most recently updated record.
 */
export function pickDefaultCompany(companies: any[]): any | null {
  if (!Array.isArray(companies) || companies.length === 0) {
    return null;
  }

  const withTally = companies.find(
    (c) =>
      c?.tallyIntegration?.companyPath ||
      c?.tallyIntegration?.enabled ||
      c?.tallyIntegration?.lastSyncDate
  );
  if (withTally) {
    return withTally;
  }

  const sorted = [...companies].sort((a, b) => {
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });

  return sorted[0];
}
