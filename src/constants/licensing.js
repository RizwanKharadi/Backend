/** Commercial licensing defaults (confirmed product decisions). */
export const TRIAL_DAYS = 7;
export const TRIAL_SEAT_LIMIT = 1;
export const GRACE_PERIOD_DAYS = 2;

/** Set LICENSE_ENFORCEMENT=false to disable gates in development. */
export const isLicenseEnforcementEnabled = () => {
  if (process.env.LICENSE_ENFORCEMENT === 'false') {
    return false;
  }
  if (process.env.LICENSE_ENFORCEMENT === 'true') {
    return true;
  }
  return process.env.NODE_ENV === 'production';
};
