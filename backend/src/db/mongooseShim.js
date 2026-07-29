/**
 * Lightweight mongoose shim for leftover ObjectId / isValidObjectId usage
 * after migrating to MySQL + Sequelize.
 */
import { newId, isValidId } from '../db/queryUtils.js';

class ObjectId {
  constructor(id) {
    this.id = id != null ? String(id) : newId();
  }
  toString() {
    return this.id;
  }
  toHexString() {
    return this.id;
  }
  valueOf() {
    return this.id;
  }
  equals(other) {
    return String(this.id) === String(other?.id || other);
  }
  static isValid(id) {
    return isValidId(id);
  }
}

const mongoose = {
  Types: { ObjectId },
  Schema: {
    Types: { ObjectId, Mixed: Object, String, Number, Boolean, Date, Buffer },
    ObjectId,
  },
  models: {},
  model() {
    throw new Error('mongoose.model is disabled — use Sequelize models');
  },
  connect() {
    throw new Error('mongoose.connect is disabled — use connectDB() MySQL');
  },
  connection: {
    readyState: 0,
    collection() {
      return {
        indexes: async () => [],
        dropIndex: async () => {},
      };
    },
  },
  isValidObjectId: isValidId,
  TypesObjectId: ObjectId,
};

export { ObjectId };
export default mongoose;
