import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { body, validationResult } from 'express-validator';
import User from '../models/User.js';
import Company from '../models/Company.js';
import Subscription from '../models/Subscription.js';
import Organization from '../models/Organization.js';
import { protect, optionalAuth } from '../middleware/auth.js';
import { createTrialOrganization } from '../services/licenseService.js';
import {
  registerTallySerial,
  mapTallyLicensePayload
} from '../services/tallySerialService.js';
import logger from '../utils/logger.js';
import { serializeUser } from '../utils/serializeUser.js';
import {
  issueOtp,
  verifyOtp,
  clearOtp,
  OTP_PURPOSES,
  OTP_ERRORS,
  OTP_CONFIG,
} from '../services/otpService.js';
import { sendOtpEmail } from '../services/otpEmail.js';
import {
  createSession,
  describeSession,
  findBlockingSession,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  rotateRefreshToken,
} from '../services/sessionService.js';

const router = express.Router();

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - phone
 *               - password
 *               - companyName
 *             properties:
 *               name:
 *                 type: string
 *                 example: John Doe
 *               email:
 *                 type: string
 *                 example: john@example.com
 *               phone:
 *                 type: string
 *                 example: +919876543210
 *               password:
 *                 type: string
 *                 example: password123
 *               companyName:
 *                 type: string
 *                 example: Acme Corporation
 *               companyDetails:
 *                 type: object
 *                 properties:
 *                   address:
 *                     type: string
 *                   city:
 *                     type: string
 *                   state:
 *                     type: string
 *                   pincode:
 *                     type: string
 *                   businessType:
 *                     type: string
 *                   industry:
 *                     type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error or user already exists
 *       500:
 *         description: Server error
 */
// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
router.post('/register', [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('phone').isMobilePhone().withMessage('Please provide a valid phone number'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('companyName')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Company name must be between 2 and 100 characters when provided')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      name,
      email,
      phone,
      password,
      companyName = '',
      companyDetails = {},
      tallyLicense
    } = req.body;
    const trimmedCompanyName = typeof companyName === 'string' ? companyName.trim() : '';
    const licensePayload = mapTallyLicensePayload(tallyLicense);

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { phone }] 
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email or phone number'
      });
    }

    const orgDisplayName =
      trimmedCompanyName.length >= 2 ? trimmedCompanyName : `${name}'s Organization`;

    // Create user first, then trial organization (7 days, 1 device seat)
    const user = await User.create({
      name,
      email,
      phone,
      password,
      role: 'admin',
      isEmailVerified: false
    });

    const { organization, subscription } = await createTrialOrganization({
      name: orgDisplayName,
      billingEmail: email,
      createdBy: user._id
    });

    if (companyDetails && typeof companyDetails === 'object' && Object.keys(companyDetails).length > 0) {
      if (!(organization.metadata instanceof Map)) {
        organization.metadata = new Map(Object.entries(organization.metadata || {}));
      }
      organization.metadata.set('registrationDetails', JSON.stringify(companyDetails));
      await organization.save();
    }

    if (licensePayload?.serialNumber) {
      try {
        await registerTallySerial({
          serialNumber: licensePayload.serialNumber,
          userId: user._id,
          organizationId: organization._id,
          email,
          licenseDetails: licensePayload
        });
      } catch (serialErr) {
        await User.findByIdAndDelete(user._id);
        await Subscription.deleteOne({ _id: subscription._id });
        await Organization.deleteOne({ _id: organization._id });
        return res.status(500).json({
          success: false,
          message: serialErr?.message || 'Server error'
        });
      }
    }

    user.organizationId = organization._id;
    await user.save();

    let createdCompany = null;
    if (trimmedCompanyName.length >= 2) {
      createdCompany = await Company.create({
        name: trimmedCompanyName,
        organizationId: organization._id,
        address: {
          line1: companyDetails.address || 'Not specified',
          city: companyDetails.city || 'Not specified',
          state: companyDetails.state || 'Not specified',
          pincode: companyDetails.pincode || '400001'
        },
        contact: {
          phone: phone,
          email: email
        },
        businessType: companyDetails.businessType || 'other',
        industry: companyDetails.industry || 'Other',
        financialYear: {
          startDate: new Date(new Date().getFullYear(), 3, 1), // April 1st
          endDate: new Date(new Date().getFullYear() + 1, 2, 31) // March 31st
        },
        createdBy: user._id,
        users: [{
          user: user._id,
          role: 'admin',
          permissions: {
            vouchers: { create: true, read: true, update: true, delete: true },
            inventory: { create: true, read: true, update: true, delete: true },
            reports: { financial: true, inventory: true, gst: true, analytics: true }
          }
        }]
      });

      user.companies.push(createdCompany._id);
      await user.save();
    }

    // Email verification is now by OTP. No session is issued here: the account
    // cannot be used until the code is confirmed, so handing back a JWT would
    // defeat the point of verifying at all.
    const issued = await issueOtp(email, OTP_PURPOSES.EMAIL_VERIFICATION);
    if (issued.ok) {
      await sendOtpEmail({
        to: email,
        name,
        code: issued.code,
        purpose: OTP_PURPOSES.EMAIL_VERIFICATION,
        expiresInMinutes: issued.expiresInMinutes,
      });
    }

    logger.info(`New user registered (pending verification): ${email}`);

    const userOut = await User.findById(user._id)
      .select('-password')
      .populate('companies', 'name isActive');

    res.status(201).json({
      success: true,
      message:
        'Account created. Enter the 6-digit code we emailed you to verify your address.',
      requiresVerification: true,
      email,
      data: {
        user: serializeUser(userOut),
        company: createdCompany
          ? {
              id: createdCompany._id,
              name: createdCompany.name
            }
          : null,
        organization: {
          id: organization._id,
          name: organization.name,
          status: organization.status
        },
        subscription: {
          status: subscription.status,
          seatLimit: subscription.seatLimit,
          trialEndsAt: subscription.trialEndsAt,
          currentPeriodEnd: subscription.currentPeriodEnd,
          mobileIncluded: true
        },
        tallySerial: licensePayload?.serialNumber
          ? { serialNumber: licensePayload.serialNumber, registered: true }
          : null
      }
    });

  } catch (error) {
    logger.error('Registration error:', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors || {}).map((e) => e.message);
      return res.status(400).json({
        success: false,
        message: messages[0] || 'Validation failed',
        errors: messages
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
});

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Check for user
    const user = await User.findOne({ email })
      .select('+password')
      .populate('companies', 'name isActive');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if account is locked
    if (user.isLocked) {
      return res.status(423).json({
        success: false,
        message: 'Account is temporarily locked due to too many failed login attempts'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }

    // Check password
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      try {
        await user.incLoginAttempts();
      } catch (error) {
        logger.error('Error incrementing login attempts:', error);
        // Continue with the response even if incrementing fails
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Credentials are good, but an unverified address cannot hold a session.
    // Existing accounts were grandfathered to verified by the backfill script,
    // so this only ever gates people who signed up after OTP shipped.
    if (!user.isEmailVerified) {
      const issued = await issueOtp(user.email, OTP_PURPOSES.EMAIL_VERIFICATION);
      if (issued.ok) {
        await sendOtpEmail({
          to: user.email,
          name: user.name,
          code: issued.code,
          purpose: OTP_PURPOSES.EMAIL_VERIFICATION,
          expiresInMinutes: issued.expiresInMinutes,
        });
      }
      // 403 rather than 401: the credentials were correct. Clients branch on
      // requiresVerification to open the OTP screen instead of showing
      // "wrong password".
      return res.status(403).json({
        success: false,
        requiresVerification: true,
        email: user.email,
        message: 'Please verify your email. We have sent you a 6-digit code.',
      });
    }

    // Reset login attempts on successful login
    if (user.loginAttempts > 0) {
      try {
        await user.resetLoginAttempts();
      } catch (error) {
        logger.error('Error resetting login attempts:', error);
        // Continue with successful login even if reset fails
      }
    }

    // One device at a time. A session on another device blocks this sign-in
    // until it is released — either that device logs out, or this one takes
    // over deliberately. Without the takeover path a lost or wiped phone would
    // lock the account permanently, since there is nothing left to log out of.
    const device = req.body.device || {};
    const deviceId = device.deviceId || null;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: 'This app version is no longer supported. Please update.',
        code: 'DEVICE_ID_REQUIRED',
      });
    }

    const blocking = await findBlockingSession(user._id, deviceId);

    if (blocking && !req.body.forceLogin) {
      return res.status(409).json({
        success: false,
        code: 'SESSION_ACTIVE_ELSEWHERE',
        message: 'This account is signed in on another device.',
        activeDevice: describeSession(blocking),
      });
    }

    if (blocking) {
      await revokeOtherSessions(user._id, deviceId, 'signed_in_elsewhere');
    }

    // Reset login attempts on successful login
    if (user.loginAttempts > 0) {
      try {
        await user.resetLoginAttempts();
      } catch (error) {
        logger.error('Error resetting login attempts:', error);
        // Continue with successful login even if reset fails
      }
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    const { token, refreshToken } = await createSession({
      userId: user._id,
      device,
      ip: req.ip,
    });

    logger.info(`User logged in: ${email}`, { deviceId, tookOver: Boolean(blocking) });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        refreshToken,
        user: serializeUser(user)
      }
    });

  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// @desc    Refresh access token (desktop/mobile — no password needed)
// @route   POST /api/auth/refresh
// @access  Public (requires valid refresh token)
router.post('/refresh', [
  body('refreshToken').notEmpty().withMessage('refreshToken is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { refreshToken } = req.body;

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    } catch (error) {
      const expired = error?.name === 'TokenExpiredError';
      return res.status(401).json({
        success: false,
        message: expired
          ? 'Your session has expired. Please sign in again.'
          : 'Invalid session. Please sign in again.',
        code: expired ? 'REFRESH_TOKEN_EXPIRED' : 'REFRESH_TOKEN_INVALID'
      });
    }

    if (decoded.type !== 'refresh' || !decoded.id) {
      return res.status(401).json({
        success: false,
        message: 'Invalid session. Please sign in again.',
        code: 'REFRESH_TOKEN_INVALID'
      });
    }

    const user = await User.findById(decoded.id)
      .select('-password')
      .populate('companies', 'name isActive');

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account not found or deactivated. Please sign in again.',
        code: 'USER_INACTIVE'
      });
    }

    if (!decoded.sid) {
      return res.status(401).json({
        success: false,
        message: 'Please sign in again.',
        code: 'SESSION_REQUIRED'
      });
    }

    // Rotating on every use means a refresh token is valid exactly once. If one
    // is presented a second time it was either replayed or copied to another
    // device, and rotateRefreshToken kills the session rather than renewing it.
    const rotated = await rotateRefreshToken({
      userId: decoded.id,
      sessionId: decoded.sid,
      presentedToken: refreshToken,
      ip: req.ip,
    });

    if (!rotated.ok) {
      return res.status(401).json({
        success: false,
        message:
          rotated.reason === 'REFRESH_TOKEN_REUSED'
            ? 'This session was ended for security reasons. Please sign in again.'
            : 'You were signed out because this account was used on another device.',
        code: rotated.reason
      });
    }

    res.status(200).json({
      success: true,
      message: 'Session renewed',
      data: {
        token: rotated.token,
        refreshToken: rotated.refreshToken,
        user: serializeUser(user)
      }
    });
  } catch (error) {
    logger.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during session refresh'
    });
  }
});

// @desc    Get current user
// @route   GET /api/auth/me
// @access  Private
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('companies', 'name isActive');

    res.status(200).json({
      success: true,
      data: {
        user: serializeUser(user)
      }
    });
  } catch (error) {
    logger.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get user profile (alias for /me)
// @route   GET /api/auth/profile
// @access  Private
router.get('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('companies', 'name isActive');

    res.status(200).json({
      success: true,
      data: {
        user: serializeUser(user)
      }
    });
  } catch (error) {
    logger.error('Get user profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
router.put('/profile', [
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number'),
  body('preferences').optional().isObject().withMessage('Preferences must be an object')
], protect, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const allowedFields = ['name', 'phone', 'preferences'];
    const updateData = {};

    Object.keys(req.body).forEach(key => {
      if (allowedFields.includes(key)) {
        updateData[key] = req.body[key];
      }
    });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password').populate('companies', 'name isActive');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    logger.info(`User profile updated: ${user.email}`);

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: serializeUser(user)
      }
    });
  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Resend email verification link
// @route   POST /api/auth/resend-verification
// @access  Private
router.post('/resend-verification', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.isEmailVerified) {
      return res.status(200).json({
        success: true,
        message: 'Email is already verified'
      });
    }

    const verificationToken = user.getEmailVerificationToken();
    await user.save();

    logger.info(`Verification email resent for: ${user.email}`);

    const payload = {
      success: true,
      message:
        'Verification link generated. Check your email inbox (and spam folder).'
    };

    if (process.env.NODE_ENV !== 'production') {
      payload.verificationToken = verificationToken;
    }

    res.status(200).json(payload);
  } catch (error) {
    logger.error('Resend verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

/**
 * Map an OTP failure to a user-facing message.
 *
 * Every branch is a 400 with a plain sentence: the caller must not be able to
 * tell "no code was ever requested for this address" from "wrong code", or the
 * endpoint becomes an account-existence oracle.
 */
function otpFailureMessage(reason, extra = {}) {
  switch (reason) {
    case OTP_ERRORS.EXPIRED:
      return 'That code has expired. Request a new one.';
    case OTP_ERRORS.TOO_MANY_ATTEMPTS:
      return 'Too many incorrect attempts. Request a new code.';
    case OTP_ERRORS.INVALID:
      return typeof extra.attemptsRemaining === 'number' && extra.attemptsRemaining > 0
        ? `Incorrect code. ${extra.attemptsRemaining} attempt${
            extra.attemptsRemaining === 1 ? '' : 's'
          } remaining.`
        : 'Incorrect code. Request a new one.';
    default:
      return 'That code is not valid. Request a new one.';
  }
}

// @desc    Verify a one-time code
// @route   POST /api/auth/verify-otp
// @access  Public
router.post('/verify-otp', [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('otp').trim().isLength({ min: 4, max: 8 }).withMessage('Enter the code from your email'),
  body('purpose').isIn(Object.values(OTP_PURPOSES)).withMessage('Invalid purpose')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, otp, purpose } = req.body;
    const result = await verifyOtp(email, purpose, otp);

    if (!result.ok) {
      return res.status(400).json({
        success: false,
        message: otpFailureMessage(result.reason, result),
        attemptsRemaining: result.attemptsRemaining,
      });
    }

    if (purpose === OTP_PURPOSES.EMAIL_VERIFICATION) {
      const user = await User.findOne({ email });
      if (!user) {
        // The code was valid, so this is a data inconsistency rather than an
        // attack — but there is nothing to verify.
        return res.status(400).json({ success: false, message: 'Account not found' });
      }

      user.isEmailVerified = true;
      user.emailVerificationToken = undefined;
      user.emailVerificationExpire = undefined;
      user.lastLogin = new Date();
      await user.save();

      // Verifying is the last step of signing up, so hand back a session here
      // rather than making the user type their password again. A brand-new
      // account cannot be signed in anywhere else, so there is nothing to
      // conflict with — but any stale rows are cleared for safety.
      const device = req.body.device || {};
      await revokeOtherSessions(user._id, device.deviceId, 'signed_in_elsewhere');
      const { token, refreshToken } = await createSession({
        userId: user._id,
        device,
        ip: req.ip,
      });

      logger.info(`Email verified: ${email}`);

      return res.status(200).json({
        success: true,
        message: 'Email verified',
        data: { token, refreshToken, user: serializeUser(user) }
      });
    }

    // Password reset: the code is now spent, so issue a short-lived ticket that
    // authorises exactly one password change. Without this the client would
    // have to hold the OTP across two screens, and a consumed code cannot be
    // re-verified.
    const resetTicket = jwt.sign(
      { email: String(email).toLowerCase(), purpose: OTP_PURPOSES.PASSWORD_RESET },
      process.env.JWT_SECRET,
      { expiresIn: '10m' }
    );

    return res.status(200).json({
      success: true,
      message: 'Code verified. You can now set a new password.',
      data: { resetTicket }
    });

  } catch (error) {
    logger.error('Verify OTP error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @desc    Resend a one-time code
// @route   POST /api/auth/resend-otp
// @access  Public
router.post('/resend-otp', [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('purpose').isIn(Object.values(OTP_PURPOSES)).withMessage('Invalid purpose')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, purpose } = req.body;
    const user = await User.findOne({ email });

    // Generic success regardless of whether the account exists, or is already
    // verified. Rate-limit refusals ARE reported, because the caller already
    // knows they just asked — it tells them nothing new about the account.
    const genericOk = {
      success: true,
      message: 'If that address needs a code, we have sent one.',
      cooldownSeconds: Math.round(OTP_CONFIG.resendCooldownMs / 1000),
    };

    const shouldSend =
      user &&
      (purpose === OTP_PURPOSES.PASSWORD_RESET || !user.isEmailVerified);

    if (!shouldSend) return res.status(200).json(genericOk);

    const issued = await issueOtp(email, purpose);
    if (!issued.ok) {
      return res.status(429).json({
        success: false,
        message:
          issued.reason === OTP_ERRORS.COOLDOWN
            ? `Please wait ${issued.retryAfterSeconds}s before requesting another code.`
            : 'Too many codes requested. Try again later.',
        retryAfterSeconds: issued.retryAfterSeconds,
      });
    }

    await sendOtpEmail({
      to: email,
      name: user.name,
      code: issued.code,
      purpose,
      expiresInMinutes: issued.expiresInMinutes,
    });

    return res.status(200).json(genericOk);

  } catch (error) {
    logger.error('Resend OTP error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @desc    Set a new password using a verified reset ticket
// @route   POST /api/auth/reset-password
// @access  Public (requires ticket from /verify-otp)
router.post('/reset-password', [
  body('resetTicket').notEmpty().withMessage('resetTicket is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { resetTicket, password } = req.body;

    let payload;
    try {
      payload = jwt.verify(resetTicket, process.env.JWT_SECRET);
    } catch {
      return res.status(400).json({
        success: false,
        message: 'That reset session has expired. Start again.'
      });
    }

    if (payload.purpose !== OTP_PURPOSES.PASSWORD_RESET || !payload.email) {
      return res.status(400).json({ success: false, message: 'Invalid reset session' });
    }

    const user = await User.findOne({ email: payload.email });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid reset session' });
    }

    user.password = password;
    // Any legacy emailed reset token is void once the password changes.
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    // Completing a reset proves control of the mailbox, so the address is
    // verified by definition.
    user.isEmailVerified = true;
    await user.save();

    await clearOtp(payload.email, OTP_PURPOSES.PASSWORD_RESET);

    logger.info(`Password reset via OTP for: ${payload.email}`);

    // Changing the password ends every existing session. If someone else was
    // signed in — which is the usual reason for resetting in a hurry — this is
    // what actually removes them, and it frees the device slot for this login.
    await revokeOtherSessions(user._id, null, 'password_reset');

    const device = req.body.device || {};
    const { token, refreshToken } = await createSession({
      userId: user._id,
      device,
      ip: req.ip,
    });

    return res.status(200).json({
      success: true,
      message: 'Password updated',
      data: { token, refreshToken, user: serializeUser(user) }
    });

  } catch (error) {
    logger.error('Reset password (OTP) error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @desc    Logout user
// @route   POST /api/auth/logout
// @access  Private
router.post('/logout', protect, async (req, res) => {
  try {
    // Logging out has to revoke the session server-side, not just clear the
    // client's storage — otherwise the seat stays occupied and the next device
    // is blocked by a session nobody is using.
    await revokeSession(req.sessionId, 'logout');

    logger.info(`User logged out: ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during logout'
    });
  }
});

// @desc    List the devices currently holding a session
// @route   GET /api/auth/sessions
// @access  Private
router.get('/sessions', protect, async (req, res) => {
  try {
    const sessions = await listSessions(req.user._id);
    res.status(200).json({
      success: true,
      data: {
        sessions: sessions.map((s) => ({ ...s, current: s.id === req.sessionId })),
      },
    });
  } catch (error) {
    logger.error('List sessions error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @desc    Sign every other device out, keeping this one
// @route   POST /api/auth/sessions/revoke-others
// @access  Private
router.post('/sessions/revoke-others', protect, async (req, res) => {
  try {
    const current = await listSessions(req.user._id);
    const keep = current.find((s) => s.id === req.sessionId);
    const revoked = await revokeOtherSessions(req.user._id, keep?.deviceId, 'revoked_by_user');
    res.status(200).json({
      success: true,
      message: revoked ? 'Other devices signed out' : 'No other devices were signed in',
      data: { revoked },
    });
  } catch (error) {
    logger.error('Revoke sessions error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// @desc    Forgot password
// @route   POST /api/auth/forgot-password
// @access  Public
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email } = req.body;

    const user = await User.findOne({ email });

    // SECURITY: never reveal whether an address has an account, and never
    // return the reset token in the response.
    //
    // This endpoint used to answer 404 for unknown emails (letting anyone
    // enumerate customers) and return `resetToken` in the JSON body — which
    // meant knowing someone's email address was enough to take over their
    // account: request a token, read it from the response, POST it to
    // /reset-password. Both are closed here.
    //
    if (user) {
      const issued = await issueOtp(email, OTP_PURPOSES.PASSWORD_RESET);
      if (issued.ok) {
        await sendOtpEmail({
          to: email,
          name: user.name,
          code: issued.code,
          purpose: OTP_PURPOSES.PASSWORD_RESET,
          expiresInMinutes: issued.expiresInMinutes,
        });
      }
      // A rate-limit refusal is swallowed on purpose: reporting it here would
      // tell an attacker the address has an account.
    }

    logger.info(`Password reset requested for: ${email}`);

    res.status(200).json({
      success: true,
      message:
        'If an account exists for that address, we have sent a 6-digit code.',
      cooldownSeconds: Math.round(OTP_CONFIG.resendCooldownMs / 1000),
    });

  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Reset password
// @route   PUT /api/auth/reset-password/:resettoken
// @access  Public
router.put('/reset-password/:resettoken', [
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    // Get hashed token
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(req.params.resettoken)
      .digest('hex');

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Set new password
    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    // Legacy emailed-token reset. It has no device context to open a session
    // for, so it ends every session and makes the user sign in again — which
    // is also the safest outcome if this path is ever reached by an attacker.
    await revokeOtherSessions(user._id, null, 'password_reset');
    const token = null;

    logger.info(`Password reset successful for: ${user.email}`);

    res.status(200).json({
      success: true,
      message: 'Password reset successful',
      data: {
        token
      }
    });

  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

export default router;
