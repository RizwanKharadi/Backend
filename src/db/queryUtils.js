import { randomUUID } from 'crypto';
import { Op, fn, col, where as sqlWhere, literal } from 'sequelize';

/** Generate a 24-char hex id (ObjectId-shaped) for API compatibility. */
export function newId() {
  return randomUUID().replace(/-/g, '').slice(0, 24);
}

export function isValidId(id) {
  if (id == null) return false;
  const s = String(id);
  return /^[a-fA-F0-9]{24}$/.test(s) || /^[0-9a-fA-F-]{36}$/.test(s);
}

/** Map dotted Mongo paths used in indexes/filters to flat columns. */
const DOT_PATH_ALIASES = {
  'tallySync.tallyId': 'tallyId',
  'tallySync.tallyGuid': 'tallyGuid',
  'tallySync.synced': 'tallySynced',
  'tallySync.lastSyncDate': 'tallyLastSyncDate',
  'returnPeriod.month': 'returnPeriodMonth',
  'returnPeriod.year': 'returnPeriodYear',
  'contact.phone': 'contactPhone',
  'contact.email': 'contactEmail',
  'taxation.hsnCode': 'hsnCode',
  'tallyInfo.companyGuid': 'tallyCompanyGuid',
  'tallyIntegration.companyPath': 'tallyCompanyPath',
  'connectionDetails.lastHeartbeat': 'lastHeartbeat',
};

/**
 * @param key       Mongo-style field, possibly a dotted path.
 * @param knownAttrs Optional map of the target model's real attributes. When
 *   supplied, an alias is only used if that column actually exists on THIS
 *   model. DOT_PATH_ALIASES is global, but the flattened columns are not: e.g.
 *   Voucher has a real `tallyLastSyncDate`, while OutstandingReceivable keeps
 *   `tallySync` as a JSON column. Selecting a column the table lacks makes MySQL
 *   reject the whole query (ER_BAD_FIELD_ERROR), so fall back to the JSON root.
 */
function aliasKey(key, knownAttrs) {
  if (key == null) return key;
  const k = key === '_id' ? 'id' : String(key);
  const alias = DOT_PATH_ALIASES[k];
  if (alias) {
    if (!knownAttrs || knownAttrs[alias]) return alias;
    return k.includes('.') ? k.split('.')[0] : k;
  }
  // Unmapped dotted paths live inside a JSON column — use the root attribute for SELECT.
  if (k.includes('.')) return k.split('.')[0];
  return k;
}

/**
 * Resolve a Mongo-style field for WHERE clauses.
 * Known dotted aliases → flat columns; other dotted paths → MySQL JSON_EXTRACT.
 */
function resolveWhereKey(rawKey) {
  const k = rawKey === '_id' ? 'id' : String(rawKey);
  if (DOT_PATH_ALIASES[k]) {
    return { type: 'column', name: DOT_PATH_ALIASES[k] };
  }
  if (k.includes('.')) {
    const parts = k.split('.');
    return {
      type: 'json',
      root: parts[0],
      jsonPath: `$.${parts.slice(1).join('.')}`,
    };
  }
  return { type: 'column', name: k };
}

function jsonExtractWhere(root, jsonPath, val) {
  // MySQL JSON path must be a string literal (bound `?` params fail with
  // "Invalid JSON path expression ... character position 1").
  const pathLit = literal(`'${String(jsonPath).replace(/'/g, "''")}'`);
  const extracted = fn('JSON_UNQUOTE', fn('JSON_EXTRACT', col(root), pathLit));
  if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
    const symbols = Object.getOwnPropertySymbols(val);
    if (symbols.length) {
      return sqlWhere(extracted, val);
    }
    if (Object.keys(val).some((x) => x.startsWith('$'))) {
      return sqlWhere(extracted, convertOperators(val));
    }
  }
  if (typeof val === 'boolean') {
    // JSON booleans often come back as strings "true"/"false"
    return sqlWhere(extracted, val ? 'true' : 'false');
  }
  return sqlWhere(extracted, val);
}

function regexPattern(raw, options = '') {
  if (raw instanceof RegExp) return raw.source;
  return String(raw ?? '');
}

function convertValue(val) {
  if (val === undefined) return undefined;
  if (val === null) return null;
  if (Array.isArray(val)) return val.map(convertValue);
  if (val instanceof Date) return val;
  // Sequelize MySQL cannot bind RegExp objects — use Op.regexp + source string
  if (val instanceof RegExp) {
    return { [Op.regexp]: val.source };
  }
  if (typeof val === 'object') {
    // ObjectId-like / Buffer
    if (val._bsontype === 'ObjectID' || val._bsontype === 'ObjectId') {
      return String(val);
    }
    if (typeof val.toHexString === 'function') {
      return val.toHexString();
    }
    // Mongo operators
    if (Object.keys(val).some((k) => k.startsWith('$'))) {
      return convertOperators(val);
    }
    return val;
  }
  return val;
}

function convertOperators(ops) {
  const out = {};
  for (const [op, raw] of Object.entries(ops)) {
    const v = convertValue(raw);
    switch (op) {
      case '$eq':
        return v;
      case '$ne':
        out[Op.ne] = v;
        break;
      case '$in':
        out[Op.in] = v;
        break;
      case '$nin':
        out[Op.notIn] = v;
        break;
      case '$gt':
        out[Op.gt] = v;
        break;
      case '$gte':
        out[Op.gte] = v;
        break;
      case '$lt':
        out[Op.lt] = v;
        break;
      case '$lte':
        out[Op.lte] = v;
        break;
      case '$exists':
        out[v ? Op.ne : Op.eq] = null;
        break;
      case '$regex': {
        out[Op.regexp] = regexPattern(raw instanceof RegExp ? raw : v, ops.$options || '');
        break;
      }
      case '$options':
        break;
      default:
        out[op] = v;
    }
  }
  return Object.keys(out).length === 1 && out[Op.ne] === undefined && out[Op.eq] === undefined
    ? out
    : out;
}

/**
 * Convert Mongo-style filter to Sequelize where.
 * Supports $or, $and, $nor, dotted aliases, and common comparison ops.
 */
export function toWhere(filter = {}) {
  if (!filter || typeof filter !== 'object') return {};
  if (filter._id != null && filter.id == null) {
    filter = { ...filter, id: filter._id };
    delete filter._id;
  }

  const where = {};
  const andParts = [];

  for (const [rawKey, rawVal] of Object.entries(filter)) {
    if (rawKey === '$or') {
      where[Op.or] = rawVal.map((f) => toWhere(f));
      continue;
    }
    if (rawKey === '$and') {
      where[Op.and] = rawVal.map((f) => toWhere(f));
      continue;
    }
    if (rawKey === '$nor') {
      where[Op.not] = { [Op.or]: rawVal.map((f) => toWhere(f)) };
      continue;
    }

    // Mongo "array has at least one element": { 'items.0': { $exists: true } }
    if (/^[\w]+\.0$/.test(rawKey) && rawVal && typeof rawVal === 'object' && '$exists' in rawVal) {
      const root = rawKey.split('.')[0];
      const lengthExpr = fn('JSON_LENGTH', col(root));
      andParts.push(
        rawVal.$exists
          ? sqlWhere(lengthExpr, { [Op.gt]: 0 })
          : sqlWhere(fn('IFNULL', lengthExpr, 0), { [Op.eq]: 0 })
      );
      continue;
    }

    const resolved = resolveWhereKey(rawKey);
    const val = convertValue(rawVal);

    if (resolved.type === 'json') {
      andParts.push(jsonExtractWhere(resolved.root, resolved.jsonPath, val));
      continue;
    }

    const key = resolved.name;

    if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date) && !Buffer.isBuffer(val)) {
      const hasSymbolOps = Object.getOwnPropertySymbols(val).length > 0;
      if (hasSymbolOps || Object.keys(val).some((k) => k.startsWith('$'))) {
        // already converted ops with Op symbols, or still has $
        if (hasSymbolOps) {
          where[key] = val;
        } else {
          where[key] = convertOperators(val);
        }
      } else if (Object.getOwnPropertySymbols(val).length) {
        where[key] = val;
      } else {
        // plain object equality not typical for scalar cols — skip or stringify
        where[key] = val;
      }
    } else {
      where[key] = val;
    }
  }

  if (andParts.length) {
    const existingAnd = where[Op.and];
    where[Op.and] = existingAnd
      ? [...(Array.isArray(existingAnd) ? existingAnd : [existingAnd]), ...andParts]
      : andParts;
  }

  return where;
}

/** Apply $set / $inc / $unset / $push style update to a plain object. */
export function applyUpdate(doc, update = {}) {
  const next = { ...doc };
  if (update.$set) {
    for (const [k, v] of Object.entries(update.$set)) {
      setPath(next, k, convertValue(v));
    }
  }
  if (update.$unset) {
    for (const k of Object.keys(update.$unset)) {
      unsetPath(next, k);
    }
  }
  if (update.$inc) {
    for (const [k, v] of Object.entries(update.$inc)) {
      const cur = getPath(next, k) || 0;
      setPath(next, k, Number(cur) + Number(v));
    }
  }
  if (update.$push) {
    for (const [k, v] of Object.entries(update.$push)) {
      const arr = getPath(next, k) || [];
      const copy = Array.isArray(arr) ? [...arr] : [];
      if (v && typeof v === 'object' && v.$each) {
        copy.push(...v.$each.map(convertValue));
      } else {
        copy.push(convertValue(v));
      }
      setPath(next, k, copy);
    }
  }
  if (update.$addToSet) {
    for (const [k, v] of Object.entries(update.$addToSet)) {
      const arr = getPath(next, k) || [];
      const copy = Array.isArray(arr) ? [...arr] : [];
      const items = v && typeof v === 'object' && v.$each ? v.$each : [v];
      for (const item of items) {
        const cv = convertValue(item);
        if (!copy.map(String).includes(String(cv))) copy.push(cv);
      }
      setPath(next, k, copy);
    }
  }
  if (update.$pull) {
    for (const [k, v] of Object.entries(update.$pull)) {
      const arr = getPath(next, k) || [];
      if (!Array.isArray(arr)) continue;
      setPath(next, k, arr.filter((x) => String(x) !== String(convertValue(v))));
    }
  }

  // bare fields (mongoose also allows)
  for (const [k, v] of Object.entries(update)) {
    if (k.startsWith('$')) continue;
    setPath(next, k, convertValue(v));
  }

  syncAliasedColumns(next);
  return next;
}

function syncAliasedColumns(doc) {
  if (doc.tallySync && typeof doc.tallySync === 'object') {
    if (doc.tallySync.tallyId != null) doc.tallyId = doc.tallySync.tallyId;
    if (doc.tallySync.tallyGuid != null) doc.tallyGuid = doc.tallySync.tallyGuid;
    if (doc.tallySync.synced != null) doc.tallySynced = doc.tallySync.synced;
    if (doc.tallySync.lastSyncDate != null) doc.tallyLastSyncDate = doc.tallySync.lastSyncDate;
  }
  if (doc.returnPeriod && typeof doc.returnPeriod === 'object') {
    if (doc.returnPeriod.month != null) doc.returnPeriodMonth = doc.returnPeriod.month;
    if (doc.returnPeriod.year != null) doc.returnPeriodYear = doc.returnPeriod.year;
  }
  if (doc.contact && typeof doc.contact === 'object') {
    if (doc.contact.phone != null) doc.contactPhone = doc.contact.phone;
    if (doc.contact.email != null) doc.contactEmail = doc.contact.email;
  }
  if (doc.taxation && typeof doc.taxation === 'object' && doc.taxation.hsnCode != null) {
    doc.hsnCode = doc.taxation.hsnCode;
  }
  if (doc.tallyInfo && typeof doc.tallyInfo === 'object' && doc.tallyInfo.companyGuid != null) {
    doc.tallyCompanyGuid = doc.tallyInfo.companyGuid;
  }
  if (doc.tallyIntegration && typeof doc.tallyIntegration === 'object') {
    if (doc.tallyIntegration.companyPath != null) {
      doc.tallyCompanyPath = doc.tallyIntegration.companyPath;
    }
  }
  if (doc.connectionDetails && typeof doc.connectionDetails === 'object') {
    if (doc.connectionDetails.lastHeartbeat != null) {
      doc.lastHeartbeat = doc.connectionDetails.lastHeartbeat;
    }
  }
}

function getPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function unsetPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) return;
    cur = cur[parts[i]];
  }
  delete cur[parts[parts.length - 1]];
}

/** Flatten document for Sequelize create/update (JSON fields stay objects). */
export function toRow(data = {}) {
  const row = { ...data };
  if (row._id != null && row.id == null) {
    row.id = String(row._id);
    delete row._id;
  }
  syncAliasedColumns(row);
  // stringify isn't needed — Sequelize JSON type handles objects
  return row;
}

export function fromRow(instance, { lean = false } = {}) {
  if (!instance) return null;
  const plain = typeof instance.get === 'function' ? instance.get({ plain: true }) : { ...instance };
  if (plain.id != null && plain._id == null) {
    plain._id = plain.id;
  }
  // Rebuild nested tallySync from denormalized cols if missing pieces
  if (
    plain.tallyId != null ||
    plain.tallyGuid != null ||
    plain.tallySynced != null ||
    plain.tallyLastSyncDate != null
  ) {
    plain.tallySync = {
      ...(plain.tallySync || {}),
      ...(plain.tallyId != null ? { tallyId: plain.tallyId } : {}),
      ...(plain.tallyGuid != null ? { tallyGuid: plain.tallyGuid } : {}),
      ...(plain.tallySynced != null ? { synced: plain.tallySynced } : {}),
      ...(plain.tallyLastSyncDate != null ? { lastSyncDate: plain.tallyLastSyncDate } : {}),
    };
  }
  if (lean) return plain;
  return plain;
}

/** `knownAttrs` is the model's rawAttributes; see aliasKey for why it matters. */
export function parseSelect(select, knownAttrs) {
  if (!select) return null;
  const alias = (k) => aliasKey(k, knownAttrs);
  const dedupe = (arr) => [...new Set(arr.map((k) => alias(k)).filter(Boolean))];
  if (typeof select === 'object') {
    const include = [];
    const exclude = [];
    for (const [k, v] of Object.entries(select)) {
      const key = alias(k === '_id' ? 'id' : k);
      if (v) include.push(key);
      else exclude.push(key);
    }
    return { include: dedupe(include), exclude: dedupe(exclude) };
  }
  const parts = String(select).split(/\s+/).filter(Boolean);
  const include = [];
  const exclude = [];
  for (const p of parts) {
    if (p.startsWith('-')) exclude.push(alias(p.slice(1) === '_id' ? 'id' : p.slice(1)));
    else include.push(alias(p === '_id' ? 'id' : p));
  }
  return { include: dedupe(include), exclude: dedupe(exclude) };
}

export function parseSort(sort) {
  if (!sort) return undefined;
  if (typeof sort === 'string') {
    return sort.split(/\s+/).filter(Boolean).map((s) => {
      if (s.startsWith('-')) return [aliasKey(s.slice(1)), 'DESC'];
      return [aliasKey(s), 'ASC'];
    });
  }
  return Object.entries(sort).map(([k, v]) => [aliasKey(k), v === -1 || v === 'desc' ? 'DESC' : 'ASC']);
}

/** Flatten filter keys for upsert base docs (aliases + nested JSON paths). */
export function filterToPlain(filter = {}) {
  const out = {};
  for (const [k, v] of Object.entries(filter || {})) {
    if (k.startsWith('$')) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) continue;
    const resolved = resolveWhereKey(k);
    if (resolved.type === 'json') {
      setPath(out, `${resolved.root}.${resolved.jsonPath.slice(2)}`, v);
    } else {
      out[resolved.name] = v;
    }
  }
  syncAliasedColumns(out);
  return out;
}

export { Op, fn, col, sqlWhere, literal, aliasKey };
