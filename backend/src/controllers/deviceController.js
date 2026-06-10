import {
  activateDevice,
  revokeDevice,
  listOrganizationDevices,
  getLicenseStatusForUser,
  checkDeviceLicense,
  verifyDeviceToken,
  isLicenseEnforcementEnabled
} from '../services/licenseService.js';

/**
 * @route POST /api/devices/activate
 */
export const activateDeviceHandler = async (req, res) => {
  try {
    const { agentId, machineFingerprint, hostname, os, agentVersion } = req.body;

    if (!agentId || typeof agentId !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'agentId is required'
      });
    }

    const result = await activateDevice({
      user: req.user,
      agentId: agentId.trim(),
      machineFingerprint,
      hostname,
      os,
      agentVersion
    });

    res.status(200).json({
      success: true,
      message: 'Device activated successfully',
      data: {
        agentId: result.deviceLicense.agentId,
        deviceToken: result.deviceToken,
        organizationId: result.organizationId,
        seatLimit: result.seatLimit,
        seatsUsed: result.seatsUsed,
        subscriptionStatus: result.subscription.status,
        trialEndsAt: result.subscription.trialEndsAt
      }
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Device activation failed'
    });
  }
};

/**
 * @route GET /api/devices/license-status
 */
export const licenseStatusHandler = async (req, res) => {
  try {
    const { agentId } = req.query;
    const status = await getLicenseStatusForUser(req.user, agentId);
    res.status(200).json({
      success: true,
      data: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to get license status'
    });
  }
};

/**
 * @route GET /api/devices/license-status/agent
 * Public-ish: device token or agentId check for desktop agent heartbeat.
 */
export const agentLicenseStatusHandler = async (req, res) => {
  try {
    const agentId = req.query.agentId || req.body?.agentId;

    if (req.headers.authorization?.startsWith('Bearer ')) {
      const token = req.headers.authorization.split(' ')[1];
      try {
        const decoded = verifyDeviceToken(token);
        const check = await checkDeviceLicense(decoded.agentId);
        return res.status(200).json({
          success: true,
          data: {
            agentId: decoded.agentId,
            allowed: check.allowed,
            reason: check.reason,
            subscriptionStatus: check.subscriptionStatus,
            enforcement: isLicenseEnforcementEnabled()
          }
        });
      } catch {
        // fall through to user auth path
      }
    }

    if (!agentId) {
      return res.status(400).json({
        success: false,
        message: 'agentId or device Bearer token required'
      });
    }

    const check = await checkDeviceLicense(agentId);
    res.status(200).json({
      success: true,
      data: {
        agentId,
        allowed: check.allowed,
        reason: check.reason,
        subscriptionStatus: check.subscriptionStatus,
        enforcement: isLicenseEnforcementEnabled()
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to check agent license'
    });
  }
};

/**
 * @route GET /api/devices
 */
export const listDevicesHandler = async (req, res) => {
  try {
    const devices = await listOrganizationDevices(req.user);
    res.status(200).json({
      success: true,
      count: devices.length,
      data: devices
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to list devices'
    });
  }
};

/**
 * @route DELETE /api/devices/:agentId
 */
export const revokeDeviceHandler = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { reason } = req.body;

    const device = await revokeDevice({
      user: req.user,
      agentId,
      reason
    });

    res.status(200).json({
      success: true,
      message: 'Device revoked',
      data: {
        agentId: device.agentId,
        status: device.status,
        revokedAt: device.revokedAt
      }
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      success: false,
      message: error.message || 'Failed to revoke device'
    });
  }
};
