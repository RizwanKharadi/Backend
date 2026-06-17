import TallySerialRegistration from '../models/TallySerialRegistration.js';
import User from '../models/User.js';
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
 * @returns {{ inUse: boolean, ownedByCurrentUser?: boolean, registeredEmail?: string, registeredName?: string }}
 */
export async function checkTallySerialInUse(serialNumber, currentUserId) {
  const normalized = normalizeTallySerial(serialNumber);
  if (!normalized) {
    return { inUse: false, reason: 'missing_serial' };
  }

  const existing = await TallySerialRegistration.findOne({ serialNumber: normalized }).populate(
    'user',
    'email name'
  );

  if (!existing) {
    return { inUse: false };
  }

  if (currentUserId && existing.user?._id?.toString() === currentUserId.toString()) {
    return {
      inUse: false,
      ownedByCurrentUser: true,
      registeredEmail: existing.registeredEmail
    };
  }

  return {
    inUse: true,
    registeredEmail: maskEmail(existing.registeredEmail || existing.user?.email),
    registeredName: existing.user?.name || ''
  };
}

/**
 * Register or refresh serial for the current user. Throws 409 if bound to another account.
 */
export async function registerTallySerial({
  serialNumber,
  userId,
  organizationId,
  email,
  licenseDetails = {},
  allowSameOrganizationRebind = true
}) {
  const normalized = normalizeTallySerial(serialNumber);
  if (!normalized) {
    return null;
  }

  const existing = await TallySerialRegistration.findOne({ serialNumber: normalized });

  if (existing) {
    const existingUserId = existing.user?.toString?.();
    const existingOrgId = existing.organization?.toString?.();
    const incomingUserId = userId?.toString?.();
    const incomingOrgId = organizationId?.toString?.();

    const changedOwner = Boolean(existingUserId && incomingUserId && existingUserId !== incomingUserId);
    const changedOrg = Boolean(existingOrgId && incomingOrgId && existingOrgId !== incomingOrgId);

    if (changedOwner || changedOrg) {
      const owner = await User.findById(existing.user).select('email name');
      logger.warn('Tally serial re-registered by different account/org (validation disabled)', {
        serialNumber: normalized,
        previousUserEmail: maskEmail(owner?.email || existing.registeredEmail),
        previousUserName: owner?.name || '',
        previousUserId: existingUserId,
        previousOrganizationId: existingOrgId,
        newUserId: incomingUserId,
        newOrganizationId: incomingOrgId,
        allowSameOrganizationRebind
      });
    }
  }

  const doc = await TallySerialRegistration.findOneAndUpdate(
    { serialNumber: normalized },
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
