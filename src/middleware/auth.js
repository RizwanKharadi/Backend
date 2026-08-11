import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import logger from '../utils/logger.js';
import Company from '../models/Company.js';
import { touchSession } from '../services/sessionService.js';

// Protect routes - verify JWT token
export const protect = async (req, res, next) => {
  try {
    let token;

    // Check for token in headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    // Check for token in cookies
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Get user from token
      const user = await User.findById(decoded.id)
        .select('-password')
        .populate('companies', 'name isActive');

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'User account is deactivated'
        });
      }

      // Every token issued since sessions shipped carries the id of a row in
      // `sessions`. Checking it here is what lets one device sign another one
      // out — a JWT on its own cannot be withdrawn. Tokens minted before this
      // existed have no sid and are refused, so the fleet re-authenticates once
      // rather than keeping month-long sessions nobody can revoke.
      if (!decoded.sid) {
        return res.status(401).json({
          success: false,
          message: 'Please sign in again.',
          code: 'SESSION_REQUIRED'
        });
      }

      const session = await touchSession(decoded.sid, req.ip);
      if (!session) {
        return res.status(401).json({
          success: false,
          message: 'You were signed out because this account was used on another device.',
          code: 'SESSION_REVOKED'
        });
      }

      req.user = user;
      req.sessionId = String(decoded.sid);
      next();
    } catch (error) {
      const expired = error?.name === 'TokenExpiredError';
      if (expired) {
        logger.debug('Access token expired', { path: req.path });
      } else {
        logger.error('Token verification failed:', error);
      }
      return res.status(401).json({
        success: false,
        message: expired
          ? 'Session expired'
          : 'Not authorized to access this route',
        code: expired ? 'ACCESS_TOKEN_EXPIRED' : 'ACCESS_TOKEN_INVALID'
      });
    }
  } catch (error) {
    logger.error('Auth middleware error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error in authentication'
    });
  }
};

// Grant access to specific roles
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to access this route'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user.role} is not authorized to access this route`
      });
    }

    next();
  };
};

// Check company access
export const checkCompanyAccess = async (req, res, next) => {
  try {
    const companyId = req.params.companyId || req.body.companyId || req.query.companyId;
    
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Company ID is required'
      });
    }

    const hasAccessViaUserDoc = req.user.companies.some(
      company => company._id.toString() === companyId && company.isActive
    );

    let hasAccess = hasAccessViaUserDoc;

    if (!hasAccess && req.user.role !== 'superadmin') {
      const membership = await Company.findOne({
        _id: companyId,
        isActive: true,
        'users.user': req.user._id
      }).select('_id');
      hasAccess = !!membership;
    }

    if (!hasAccess && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to access this company'
      });
    }

    const company = await Company.findById(companyId);
    if (!company || !company.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    req.companyId = companyId;
    req.company = company;
    next();
  } catch (error) {
    logger.error('Company access check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error in company access check'
    });
  }
};

// Optional auth - doesn't fail if no token
export const optionalAuth = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');
        if (user && user.isActive) {
          req.user = user;
        }
      } catch (error) {
        // Token invalid, but continue without user
        logger.warn('Invalid token in optional auth:', error.message);
      }
    }

    next();
  } catch (error) {
    logger.error('Optional auth middleware error:', error);
    next();
  }
};

