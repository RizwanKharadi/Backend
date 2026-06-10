import VoucherType from '../models/VoucherType.js';
import Godown from '../models/Godown.js';
import Unit from '../models/Unit.js';
import Party from '../models/Party.js';
import GstRegistration from '../models/GstRegistration.js';
import {
  isSundryPartyParent,
  matchesAccountLedgerParent,
  normalizeTallyParentName
} from '../utils/tallyLedgerFilter.js';
import logger from '../utils/logger.js';

export const getVoucherTypes = async (req, res) => {
  try {
    const { parent, search } = req.query;
    const query = { company: req.company._id, isActive: true };

    if (parent) {
      const parents = String(parent)
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
      if (parents.length === 1) {
        query.parent = parents[0];
      } else if (parents.length > 1) {
        query.parent = { $in: parents };
      }
    }

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    const rows = await VoucherType.find(query).sort({ name: 1 }).lean();

    res.status(200).json({
      success: true,
      data: rows.map((r) => ({
        id: r._id.toString(),
        name: r.name,
        parent: r.parent,
        reservedName: r.reservedName
      }))
    });
  } catch (error) {
    logger.error('Get voucher types error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getGodowns = async (req, res) => {
  try {
    const { search } = req.query;
    const query = { company: req.company._id, isActive: true };
    if (search) query.name = { $regex: search, $options: 'i' };

    const rows = await Godown.find(query).sort({ name: 1 }).lean();

    res.status(200).json({
      success: true,
      data: rows.map((r) => ({
        id: r._id.toString(),
        name: r.name,
        reservedName: r.reservedName
      }))
    });
  } catch (error) {
    logger.error('Get godowns error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getUnits = async (req, res) => {
  try {
    const { search } = req.query;
    const query = { company: req.company._id, isActive: true };
    if (search) query.name = { $regex: search, $options: 'i' };

    const rows = await Unit.find(query).sort({ name: 1 }).lean();

    res.status(200).json({
      success: true,
      data: rows.map((r) => ({
        id: r._id.toString(),
        name: r.name,
        reservedName: r.reservedName
      }))
    });
  } catch (error) {
    logger.error('Get units error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getAccountLedgers = async (req, res) => {
  try {
    const { parentGroup, search } = req.query;
    const query = {
      company: req.company._id,
      isActive: true,
      recordType: 'ledger'
    };

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    let rows = await Party.find(query).sort({ name: 1 }).lean();

    if (parentGroup) {
      rows = rows.filter((r) =>
        matchesAccountLedgerParent(r.tallyParent, parentGroup)
      );
    }

    res.status(200).json({
      success: true,
      data: rows.map((r) => ({
        id: r._id.toString(),
        name: r.name,
        parentGroup: r.tallyParent
      }))
    });
  } catch (error) {
    logger.error('Get account ledgers error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getLedgers = async (req, res) => {
  try {
    const { excludeSundry, search, limit = 2000 } = req.query;
    const query = {
      company: req.company._id,
      isActive: true,
      recordType: 'ledger'
    };

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    let rows = await Party.find(query)
      .sort({ name: 1 })
      .limit(Math.min(Number(limit) || 2000, 2000))
      .lean();

    if (excludeSundry === 'true' || excludeSundry === true) {
      rows = rows.filter((r) => !isSundryPartyParent(r.tallyParent));
    }

    res.status(200).json({
      success: true,
      data: rows.map((r) => ({
        id: r._id.toString(),
        name: r.name,
        parentGroup: normalizeTallyParentName(r.tallyParent)
      }))
    });
  } catch (error) {
    logger.error('Get ledgers error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getGstRegistrations = async (req, res) => {
  try {
    const { search } = req.query;
    const query = { company: req.company._id, isActive: true };
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { gstin: { $regex: search, $options: 'i' } },
        { stateName: { $regex: search, $options: 'i' } }
      ];
    }

    const rows = await GstRegistration.find(query).sort({ stateName: 1, name: 1 }).lean();

    res.status(200).json({
      success: true,
      data: rows.map((r) => ({
        id: r._id.toString(),
        name: r.name,
        stateName: r.stateName,
        gstin: r.gstin,
        registrationDetails: r.registrationDetails || []
      }))
    });
  } catch (error) {
    logger.error('Get GST registrations error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
