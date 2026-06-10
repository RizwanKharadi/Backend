import mongoose from 'mongoose';

/**
 * Map mobile / flat API body → Item schema (category as name, units, pricing, inventory).
 */
export function normalizeItemInput(body = {}) {
  const data = { ...body };

  delete data.companyId;
  delete data.pushToTally;
  delete data.tallyCompanyName;
  delete data.baseUnits;

  const categoryRaw = data.categoryName ?? data.category;
  if (categoryRaw != null && String(categoryRaw).trim() !== '') {
    const catStr = String(categoryRaw).trim();
    if (mongoose.Types.ObjectId.isValid(catStr)) {
      data.category = catStr;
      if (!data.categoryName) delete data.categoryName;
    } else {
      data.categoryName = catStr;
      delete data.category;
    }
  } else {
    delete data.category;
    if (!data.categoryName) data.categoryName = 'General';
  }

  const unitName =
    data.unit || data.units?.primary?.name || data.baseUnits || 'Nos';
  data.units = {
    ...(typeof data.units === 'object' ? data.units : {}),
    primary: {
      name: unitName,
      symbol: data.units?.primary?.symbol || unitName,
      decimalPlaces: data.units?.primary?.decimalPlaces ?? 0
    }
  };
  delete data.unit;

  if (data.rate != null && data.pricing == null) {
    const rate = Number(data.rate) || 0;
    data.pricing = { costPrice: rate, sellingPrice: rate, mrp: rate };
  } else if (data.rate != null && typeof data.pricing === 'object') {
    const rate = Number(data.rate) || 0;
    data.pricing = {
      ...data.pricing,
      sellingPrice: data.pricing.sellingPrice ?? rate,
      costPrice: data.pricing.costPrice ?? rate
    };
  }
  delete data.rate;

  const openingStock = Number(data.openingStock);
  const reorderLevel = Number(data.reorderLevel);
  if (
    !Number.isNaN(openingStock) ||
    !Number.isNaN(reorderLevel) ||
    data.maxLevel != null ||
    data.inventory
  ) {
    const qty = !Number.isNaN(openingStock) ? openingStock : 0;
    data.inventory = {
      ...(typeof data.inventory === 'object' ? data.inventory : {}),
      trackInventory: data.inventory?.trackInventory !== false,
      stockLevels: {
        ...(data.inventory?.stockLevels || {}),
        reorderLevel: !Number.isNaN(reorderLevel)
          ? reorderLevel
          : (data.inventory?.stockLevels?.reorderLevel ?? 0),
        maximum: data.maxLevel ?? data.inventory?.stockLevels?.maximum ?? 0
      },
      currentStock:
        qty > 0
          ? [
              {
                quantity: qty,
                reservedQuantity: 0,
                availableQuantity: qty,
                ...(data.inventory?.currentStock?.[0] || {})
              }
            ]
          : data.inventory?.currentStock
    };
  }
  delete data.openingStock;
  delete data.reorderLevel;
  delete data.maxLevel;
  delete data.location;

  if (data.barcode && !data.code) {
    data.code = String(data.barcode).trim().toUpperCase();
  }

  return data;
}
