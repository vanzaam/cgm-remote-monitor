'use strict';

/**
 * In-memory storage backend that implements the same interface as mongo-storage.
 *
 * Used for:
 * - Unit testing without MongoDB
 * - Running Nightscout in demo/simulator mode
 * - Fallback when MongoDB is unavailable
 *
 * Data is stored in plain JS objects. Supports find, insert, replace,
 * update, delete with basic query matching.
 */

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var os = require('os');

var PERSIST_DIR = process.env.NIGHTSCOUT_BUFFER_DIR || path.join(os.tmpdir(), 'nightscout-buffer');
var PERSIST_FILE = 'memory-store.json';
var PERSIST_DEBOUNCE_MS = 5000; // Dump to disk at most every 5 seconds

function init (env, cb) {

  var store = {
    db: null
  };

  var collections = {};
  var persistTimer = null;
  var persistPath = path.join(PERSIST_DIR, PERSIST_FILE);

  // Load persisted data from disk on startup
  try {
    fs.mkdirSync(PERSIST_DIR, { recursive: true });
    if (fs.existsSync(persistPath)) {
      var raw = fs.readFileSync(persistPath, 'utf8');
      var loaded = JSON.parse(raw);
      Object.keys(loaded).forEach(function (name) {
        if (Array.isArray(loaded[name])) {
          collections[name] = loaded[name];
        }
      });
      var totalDocs = Object.values(collections).reduce(function (s, c) { return s + c.length; }, 0);
      console.log('Memory storage: loaded', totalDocs, 'documents from', Object.keys(collections).length, 'collections on disk');
    }
  } catch (e) {
    console.warn('Memory storage: failed to load persisted data:', e.message);
  }

  /**
   * Schedule a debounced persist to disk.
   * Writes at most once every PERSIST_DEBOUNCE_MS.
   */
  function schedulePersist () {
    if (persistTimer) return;
    persistTimer = setTimeout(function () {
      persistTimer = null;
      persistToDisk();
    }, PERSIST_DEBOUNCE_MS);
  }

  function persistToDisk () {
    try {
      fs.writeFileSync(persistPath, JSON.stringify(collections), 'utf8');
    } catch (e) {
      console.warn('Memory storage: persist failed:', e.message);
    }
  }

  function getOrCreateCollection (name) {
    if (!collections[name]) {
      collections[name] = [];
    }
    return new MemoryCollection(name, collections[name], schedulePersist);
  }

  store.collection = function collection (name) {
    return getOrCreateCollection(name);
  };

  store.ensureIndexes = function ensureIndexes () {
    // No-op for in-memory storage — indexes not needed
  };

  // Minimal db object for compatibility
  store.db = {
    stats: function () {
      var totalDocs = 0;
      Object.keys(collections).forEach(function (name) {
        totalDocs += collections[name].length;
      });
      return Promise.resolve({
        dataSize: totalDocs * 200,
        indexSize: totalDocs * 50
      });
    }
  };

  store.client = {
    close: function () {
      // Final persist before shutdown
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
      persistToDisk();
      collections = {};
    }
  };

  if (cb && cb.call) {
    cb(null, store);
  }

  return store;
}

/**
 * In-memory MongoDB Collection mock.
 * Implements the subset of MongoDB Collection API used by Nightscout.
 */
function MemoryCollection (name, data, onMutate) {
  this.name = name;
  this.data = data;
  this._onMutate = onMutate || function () {};
}

MemoryCollection.prototype.insertOne = function insertOne (doc) {
  if (!doc._id) {
    doc._id = crypto.randomBytes(12).toString('hex');
  }
  this.data.push(JSON.parse(JSON.stringify(doc)));
  this._onMutate();
  return Promise.resolve({ insertedId: doc._id });
};

MemoryCollection.prototype.insertMany = function insertMany (docs, opts) {
  var self = this;
  var inserted = 0;
  docs.forEach(function (doc) {
    if (!doc._id) doc._id = crypto.randomBytes(12).toString('hex');
    // Check for duplicates if ordered is not false
    var exists = self.data.some(function (d) {
      return d._id && d._id.toString() === doc._id.toString();
    });
    if (!exists) {
      self.data.push(JSON.parse(JSON.stringify(doc)));
      inserted++;
    }
  });
  if (inserted > 0) this._onMutate();
  return Promise.resolve({ insertedCount: inserted });
};

MemoryCollection.prototype.replaceOne = function replaceOne (filter, doc, opts) {
  var idx = findIndex(this.data, filter);
  if (idx >= 0) {
    var id = this.data[idx]._id;
    this.data[idx] = JSON.parse(JSON.stringify(doc));
    this.data[idx]._id = id;
    this._onMutate();
    return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
  }
  if (opts && opts.upsert) {
    if (!doc._id) doc._id = crypto.randomBytes(12).toString('hex');
    this.data.push(JSON.parse(JSON.stringify(doc)));
    this._onMutate();
    return Promise.resolve({ matchedCount: 0, upsertedCount: 1, upsertedId: doc._id });
  }
  return Promise.resolve({ matchedCount: 0, modifiedCount: 0 });
};

MemoryCollection.prototype.updateOne = function updateOne (filter, update) {
  var idx = findIndex(this.data, filter);
  if (idx >= 0) {
    if (update.$set) {
      Object.keys(update.$set).forEach(function (key) {
        this.data[idx][key] = update.$set[key];
      }.bind(this));
    }
    if (update.$unset) {
      Object.keys(update.$unset).forEach(function (key) {
        delete this.data[idx][key];
      }.bind(this));
    }
    this._onMutate();
    return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
  }
  return Promise.resolve({ matchedCount: 0, modifiedCount: 0 });
};

MemoryCollection.prototype.deleteOne = function deleteOne (filter) {
  var idx = findIndex(this.data, filter);
  if (idx >= 0) {
    this.data.splice(idx, 1);
    this._onMutate();
    return Promise.resolve({ deletedCount: 1 });
  }
  return Promise.resolve({ deletedCount: 0 });
};

MemoryCollection.prototype.deleteMany = function deleteMany (filter) {
  var before = this.data.length;
  var matching = findAll(this.data, filter);
  matching.forEach(function (doc) {
    var idx = this.data.indexOf(doc);
    if (idx >= 0) this.data.splice(idx, 1);
  }.bind(this));
  if (this.data.length !== before) this._onMutate();
  return Promise.resolve({ deletedCount: before - this.data.length });
};

MemoryCollection.prototype.findOne = function findOne (filter, opts) {
  var doc = findFirst(this.data, filter || {});
  return Promise.resolve(doc ? JSON.parse(JSON.stringify(doc)) : null);
};

MemoryCollection.prototype.find = function find (filter) {
  var results = filter ? findAll(this.data, filter) : this.data.slice();
  return new MemoryCursor(results);
};

MemoryCollection.prototype.createIndex = function createIndex () {
  return Promise.resolve();
};

/**
 * In-memory cursor with sort/limit/toArray chain.
 */
function MemoryCursor (data) {
  this.data = data.map(function (d) { return JSON.parse(JSON.stringify(d)); });
}

MemoryCursor.prototype.sort = function sort (sortSpec) {
  if (!sortSpec) return this;
  var keys = Object.keys(sortSpec);
  if (keys.length > 0) {
    var key = keys[0];
    var dir = sortSpec[key] === -1 ? -1 : 1;
    this.data.sort(function (a, b) {
      if (a[key] < b[key]) return -1 * dir;
      if (a[key] > b[key]) return 1 * dir;
      return 0;
    });
  }
  return this;
};

MemoryCursor.prototype.limit = function limit (n) {
  if (n && n > 0) {
    this.data = this.data.slice(0, n);
  }
  return this;
};

MemoryCursor.prototype.toArray = function toArray () {
  return Promise.resolve(this.data);
};

/**
 * Query matching (supports equality, $gte, $lte, $gt, $lt, $ne, $in, $and, $or, $exists).
 */
function matches (doc, filter) {
  if (!filter || Object.keys(filter).length === 0) return true;

  return Object.keys(filter).every(function (key) {
    if (key === '$and') {
      return filter.$and.every(function (sub) { return matches(doc, sub); });
    }
    if (key === '$or') {
      return filter.$or.some(function (sub) { return matches(doc, sub); });
    }
    if (key === '_id') {
      return doc._id && doc._id.toString() === filter._id.toString();
    }

    var filterVal = filter[key];
    var docVal = doc[key];

    // Comparison operators: { field: { $gte: value, $lte: value, ... } }
    if (filterVal && typeof filterVal === 'object' && !Array.isArray(filterVal)) {
      var ops = Object.keys(filterVal);
      if (ops.some(function (o) { return o.charAt(0) === '$'; })) {
        return ops.every(function (op) {
          var target = filterVal[op];
          switch (op) {
            case '$gte': return docVal >= target;
            case '$gt':  return docVal > target;
            case '$lte': return docVal <= target;
            case '$lt':  return docVal < target;
            case '$ne':  return docVal !== target;
            case '$in':  return Array.isArray(target) && target.indexOf(docVal) >= 0;
            case '$exists': return target ? (docVal !== undefined) : (docVal === undefined);
            case '$regex': return new RegExp(target, filterVal.$options || '').test(docVal);
            default: return true;
          }
        });
      }
    }

    return docVal === filterVal;
  });
}

function findFirst (data, filter) {
  for (var i = 0; i < data.length; i++) {
    if (matches(data[i], filter)) return data[i];
  }
  return null;
}

function findAll (data, filter) {
  return data.filter(function (doc) { return matches(doc, filter); });
}

function findIndex (data, filter) {
  for (var i = 0; i < data.length; i++) {
    if (matches(data[i], filter)) return i;
  }
  return -1;
}

module.exports = init;
