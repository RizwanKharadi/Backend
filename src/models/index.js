/**
 * Model registry — populated after connectDB().
 * Each file under models/ re-exports from here so import paths stay stable.
 */
import { getModels } from '../config/database.js';

function proxy(name) {
  const handler = {
    get(_t, prop) {
      if (prop === '__esModule') return true;
      if (prop === 'then') return undefined;
      const m = getModels()?.[name];
      if (!m) {
        // Allow reading modelName before connect for diagnostics
        if (prop === 'modelName') return name;
        if (prop === 'name') return name;
        // Return a lazy thrower for calls before connect
        if (typeof prop === 'symbol') return undefined;
        return (...args) => {
          const models = getModels();
          if (!models?.[name]) {
            throw new Error(`Database not connected — cannot use model ${name}.${String(prop)}`);
          }
          const target = models[name][prop];
          if (typeof target === 'function') return target.apply(models[name], args);
          return target;
        };
      }
      const val = m[prop];
      if (typeof val === 'function') return val.bind(m);
      return val;
    },
    apply(_t, _this, args) {
      const m = getModels()?.[name];
      if (!m) throw new Error(`Database not connected — cannot construct ${name}`);
      return new m(...args);
    },
    construct(_t, args) {
      const m = getModels()?.[name];
      if (!m) throw new Error(`Database not connected — cannot construct ${name}`);
      return new m(...args);
    },
  };
  return new Proxy(function ModelProxy() {}, handler);
}

export const User = proxy('User');
export const Organization = proxy('Organization');
export const Company = proxy('Company');
export const Subscription = proxy('Subscription');
export const DeviceLicense = proxy('DeviceLicense');
export const Party = proxy('Party');
export const Item = proxy('Item');
export const Voucher = proxy('Voucher');
export const VoucherDetail = proxy('VoucherDetail');
export const Godown = proxy('Godown');
export const Unit = proxy('Unit');
export const VoucherType = proxy('VoucherType');
export const TallyAccount = proxy('TallyAccount');
export const GstRegistration = proxy('GstRegistration');
export const TallyConnection = proxy('TallyConnection');
export const TallySync = proxy('TallySync');
export const ProfitLossReport = proxy('ProfitLossReport');
export const BalanceSheetReport = proxy('BalanceSheetReport');
export const OutstandingReceivable = proxy('OutstandingReceivable');
export const Budget = proxy('Budget');
export const GSTReturn = proxy('GSTReturn');
export const Notification = proxy('Notification');
export const TallySerialRegistration = proxy('TallySerialRegistration');
export const TallyImportQueue = proxy('TallyImportQueue');

export default {
  User,
  Organization,
  Company,
  Subscription,
  DeviceLicense,
  Party,
  Item,
  Voucher,
  VoucherDetail,
  Godown,
  Unit,
  VoucherType,
  TallyAccount,
  GstRegistration,
  TallyConnection,
  TallySync,
  ProfitLossReport,
  BalanceSheetReport,
  OutstandingReceivable,
  Budget,
  GSTReturn,
  Notification,
  TallySerialRegistration,
};
