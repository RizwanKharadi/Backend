import { isValidId } from '../db/queryUtils.js';
import Item from '../models/Item.js';
import tallyWebSocketService from '../services/tallyWebSocketService.js';
import { buildStockItemImportPayload } from '../utils/tallyMasterImportPayload.js';
import { normalizeItemInput } from '../utils/normalizeItemInput.js';
import Company from '../models/Company.js';
import { validationResult } from 'express-validator';
import logger from '../utils/logger.js';
import multer from 'multer';
import path from 'path';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/items/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'images') {
      // Allow only image files
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed for images'));
      }
    } else if (file.fieldname === 'documents') {
      // Allow documents
      const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Only PDF and Word documents are allowed'));
      }
    } else {
      cb(new Error('Invalid field name'));
    }
  }
});

// @desc    Get inventory statistics
// @route   GET /api/inventory/stats
// @access  Private
export const getInventoryStats = async (req, res) => {
  try {
    const companyId = req.company._id;
    const match = { company: companyId, isActive: true };

    const total = await Item.countDocuments(match);

    const [agg] = await Item.aggregate([
      { $match: match },
      {
        $addFields: {
          totalStock: {
            $cond: [
              { $eq: ['$inventory.trackInventory', true] },
              { $sum: '$inventory.currentStock.quantity' },
              0,
            ],
          },
          reorderLevel: { $ifNull: ['$inventory.stockLevels.reorderLevel', 0] },
          sellingPrice: { $ifNull: ['$pricing.sellingPrice', 0] },
          tallyClosingValue: { $abs: { $ifNull: ['$tallyStock.closingValue', 0] } },
        },
      },
      {
        $group: {
          _id: null,
          lowStock: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: ['$totalStock', 0] },
                    { $lte: ['$totalStock', '$reorderLevel'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          outOfStock: {
            $sum: {
              $cond: [{ $lte: ['$totalStock', 0] }, 1, 0],
            },
          },
          totalValue: {
            // Tally's closing stock value when synced; estimated qty × rate otherwise.
            $sum: {
              $cond: [
                { $gt: ['$tallyClosingValue', 0] },
                '$tallyClosingValue',
                { $multiply: ['$totalStock', '$sellingPrice'] },
              ],
            },
          },
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        total,
        lowStock: agg?.lowStock ?? 0,
        outOfStock: agg?.outOfStock ?? 0,
        totalValue: agg?.totalValue ?? 0,
        categories: {},
        topItems: [],
      },
    });
  } catch (error) {
    logger.error('Get inventory stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

// @desc    Get all items
// @route   GET /api/inventory/items
// @access  Private
export const getItems = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      category,
      type,
      search,
      lowStock,
      outOfStock
    } = req.query;

    const query = { company: req.company._id, isActive: true };

    // Add filters
    if (category) query.category = category;
    if (type) query.type = type;
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { displayName: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { barcode: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { name: 1 },
      populate: [
        { path: 'category', select: 'name' },
        { path: 'suppliers.party', select: 'name displayName' }
      ]
    };

    let items = await Item.paginate(query, options);

    // Filter by stock levels if requested
    if (lowStock === 'true' || outOfStock === 'true') {
      items.docs = items.docs.filter(item => {
        if (!item.inventory.trackInventory) return false;

        const current = Array.isArray(item.inventory.currentStock)
          ? item.inventory.currentStock
          : [];
        const totalStock = current.reduce((sum, c) => {
          const qty = Number(c?.availableQuantity ?? c?.quantity ?? c?.qty ?? 0);
          return sum + qty;
        }, 0);

        const reorderLevel = Number(item.inventory?.stockLevels?.reorderLevel ?? 0);

        if (outOfStock === 'true' && totalStock <= 0) return true;
        if (lowStock === 'true' && totalStock <= reorderLevel && totalStock > 0) return true;

        return false;
      });
    }

    res.status(200).json({
      success: true,
      data: items
    });
  } catch (error) {
    logger.error('Get items error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Get single item by barcode (exact match, company-scoped)
// @route   GET /api/inventory/items/by-barcode?barcode=...
// @access  Private
export const getItemByBarcode = async (req, res) => {
  try {
    const raw = String(req.params?.barcode || req.query?.barcode || '').trim();
    if (!raw) {
      return res.status(400).json({ success: false, message: 'barcode is required' });
    }

    // Case-insensitive exact match on barcode, item code, or Tally Part No. (stored in description).
    const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactRegex = new RegExp(`^${escaped}$`, 'i');

    const item = await Item.findOne({
      company: req.company._id,
      isActive: true,
      $or: [
        { barcode: { $regex: exactRegex } },
        { code: { $regex: exactRegex } },
        { description: { $regex: exactRegex } }
      ]
    })
      .populate('category', 'name description')
      .populate('suppliers.party', 'name displayName contact')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }

    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    logger.error('Get item by barcode error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Get single item
// @route   GET /api/inventory/items/:id
// @access  Private
export const getItem = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!isValidId(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid item id'
      });
    }

    const item = await Item.findOne({
      _id: id,
      company: req.company._id
    })
    .populate('category', 'name description')
    .populate('suppliers.party', 'name displayName contact')
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email');

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    res.status(200).json({
      success: true,
      data: item
    });
  } catch (error) {
    logger.error('Get item error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Create item
// @route   POST /api/inventory/items
// @access  Private
export const createItem = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    const itemData = {
      ...normalizeItemInput(req.body),
      company: req.company._id,
      createdBy: req.user.id
    };

    // Check for duplicate code/barcode
    if (itemData.code) {
      const existingItem = await Item.findOne({
        company: req.company._id,
        code: itemData.code,
        isActive: true
      });
      
      if (existingItem) {
        return res.status(400).json({
          success: false,
          message: 'Item code already exists'
        });
      }
    }

    if (itemData.barcode) {
      const existingItem = await Item.findOne({
        company: req.company._id,
        barcode: itemData.barcode,
        isActive: true
      });
      
      if (existingItem) {
        return res.status(400).json({
          success: false,
          message: 'Barcode already exists'
        });
      }
    }

    const item = await Item.create(itemData);

    const populatedItem = await Item.findById(item._id)
      .populate('category', 'name')
      .populate('createdBy', 'name email');

    let tallyPush = { status: 'skipped', message: 'Tally push not requested' };

    if (req.body.pushToTally !== false) {
      try {
        const importPayload = buildStockItemImportPayload(populatedItem, req.company, {
          companyName: req.body.tallyCompanyName,
          baseUnits: req.body.unit || req.body.baseUnits
        });
        const importResult = await tallyWebSocketService.pushStockItemToTally(
          req.company,
          importPayload,
          { itemId: populatedItem._id.toString() }
        );
        await Item.findByIdAndUpdate(populatedItem._id, {
          'tallySync.synced': true,
          'tallySync.tallyId': importResult.tallyGuid || populatedItem.tallySync?.tallyId,
          'tallySync.lastSyncDate': new Date(),
          'tallySync.syncError': ''
        });
        tallyPush = {
          status: importResult.alreadyExisted ? 'already_synced' : 'completed',
          tallyGuid: importResult.tallyGuid,
          masterName: importResult.masterName || populatedItem.name
        };
      } catch (pushError) {
        logger.warn('Item saved but Tally stock import failed', {
          itemId: populatedItem._id,
          error: pushError.message
        });
        await Item.findByIdAndUpdate(populatedItem._id, {
          'tallySync.synced': false,
          'tallySync.syncError': pushError.message
        });
        tallyPush = { status: 'failed', message: pushError.message };
      }
    }

    res.status(201).json({
      success: true,
      data: populatedItem,
      tallyPush
    });
  } catch (error) {
    logger.error('Create item error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message,
        errors: Object.values(error.errors || {}).map((e) => ({
          field: e.path,
          message: e.message
        }))
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Update item
// @route   PUT /api/inventory/items/:id
// @access  Private
export const updateItem = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: errors.array()
      });
    }

    let item = await Item.findOne({
      _id: req.params.id,
      company: req.company._id
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Check for duplicate code/barcode (excluding current item)
    if (req.body.code && req.body.code !== item.code) {
      const existingItem = await Item.findOne({
        company: req.company._id,
        code: req.body.code,
        _id: { $ne: req.params.id },
        isActive: true
      });
      
      if (existingItem) {
        return res.status(400).json({
          success: false,
          message: 'Item code already exists'
        });
      }
    }

    if (req.body.barcode && req.body.barcode !== item.barcode) {
      const existingItem = await Item.findOne({
        company: req.company._id,
        barcode: req.body.barcode,
        _id: { $ne: req.params.id },
        isActive: true
      });
      
      if (existingItem) {
        return res.status(400).json({
          success: false,
          message: 'Barcode already exists'
        });
      }
    }

    const updateData = {
      ...normalizeItemInput(req.body),
      updatedBy: req.user.id
    };

    item = await Item.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
    .populate('category', 'name')
    .populate('updatedBy', 'name email');

    res.status(200).json({
      success: true,
      data: item
    });
  } catch (error) {
    logger.error('Update item error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message,
        errors: Object.values(error.errors || {}).map((e) => ({
          field: e.path,
          message: e.message
        }))
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Delete item
// @route   DELETE /api/inventory/items/:id
// @access  Private
export const deleteItem = async (req, res) => {
  try {
    const item = await Item.findOne({
      _id: req.params.id,
      company: req.company._id
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Soft delete
    item.isActive = false;
    item.updatedBy = req.user.id;
    await item.save();

    res.status(200).json({
      success: true,
      message: 'Item deleted successfully'
    });
  } catch (error) {
    logger.error('Delete item error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Upload item images/documents
// @route   POST /api/inventory/items/:id/upload
// @access  Private
export const uploadFiles = [
  upload.fields([
    { name: 'images', maxCount: 5 },
    { name: 'documents', maxCount: 3 }
  ]),
  async (req, res) => {
    try {
      const item = await Item.findOne({
        _id: req.params.id,
        company: req.company._id
      });

      if (!item) {
        return res.status(404).json({
          success: false,
          message: 'Item not found'
        });
      }

      // Process uploaded images
      if (req.files.images) {
        req.files.images.forEach(file => {
          item.images.push({
            filename: file.filename,
            originalName: file.originalname,
            path: file.path,
            size: file.size,
            mimetype: file.mimetype,
            isPrimary: item.images.length === 0 // First image is primary
          });
        });
      }

      // Process uploaded documents
      if (req.files.documents) {
        req.files.documents.forEach(file => {
          item.documents.push({
            filename: file.filename,
            originalName: file.originalname,
            path: file.path,
            size: file.size,
            mimetype: file.mimetype,
            type: 'other' // Default type, can be updated later
          });
        });
      }

      await item.save();

      res.status(200).json({
        success: true,
        message: 'Files uploaded successfully',
        data: {
          images: item.images,
          documents: item.documents
        }
      });
    } catch (error) {
      logger.error('Upload files error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error'
      });
    }
  }
];
