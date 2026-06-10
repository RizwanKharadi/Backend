import express from 'express';
import { body, validationResult } from 'express-validator';
import Company from '../models/Company.js';
import User from '../models/User.js';
import { protect, authorize, checkCompanyAccess } from '../middleware/auth.js';
import { requireActiveSubscription } from '../middleware/license.js';
import tallyWebSocketService from '../services/tallyWebSocketService.js';
import { ensureOrganizationForUser } from '../services/licenseService.js';
import { registerTallySerial, mapTallyLicensePayload } from '../services/tallySerialService.js';
import logger from '../utils/logger.js';

const router = express.Router();

// All routes are protected and require active org subscription
router.use(protect, requireActiveSubscription);

// @desc    Get all companies for user
// @route   GET /api/companies
// @access  Private
router.get('/', async (req, res) => {
  try {
    let companies;
    
    if (req.user.role === 'superadmin') {
      // Superadmin can see all companies
      companies = await Company.find({ isActive: true })
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 });
    } else {
      const userCompanyIds = (req.user.companies || []).map((c) =>
        c._id ? c._id : c
      );

      companies = await Company.find({
        isActive: true,
        $or: [
          { _id: { $in: userCompanyIds } },
          { 'users.user': req.user._id }
        ]
      })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    }

    res.status(200).json({
      success: true,
      data: { companies }
    });
  } catch (error) {
    logger.error('Get companies error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Get single company
// @route   GET /api/companies/:id
// @access  Private
router.get('/:id', checkCompanyAccess, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('users.user', 'name email');

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    res.status(200).json({
      success: true,
      data: { company }
    });
  } catch (error) {
    logger.error('Get company error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Link a Tally company to the logged-in user (desktop agent)
// @route   POST /api/companies/link-tally
// @access  Private
router.post('/link-tally', [
  body('name').trim().isLength({ min: 2, max: 200 }).withMessage('Tally company name is required'),
  body('guid').optional().trim()
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
      guid,
      booksFrom,
      startingFrom,
      state,
      pincode,
      country,
      phone,
      email,
      tallyLicense
    } = req.body;

    const company = await tallyWebSocketService.upsertCompany(
      {
        name,
        guid: guid || undefined,
        booksFrom,
        startingFrom,
        state,
        pincode,
        country,
        phone,
        email
      },
      req.user.id
    );

    let tallySerial = null;
    const licensePayload = mapTallyLicensePayload(tallyLicense);
    if (licensePayload?.serialNumber) {
      const organizationId = await ensureOrganizationForUser(req.user);
      await registerTallySerial({
        serialNumber: licensePayload.serialNumber,
        userId: req.user._id,
        organizationId,
        email: req.user.email,
        licenseDetails: licensePayload
      });
      tallySerial = { serialNumber: licensePayload.serialNumber, registered: true };
    }

    logger.info(`Tally company linked: ${company.name} for user ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: 'Tally company linked successfully',
      data: { company, tallySerial }
    });
  } catch (error) {
    logger.error('Link Tally company error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error'
    });
  }
});

// @desc    Create new company
// @route   POST /api/companies
// @access  Private
router.post('/', [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Company name must be between 2 and 100 characters'),
  body('address.line1').notEmpty().withMessage('Address line 1 is required'),
  body('address.city').notEmpty().withMessage('City is required'),
  body('address.state').notEmpty().withMessage('State is required'),
  body('address.pincode').matches(/^[1-9][0-9]{5}$/).withMessage('Please provide a valid pincode'),
  body('contact.phone').isMobilePhone().withMessage('Please provide a valid phone number'),
  body('contact.email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('businessType').isIn(['proprietorship', 'partnership', 'llp', 'private_limited', 'public_limited', 'trust', 'society', 'other']).withMessage('Please select a valid business type'),
  body('industry').notEmpty().withMessage('Industry is required')
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

    const companyData = {
      ...req.body,
      createdBy: req.user.id,
      users: [{
        user: req.user.id,
        role: 'admin',
        permissions: {
          vouchers: { create: true, read: true, update: true, delete: true },
          inventory: { create: true, read: true, update: true, delete: true },
          reports: { financial: true, inventory: true, gst: true, analytics: true }
        }
      }]
    };

    // Set default financial year if not provided
    if (!companyData.financialYear) {
      const currentYear = new Date().getFullYear();
      const currentMonth = new Date().getMonth();
      
      // If current month is before April, financial year starts from previous year
      const fyStartYear = currentMonth < 3 ? currentYear - 1 : currentYear;
      
      companyData.financialYear = {
        startDate: new Date(fyStartYear, 3, 1), // April 1st
        endDate: new Date(fyStartYear + 1, 2, 31) // March 31st
      };
    }

    const company = await Company.create(companyData);

    // Add company to user's companies list
    await User.findByIdAndUpdate(req.user.id, {
      $push: { companies: company._id }
    });

    logger.info(`New company created: ${company.name} by ${req.user.email}`);

    res.status(201).json({
      success: true,
      message: 'Company created successfully',
      data: { company }
    });
  } catch (error) {
    logger.error('Create company error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Update company
// @route   PUT /api/companies/:id
// @access  Private
router.put('/:id', checkCompanyAccess, [
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('contact.phone').optional().isMobilePhone(),
  body('contact.email').optional().isEmail().normalizeEmail()
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

    const company = await Company.findById(req.params.id);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Check if user has admin role in this company
    const userRole = company.getUserRole(req.user.id);
    if (userRole !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this company'
      });
    }

    const updatedCompany = await Company.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    logger.info(`Company updated: ${updatedCompany.name} by ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: 'Company updated successfully',
      data: { company: updatedCompany }
    });
  } catch (error) {
    logger.error('Update company error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Add user to company
// @route   POST /api/companies/:id/users
// @access  Private (Admin only)
router.post('/:id/users', checkCompanyAccess, [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('role').isIn(['admin', 'accountant', 'sales', 'viewer']).withMessage('Please select a valid role')
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

    const company = await Company.findById(req.params.id);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Check if user has admin role in this company
    const userRole = company.getUserRole(req.user.id);
    if (userRole !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to add users to this company'
      });
    }

    const { email, role, permissions = {} } = req.body;

    // Find user by email
    const userToAdd = await User.findOne({ email });

    if (!userToAdd) {
      return res.status(404).json({
        success: false,
        message: 'User not found with this email'
      });
    }

    // Check if user is already in company
    if (company.hasUserAccess(userToAdd._id)) {
      return res.status(400).json({
        success: false,
        message: 'User is already part of this company'
      });
    }

    // Add user to company
    await company.addUser(userToAdd._id, role, permissions);

    // Add company to user's companies list
    await User.findByIdAndUpdate(userToAdd._id, {
      $push: { companies: company._id }
    });

    logger.info(`User ${email} added to company ${company.name} by ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: 'User added to company successfully'
    });
  } catch (error) {
    logger.error('Add user to company error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Remove user from company
// @route   DELETE /api/companies/:id/users/:userId
// @access  Private (Admin only)
router.delete('/:id/users/:userId', checkCompanyAccess, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Check if user has admin role in this company
    const userRole = company.getUserRole(req.user.id);
    if (userRole !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to remove users from this company'
      });
    }

    // Cannot remove company creator
    if (company.createdBy.toString() === req.params.userId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove company creator'
      });
    }

    // Remove user from company
    await company.removeUser(req.params.userId);

    // Remove company from user's companies list
    await User.findByIdAndUpdate(req.params.userId, {
      $pull: { companies: company._id }
    });

    logger.info(`User removed from company ${company.name} by ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: 'User removed from company successfully'
    });
  } catch (error) {
    logger.error('Remove user from company error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// @desc    Delete company
// @route   DELETE /api/companies/:id
// @access  Private (Admin only)
router.delete('/:id', checkCompanyAccess, async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Only company creator or superadmin can delete
    if (company.createdBy.toString() !== req.user.id && req.user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this company'
      });
    }

    // Soft delete - just deactivate the company
    company.isActive = false;
    await company.save();

    logger.info(`Company deactivated: ${company.name} by ${req.user.email}`);

    res.status(200).json({
      success: true,
      message: 'Company deactivated successfully'
    });
  } catch (error) {
    logger.error('Delete company error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

export default router;
