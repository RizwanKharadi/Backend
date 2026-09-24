import TallySerialRegistration from '../models/TallySerialRegistration.js';
import logger from '../utils/logger.js';

export function normalizeTallySerial(serialNumber) {
  if (serialNumber == null) {
    return '';
  }
  return String(serialNumber).trim().replace(/\s+/g, '').toUpperCase();
}

export function maskEmail(email) {
  if (!email || typeof email !== 'string') {
    return '';
  }
  const [local, domain] = email.split('@');
  if (!domain) {
    return '***';
  }
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}***@${domain}`;
}

/**
 * A Tally serial may be shared by any number of users, so it is never "in use".
 * Kept (with the same response shape) so the desktop agent's /check call keeps working.
 * @returns {{ inUse: false, ownedByCurrentUser?: boolean, sharedUserCount?: number }}
 */
export async function checkTallySerialInUse(serialNumber, currentUserId) {
  const normalized = normalizeTallySerial(serialNumber);
  if (!normalized) {
    return { inUse: false, reason: 'missing_serial' };
  }

  const all = await TallySerialRegistration.find({ serialNumber: normalized });
  const ownedByCurrentUser = Boolean(
    currentUserId && all.some((r) => r.user?.toString?.() === currentUserId.toString())
  );

  return { inUse: false, ownedByCurrentUser, sharedUserCount: all.length };
}

/**
 * Register or refresh a serial for the given user. One row per (serial, user),
 * so many users can share the same Tally serial. Never throws for "already registered".
 */
export async function registerTallySerial({
  serialNumber,
  userId,
  organizationId,
  email,
  licenseDetails = {}
}) {
  const normalized = normalizeTallySerial(serialNumber);
  if (!normalized) {
    return null;
  }

  const doc = await TallySerialRegistration.findOneAndUpdate(
    { serialNumber: normalized, user: userId },
    {
      serialNumber: normalized,
      user: userId,
      organization: organizationId,
      registeredEmail: email,
      licenseDetails: {
        planName: licenseDetails.planName || '',
        tallyVersion: licenseDetails.tallyVersion || '',
        tallyShortVersion: licenseDetails.tallyShortVersion || '',
        isGold: Boolean(licenseDetails.isGold),
        isSilver: Boolean(licenseDetails.isSilver),
        isTallyPrime: Boolean(licenseDetails.isTallyPrime),
        isEducationalMode: Boolean(licenseDetails.isEducationalMode),
        remoteSerialNumber: licenseDetails.remoteSerialNumber || '',
        accountId: licenseDetails.accountId || '',
        userName: licenseDetails.userName || ''
      },
      lastSeenAt: new Date()
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  logger.info('Tally serial registered', {
    serialNumber: normalized,
    userId,
    organizationId
  });

  return doc;
}

export function mapTallyLicensePayload(license = {}) {
  if (!license || typeof license !== 'object') {
    return null;
  }
  const serialNumber = license.serialNumber || license.remoteSerialNumber || '';
  if (!normalizeTallySerial(serialNumber)) {
    return null;
  }
  return {
    serialNumber,
    planName: license.planName || license.type || '',
    tallyVersion: license.tallyVersion || '',
    tallyShortVersion: license.tallyShortVersion || license.release || '',
    isGold: Boolean(license.isGold),
    isSilver: Boolean(license.isSilver),
    isTallyPrime: Boolean(license.isTallyPrime),
    isEducationalMode: Boolean(license.isEducationalMode),
    remoteSerialNumber: license.remoteSerialNumber || '',
    accountId: license.accountId || '',
    userName: license.userName || ''
  };
}
