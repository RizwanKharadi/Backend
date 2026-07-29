import {
  newId,
  toWhere,
  applyUpdate,
  toRow,
  fromRow,
  parseSelect,
  parseSort,
  filterToPlain,
  aliasKey,
  Op,
} from './queryUtils.js';

/**
 * Chainable query mimicking Mongoose Query.
 */
class CompatQuery {
  constructor(ModelCompat, filter = {}, options = {}) {
    this.ModelCompat = ModelCompat;
    this.filter = filter || {};
    this._select = null;
    this._populate = [];
    this._sort = null;
    this._limit = null;
    this._skip = null;
    this._lean = false;
    this._single = options.single || false;
    this._count = options.count || false;
    this._delete = options.delete || false;
    this._update = options.update || null;
    this._updateOptions = options.updateOptions || {};
  }

  select(fields) {
    this._select = fields;
    return this;
  }

  populate(path, select) {
    if (path && typeof path === 'object' && !Array.isArray(path)) {
      this._populate.push(path);
    } else {
      this._populate.push({ path, select });
    }
    return this;
  }

  sort(s) {
    this._sort = s;
    return this;
  }

  limit(n) {
    this._limit = n;
    return this;
  }

  skip(n) {
    this._skip = n;
    return this;
  }

  lean(v = true) {
    this._lean = v;
    return this;
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject);
  }

  catch(reject) {
    return this.exec().catch(reject);
  }

  async exec() {
    const sequelizeModel = this.ModelCompat.sequelizeModel;
    const where = toWhere(this.filter);

    if (this._count) {
      return sequelizeModel.count({ where });
    }

    if (this._delete) {
      const deleted = await sequelizeModel.destroy({ where });
      return { deletedCount: deleted, acknowledged: true };
    }

    if (this._update) {
      const docs = await sequelizeModel.findAll({ where });
      let modified = 0;
      const upsert = this._updateOptions.upsert;
      if (!docs.length && upsert) {
        const created = applyUpdate({ id: newId() }, this._update);
        Object.assign(created, toWhereToPlain(this.filter));
        const row = toRow(created);
        const inst = await sequelizeModel.create(row);
        return this._updateOptions.new
          ? wrapDocument(this.ModelCompat, inst)
          : inst;
      }
      for (const inst of docs) {
        const plain = inst.get({ plain: true });
        const next = applyUpdate(plain, this._update);
        await inst.update(toRow(next));
        modified += 1;
        if (this._single) {
          return this._updateOptions.new
            ? wrapDocument(this.ModelCompat, await inst.reload())
            : inst;
        }
      }
      if (this._single) return null;
      return { acknowledged: true, modifiedCount: modified, matchedCount: docs.length };
    }

    const findOpts = { where };
    const sel = parseSelect(this._select);
    if (sel?.include?.length) findOpts.attributes = sel.include;
    if (sel?.exclude?.length) {
      findOpts.attributes = findOpts.attributes || { exclude: sel.exclude };
      if (Array.isArray(findOpts.attributes)) {
        // already include list
      } else {
        findOpts.attributes = { exclude: sel.exclude };
      }
    }
    const order = parseSort(this._sort);
    if (order) findOpts.order = order;
    if (this._limit != null) findOpts.limit = this._limit;
    if (this._skip != null) findOpts.offset = this._skip;

    if (this._single) {
      const inst = await sequelizeModel.findOne(findOpts);
      if (!inst) return null;
      let doc = this._lean ? fromRow(inst, { lean: true }) : wrapDocument(this.ModelCompat, inst);
      if (this._populate.length) {
        doc = await applyPopulate(this.ModelCompat, doc, this._populate, this._lean);
      }
      return doc;
    }

    const rows = await sequelizeModel.findAll(findOpts);
    let docs = rows.map((inst) =>
      this._lean ? fromRow(inst, { lean: true }) : wrapDocument(this.ModelCompat, inst)
    );
    if (this._populate.length) {
      docs = await Promise.all(
        docs.map((d) => applyPopulate(this.ModelCompat, d, this._populate, this._lean))
      );
    }
    return docs;
  }
}

function toWhereToPlain(filter) {
  return filterToPlain(filter);
}

function wrapDocument(ModelCompat, instance, { isNew = false } = {}) {
  let plain = instance && typeof instance.get === 'function'
    ? instance.get({ plain: true })
    : {};
  // Rebuild nested tallySync from denormalized columns (same as fromRow)
  if (
    plain.tallyId != null ||
    plain.tallyGuid != null ||
    plain.tallySynced != null ||
    plain.tallyLastSyncDate != null
  ) {
    plain = {
      ...plain,
      tallySync: {
        ...(plain.tallySync || {}),
        ...(plain.tallyId != null ? { tallyId: plain.tallyId } : {}),
        ...(plain.tallyGuid != null ? { tallyGuid: plain.tallyGuid } : {}),
        ...(plain.tallySynced != null ? { synced: plain.tallySynced } : {}),
        ...(plain.tallyLastSyncDate != null ? { lastSyncDate: plain.tallyLastSyncDate } : {}),
      },
    };
  }
  if (plain.id != null) plain._id = plain.id;

  const doc = {
    ...plain,
    _instance: instance || null,
    _model: ModelCompat,
    isNew: Boolean(isNew || !instance),
    async save() {
      syncDocAliases(this);
      const data = { ...this };
      delete data._instance;
      delete data._model;
      delete data.isNew;
      delete data.$__;
      delete data.$isNew;
      delete data.save;
      delete data.toObject;
      delete data.toJSON;
      delete data.populate;
      // Drop bound instance methods from row payload
      if (ModelCompat._instanceMethods) {
        for (const name of Object.keys(ModelCompat._instanceMethods)) {
          delete data[name];
        }
      }
      const row = toRow(data);
      if (this._instance) {
        await this._instance.update(row);
        await this._instance.reload();
        Object.assign(this, this._instance.get({ plain: true }));
        this._id = this.id;
      } else {
        if (!row.id) row.id = newId();
        const created = await ModelCompat.sequelizeModel.create(row);
        this._instance = created;
        Object.assign(this, created.get({ plain: true }));
        this._id = this.id;
        this.isNew = false;
      }
      return this;
    },
    toObject() {
      const o = { ...this };
      delete o._instance;
      delete o._model;
      delete o.isNew;
      delete o.save;
      delete o.toObject;
      delete o.toJSON;
      delete o.populate;
      if (ModelCompat._instanceMethods) {
        for (const name of Object.keys(ModelCompat._instanceMethods)) {
          delete o[name];
        }
      }
      if (o.id != null) o._id = o.id;
      return o;
    },
    toJSON() {
      return this.toObject();
    },
    async populate(path, select) {
      return applyPopulate(ModelCompat, this, [{ path, select }], false);
    },
  };

  // Attach instance methods from model definition
  if (ModelCompat._instanceMethods) {
    for (const [name, fn] of Object.entries(ModelCompat._instanceMethods)) {
      doc[name] = fn.bind(doc);
    }
  }

  return doc;
}

function syncDocAliases(doc) {
  if (doc.tallySync && typeof doc.tallySync === 'object') {
    if (doc.tallySync.tallyId != null) doc.tallyId = doc.tallySync.tallyId;
    if (doc.tallySync.tallyGuid != null) doc.tallyGuid = doc.tallySync.tallyGuid;
    if (doc.tallySync.synced != null) doc.tallySynced = doc.tallySync.synced;
  }
}

async function applyPopulate(ModelCompat, doc, populates, lean) {
  if (!doc) return doc;
  const registry = ModelCompat._registry;
  for (const p of populates) {
    const path = p.path;
    if (!path) continue;
    const ref = ModelCompat._refs?.[path];
    if (!ref || !registry) continue;
    const Target = registry[ref.model];
    if (!Target) continue;

    const isArray = ref.array;
    const raw = doc[path];
    if (raw == null) continue;

    if (isArray) {
      const ids = (Array.isArray(raw) ? raw : []).map((x) =>
        x && typeof x === 'object' ? x.id || x._id : x
      );
      const found = await Target.find({ id: { $in: ids } }).lean();
      const byId = new Map(found.map((f) => [String(f.id || f._id), f]));
      doc[path] = ids.map((id) => byId.get(String(id))).filter(Boolean);
      if (p.select && typeof p.select === 'string') {
        const fields = p.select.split(/\s+/).filter((f) => !f.startsWith('-'));
        if (fields.length) {
          doc[path] = doc[path].map((row) => {
            const o = { _id: row._id || row.id, id: row.id };
            for (const f of fields) o[f] = row[f];
            return o;
          });
        }
      }
    } else {
      const id = raw && typeof raw === 'object' ? raw.id || raw._id : raw;
      const found = await Target.findById(id);
      if (found) {
        const obj = lean || !found.toObject ? (found.toObject ? found.toObject() : found) : found;
        if (p.select && typeof p.select === 'string') {
          const fields = p.select.split(/\s+/).filter((f) => !f.startsWith('-'));
          const o = { _id: obj._id || obj.id, id: obj.id };
          for (const f of fields) o[f] = obj[f];
          doc[path] = o;
        } else {
          doc[path] = obj;
        }
      }
    }
  }
  return doc;
}

/**
 * Wrap a Sequelize model with Mongoose-like static API.
 */
export function createCompatModel(name, sequelizeModel, options = {}) {
  const ModelCompat = function Document(data = {}) {
    const doc = wrapDocument(ModelCompat, null, { isNew: true });
    Object.assign(doc, toRow(data || {}));
    if (!doc.id) doc.id = newId();
    doc._id = doc.id;
    doc.isNew = true;
    doc._instance = null;
    doc._model = ModelCompat;
    if (ModelCompat._instanceMethods) {
      for (const [n, fn] of Object.entries(ModelCompat._instanceMethods)) {
        doc[n] = fn.bind(doc);
      }
    }
    return doc;
  };

  ModelCompat.modelName = name;
  ModelCompat.sequelizeModel = sequelizeModel;
  ModelCompat._refs = options.refs || {};
  ModelCompat._instanceMethods = options.instanceMethods || {};
  ModelCompat._staticMethods = options.staticMethods || {};
  ModelCompat._registry = options.registry || null;

  ModelCompat.find = (filter = {}) => new CompatQuery(ModelCompat, filter);
  ModelCompat.findOne = (filter = {}) => new CompatQuery(ModelCompat, filter, { single: true });
  ModelCompat.findById = (id) =>
    new CompatQuery(ModelCompat, { id: id != null ? String(id) : null }, { single: true });

  ModelCompat.countDocuments = (filter = {}) =>
    new CompatQuery(ModelCompat, filter, { count: true }).exec();

  ModelCompat.deleteMany = (filter = {}) =>
    new CompatQuery(ModelCompat, filter, { delete: true }).exec();

  ModelCompat.deleteOne = async (filter = {}) => {
    const where = toWhere(filter);
    const row = await sequelizeModel.findOne({ where });
    if (!row) return { deletedCount: 0, acknowledged: true };
    await row.destroy();
    return { deletedCount: 1, acknowledged: true };
  };

  ModelCompat.updateOne = async (filter, update, opts = {}) => {
    const q = new CompatQuery(ModelCompat, filter, {
      single: true,
      update,
      updateOptions: opts,
    });
    const result = await q.exec();
    if (opts.new || opts.upsert) return result;
    return { acknowledged: true, modifiedCount: result ? 1 : 0, matchedCount: result ? 1 : 0 };
  };

  ModelCompat.updateMany = (filter, update, opts = {}) =>
    new CompatQuery(ModelCompat, filter, { update, updateOptions: opts }).exec();

  ModelCompat.findOneAndUpdate = async (filter, update, opts = {}) => {
    const where = toWhere(filter);
    let inst = await sequelizeModel.findOne({ where });
    if (!inst && opts.upsert) {
      const base = { id: newId(), ...toWhereToPlain(filter) };
      const merged = applyUpdate(base, update);
      inst = await sequelizeModel.create(toRow(merged));
      return opts.new !== false ? wrapDocument(ModelCompat, inst) : null;
    }
    if (!inst) return null;
    const plain = inst.get({ plain: true });
    const merged = applyUpdate(plain, update);
    await inst.update(toRow(merged));
    await inst.reload();
    return opts.new !== false ? wrapDocument(ModelCompat, inst) : wrapDocument(ModelCompat, inst);
  };

  ModelCompat.findByIdAndUpdate = async (id, update, opts = {}) =>
    ModelCompat.findOneAndUpdate({ id: String(id) }, update, opts);

  ModelCompat.findByIdAndDelete = async (id) => {
    const doc = await ModelCompat.findById(id);
    if (!doc) return null;
    await ModelCompat.deleteOne({ id: String(id) });
    return doc;
  };

  ModelCompat.create = async (data) => {
    if (Array.isArray(data)) {
      const docs = [];
      for (const item of data) {
        docs.push(await ModelCompat.create(item));
      }
      return docs;
    }
    const row = toRow({ id: data.id || data._id || newId(), ...data });
    const inst = await sequelizeModel.create(row);
    const doc = wrapDocument(ModelCompat, inst);
    if (ModelCompat._instanceMethods?.constructorInit) {
      // no-op hook placeholder
    }
    return doc;
  };

  ModelCompat.insertMany = async (items = []) => {
    const rows = items.map((d) => toRow({ id: d.id || d._id || newId(), ...d }));
    const created = await sequelizeModel.bulkCreate(rows);
    return created.map((inst) => wrapDocument(ModelCompat, inst));
  };

  ModelCompat.bulkWrite = async (ops = [], _options = {}) => {
    let inserted = 0;
    let upserted = 0;
    let modified = 0;
    for (const op of ops) {
      if (op.updateOne) {
        const { filter, update, upsert } = op.updateOne;
        const where = toWhere(filter);
        let inst = await sequelizeModel.findOne({ where });
        if (!inst && upsert) {
          const base = { id: newId(), ...toWhereToPlain(filter) };
          const merged = applyUpdate(base, update);
          await sequelizeModel.create(toRow(merged));
          upserted += 1;
        } else if (inst) {
          const merged = applyUpdate(inst.get({ plain: true }), update);
          await inst.update(toRow(merged));
          modified += 1;
        }
      } else if (op.insertOne) {
        await sequelizeModel.create(toRow({ id: newId(), ...op.insertOne.document }));
        inserted += 1;
      } else if (op.deleteOne) {
        await ModelCompat.deleteOne(op.deleteOne.filter);
      } else if (op.deleteMany) {
        await ModelCompat.deleteMany(op.deleteMany.filter);
      }
    }
    return {
      ok: 1,
      insertedCount: inserted,
      upsertedCount: upserted,
      modifiedCount: modified,
      matchedCount: modified + upserted,
    };
  };

  ModelCompat.distinct = async (field, filter = {}) => {
    const colName = aliasKey(field);
    const rows = await sequelizeModel.findAll({
      where: toWhere(filter),
      attributes: [colName],
      group: [colName],
      raw: true,
    });
    return rows.map((r) => r[colName]).filter((v) => v != null);
  };

  ModelCompat.exists = async (filter = {}) => {
    const n = await sequelizeModel.count({ where: toWhere(filter), limit: 1 });
    return n > 0 ? { _id: true } : null;
  };

  ModelCompat.estimatedDocumentCount = () => sequelizeModel.count();

  ModelCompat.aggregate = async (pipeline = []) => {
    // Minimal aggregate support for common patterns used in this codebase
    return runSimpleAggregate(ModelCompat, pipeline);
  };

  ModelCompat.paginate = async (filter = {}, options = {}) => {
    const page = Number(options.page) || 1;
    const limit = Number(options.limit) || 10;
    const skip = (page - 1) * limit;
    const sort = options.sort || { createdAt: -1 };
    const where = toWhere(filter);
    const totalDocs = await sequelizeModel.count({ where });
    const rows = await sequelizeModel.findAll({
      where,
      order: parseSort(sort),
      limit,
      offset: skip,
    });
    let docs = rows.map((inst) => wrapDocument(ModelCompat, inst));
    const populateOpts = options.populate;
    if (populateOpts) {
      const list = Array.isArray(populateOpts) ? populateOpts : [populateOpts];
      docs = await Promise.all(
        docs.map((d) => applyPopulate(ModelCompat, d, list, false))
      );
    }
    const totalPages = Math.ceil(totalDocs / limit) || 1;
    return {
      docs,
      totalDocs,
      limit,
      page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
      nextPage: page < totalPages ? page + 1 : null,
      prevPage: page > 1 ? page - 1 : null,
    };
  };

  ModelCompat.syncIndexes = async () => true;

  // Attach custom statics
  for (const [n, fn] of Object.entries(options.staticMethods || {})) {
    ModelCompat[n] = fn.bind(ModelCompat);
  }

  return ModelCompat;
}

async function runSimpleAggregate(ModelCompat, pipeline) {
  const sequelizeModel = ModelCompat.sequelizeModel;

  // Pull initial $match into SQL when possible (first stage only, before unwind/addFields)
  let initialMatch = {};
  let stageStart = 0;
  if (pipeline[0]?.$match) {
    initialMatch = pipeline[0].$match;
    stageStart = 1;
  }

  const where = toWhere(initialMatch);
  const rows = await sequelizeModel.findAll({ where });
  let docs = rows.map((r) => fromRow(r, { lean: true }));

  for (let i = stageStart; i < pipeline.length; i++) {
    const stage = pipeline[i];
    if (stage.$match) {
      docs = docs.filter((d) => matchDoc(d, stage.$match));
    } else if (stage.$addFields) {
      docs = docs.map((d) => {
        const next = { ...d };
        for (const [k, expr] of Object.entries(stage.$addFields)) {
          next[k] = evalExpr(expr, next);
        }
        return next;
      });
    } else if (stage.$unwind) {
      const path = typeof stage.$unwind === 'string'
        ? stage.$unwind.replace(/^\$/, '')
        : String(stage.$unwind?.path || '').replace(/^\$/, '');
      const preserve = Boolean(stage.$unwind?.preserveNullAndEmptyArrays);
      const next = [];
      for (const d of docs) {
        const arr = getNested(d, path);
        if (!Array.isArray(arr) || arr.length === 0) {
          if (preserve) next.push({ ...d, [path]: null });
          continue;
        }
        for (const el of arr) {
          next.push({ ...d, [path]: el });
        }
      }
      docs = next;
    } else if (stage.$lookup) {
      docs = await applyLookup(ModelCompat, docs, stage.$lookup);
    } else if (stage.$group) {
      docs = groupDocs(docs, stage.$group);
    } else if (stage.$sort) {
      const [[sk, dir]] = Object.entries(stage.$sort);
      docs.sort((a, b) => {
        const av = a[sk];
        const bv = b[sk];
        if (av === bv) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return dir === 1 || dir === 'asc' ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
      });
    } else if (stage.$limit) {
      docs = docs.slice(0, stage.$limit);
    } else if (stage.$project) {
      docs = docs.map((d) => {
        const o = {};
        for (const [k, v] of Object.entries(stage.$project)) {
          if (v === 0) continue;
          if (v === 1) o[k] = d[k];
          else if (typeof v === 'string' && v.startsWith('$')) o[k] = getNested(d, v.slice(1));
          else o[k] = evalExpr(v, d);
        }
        return o;
      });
    }
  }

  return docs;
}

function matchDoc(doc, filter = {}) {
  for (const [key, val] of Object.entries(filter || {})) {
    if (key === '$or') {
      if (!Array.isArray(val) || !val.some((f) => matchDoc(doc, f))) return false;
      continue;
    }
    if (key === '$and') {
      if (!Array.isArray(val) || !val.every((f) => matchDoc(doc, f))) return false;
      continue;
    }
    const actual = getNested(doc, key === '_id' ? 'id' : key) ?? getNested(doc, key);
    if (!matchValue(actual, val)) return false;
  }
  return true;
}

function matchValue(actual, expected) {
  if (expected instanceof RegExp) return expected.test(String(actual ?? ''));
  if (expected == null) return actual == null;
  if (typeof expected !== 'object' || expected instanceof Date) {
    return actual == expected || String(actual) === String(expected);
  }
  if (Object.getOwnPropertySymbols(expected).length) {
    // Sequelize Op objects shouldn't appear in in-memory match
    return false;
  }
  for (const [op, v] of Object.entries(expected)) {
    switch (op) {
      case '$eq':
        if (!(actual == v || String(actual) === String(v))) return false;
        break;
      case '$ne':
        if (actual == v || String(actual) === String(v)) return false;
        break;
      case '$gt':
        if (!(actual > v)) return false;
        break;
      case '$gte':
        if (!(actual >= v)) return false;
        break;
      case '$lt':
        if (!(actual < v)) return false;
        break;
      case '$lte':
        if (!(actual <= v)) return false;
        break;
      case '$in':
        if (!Array.isArray(v) || !v.map(String).includes(String(actual))) return false;
        break;
      case '$nin':
        if (Array.isArray(v) && v.map(String).includes(String(actual))) return false;
        break;
      case '$exists':
        if (Boolean(actual != null) !== Boolean(v)) return false;
        break;
      case '$regex': {
        const re = v instanceof RegExp ? v : new RegExp(String(v), expected.$options || '');
        if (!re.test(String(actual ?? ''))) return false;
        break;
      }
      case '$options':
        break;
      default:
        break;
    }
  }
  return true;
}

async function applyLookup(ModelCompat, docs, lu) {
  const registry = ModelCompat._registry || {};
  const from = lu.from;
  let targetModel =
    registry[from] ||
    registry[capitalize(from)] ||
    registry[capitalize(from.replace(/s$/, ''))] ||
    Object.values(registry).find(
      (m) =>
        m?.sequelizeModel?.tableName === from ||
        m?.modelName?.toLowerCase() === from ||
        `${m?.modelName?.toLowerCase()}s` === from
    );

  // Common collection name map
  if (!targetModel) {
    const map = {
      parties: 'Party',
      items: 'Item',
      users: 'User',
      companies: 'Company',
      vouchers: 'Voucher',
    };
    targetModel = registry[map[from]];
  }
  if (!targetModel) {
    return docs.map((d) => ({ ...d, [lu.as]: [] }));
  }

  const localKey = lu.localField;
  const foreignKey = lu.foreignField === '_id' ? 'id' : lu.foreignField;
  const ids = [
    ...new Set(
      docs
        .map((d) => getNested(d, localKey))
        .filter((x) => x != null && x !== '')
        .map(String)
    ),
  ];

  let foreignDocs = [];
  if (ids.length) {
    foreignDocs = await targetModel.find({ [foreignKey]: { $in: ids } }).lean();
  }
  const byId = new Map(foreignDocs.map((f) => [String(f[foreignKey] ?? f.id ?? f._id), f]));

  return docs.map((d) => {
    const local = getNested(d, localKey);
    const hit = local != null ? byId.get(String(local)) : null;
    return { ...d, [lu.as]: hit ? [hit] : [] };
  });
}

function groupDocs(docs, group) {
  const buckets = new Map();

  for (const doc of docs) {
    const idVal = evalExpr(group._id, doc);
    const key = stableKey(idVal);

    if (!buckets.has(key)) {
      const base = { _id: idVal };
      for (const [field, expr] of Object.entries(group)) {
        if (field === '_id') continue;
        if (expr?.$sum !== undefined) base[field] = 0;
        else if (expr?.$avg !== undefined) base[field] = { sum: 0, n: 0 };
        else if (expr?.$count !== undefined) base[field] = 0;
        else if (expr?.$push !== undefined) base[field] = [];
        else if (expr?.$first !== undefined) base[field] = undefined;
        else if (expr?.$max !== undefined) base[field] = undefined;
        else if (expr?.$min !== undefined) base[field] = undefined;
        else base[field] = null;
      }
      buckets.set(key, base);
    }

    const b = buckets.get(key);
    for (const [field, expr] of Object.entries(group)) {
      if (field === '_id') continue;
      if (expr?.$sum !== undefined) {
        b[field] += Number(evalExpr(expr.$sum, doc) || 0);
      } else if (expr?.$avg !== undefined) {
        b[field].sum += Number(evalExpr(expr.$avg, doc) || 0);
        b[field].n += 1;
      } else if (expr?.$count !== undefined) {
        b[field] += 1;
      } else if (expr?.$push !== undefined) {
        b[field].push(evalExpr(expr.$push, doc));
      } else if (expr?.$first !== undefined) {
        if (b[field] === undefined) b[field] = evalExpr(expr.$first, doc);
      } else if (expr?.$max !== undefined) {
        const v = evalExpr(expr.$max, doc);
        if (b[field] === undefined || (v != null && v > b[field])) b[field] = v;
      } else if (expr?.$min !== undefined) {
        const v = evalExpr(expr.$min, doc);
        if (b[field] === undefined || (v != null && v < b[field])) b[field] = v;
      }
    }
  }

  return [...buckets.values()].map((b) => {
    const o = { ...b };
    for (const [field, expr] of Object.entries(group)) {
      if (expr?.$avg !== undefined && o[field] && typeof o[field] === 'object' && o[field].n != null) {
        o[field] = o[field].n ? o[field].sum / o[field].n : 0;
      }
    }
    return o;
  });
}

function stableKey(val) {
  if (val == null) return 'null';
  if (typeof val === 'object') {
    if (val instanceof Date) return `d:${val.toISOString()}`;
    return JSON.stringify(val);
  }
  return String(val);
}

function evalExpr(expr, doc) {
  if (expr === 1 || expr === true) return 1;
  if (expr == null) return expr;
  if (typeof expr === 'number' || typeof expr === 'boolean') return expr;
  if (typeof expr === 'string') {
    if (expr.startsWith('$')) return getNested(doc, expr.slice(1));
    return expr;
  }
  if (expr instanceof Date) return expr;
  if (Array.isArray(expr)) return expr.map((e) => evalExpr(e, doc));
  if (typeof expr !== 'object') return expr;

  if (expr.$ifNull) {
    const [a, b, c] = expr.$ifNull;
    const av = evalExpr(a, doc);
    if (av != null && av !== '') return av;
    const bv = evalExpr(b, doc);
    if (bv != null && bv !== '') return bv;
    return c !== undefined ? evalExpr(c, doc) : null;
  }
  if (expr.$abs != null) return Math.abs(Number(evalExpr(expr.$abs, doc) || 0));
  if (expr.$multiply) {
    return expr.$multiply.reduce((acc, e) => acc * Number(evalExpr(e, doc) || 0), 1);
  }
  if (expr.$add) {
    return expr.$add.reduce((acc, e) => acc + Number(evalExpr(e, doc) || 0), 0);
  }
  if (expr.$sum != null) {
    // $sum over array path or literal
    if (typeof expr.$sum === 'string' && expr.$sum.startsWith('$')) {
      const v = getNested(doc, expr.$sum.slice(1));
      if (Array.isArray(v)) return v.reduce((a, x) => a + Number(x || 0), 0);
      return Number(v || 0);
    }
    if (Array.isArray(expr.$sum)) {
      return expr.$sum.reduce((a, e) => a + Number(evalExpr(e, doc) || 0), 0);
    }
    return Number(evalExpr(expr.$sum, doc) || 0);
  }
  if (expr.$cond) {
    const parts = Array.isArray(expr.$cond)
      ? expr.$cond
      : [expr.$cond.if, expr.$cond.then, expr.$cond.else];
    return evalBool(parts[0], doc) ? evalExpr(parts[1], doc) : evalExpr(parts[2], doc);
  }
  if (expr.$and) return expr.$and.every((e) => evalBool(e, doc));
  if (expr.$or) return expr.$or.some((e) => evalBool(e, doc));
  if (expr.$gt) return evalExpr(expr.$gt[0], doc) > evalExpr(expr.$gt[1], doc);
  if (expr.$gte) return evalExpr(expr.$gte[0], doc) >= evalExpr(expr.$gte[1], doc);
  if (expr.$lt) return evalExpr(expr.$lt[0], doc) < evalExpr(expr.$lt[1], doc);
  if (expr.$lte) return evalExpr(expr.$lte[0], doc) <= evalExpr(expr.$lte[1], doc);
  if (expr.$eq) return evalExpr(expr.$eq[0], doc) == evalExpr(expr.$eq[1], doc);
  if (expr.$ne) return evalExpr(expr.$ne[0], doc) != evalExpr(expr.$ne[1], doc);
  if (expr.$size != null) {
    const v = evalExpr(expr.$size, doc);
    return Array.isArray(v) ? v.length : 0;
  }
  if (expr.$arrayElemAt) {
    const arr = evalExpr(expr.$arrayElemAt[0], doc);
    const idx = evalExpr(expr.$arrayElemAt[1], doc);
    return Array.isArray(arr) ? arr[idx] : undefined;
  }
  if (expr.$trim) {
    const input = evalExpr(expr.$trim.input ?? expr.$trim, doc);
    return String(input ?? '').trim();
  }
  if (expr.$toLower != null) return String(evalExpr(expr.$toLower, doc) ?? '').toLowerCase();
  if (expr.$toUpper != null) return String(evalExpr(expr.$toUpper, doc) ?? '').toUpperCase();
  if (expr.$strLenCP != null) return String(evalExpr(expr.$strLenCP, doc) ?? '').length;
  if (expr.$dateToString) {
    const d = evalExpr(expr.$dateToString.date, doc);
    if (!d) return null;
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    // Support %Y-%m-%d used by dashboard
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Object used as group _id shape: evaluate each field
  const out = {};
  for (const [k, v] of Object.entries(expr)) {
    if (k.startsWith('$')) continue;
    out[k] = evalExpr(v, doc);
  }
  if (Object.keys(out).length) return out;
  return null;
}

function evalBool(expr, doc) {
  const v = evalExpr(expr, doc);
  return Boolean(v);
}

function getNested(obj, path) {
  if (obj == null || path == null || path === '') return obj;
  return String(path).split('.').reduce((o, p) => {
    if (o == null) return undefined;
    // Mongo-style: path into array of objects → map field
    if (Array.isArray(o)) {
      return o.map((el) => (el == null ? undefined : el[p]));
    }
    return o[p];
  }, obj);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { wrapDocument, CompatQuery, Op };
