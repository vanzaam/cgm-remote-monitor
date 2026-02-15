'use strict';

const utils = require('./utils')
  ;

/**
 * Insert single document
 * @param {Object} col
 * @param {Object} doc
 * @param {Object} options
 */
function insertOne (col, doc, options) {

  return new Promise(function (resolve, reject) {

    col.insertOne(doc)
      .then(function (result) {
        const identifier = doc.identifier || result.insertedId.toString();

        if (!options || options.normalize !== false) {
          delete doc._id;
        }
        resolve(identifier);
      })
      .catch(function (err) { reject(err); });
  });
}


/**
 * Replace single document
 * @param {Object} col
 * @param {string} identifier
 * @param {Object} doc
 */
function replaceOne (col, identifier, doc) {

  return new Promise(function (resolve, reject) {

    const filter = utils.filterForOne(identifier);

    col.replaceOne(filter, doc, { upsert: true })
      .then(function (result) {
        resolve(result.matchedCount);
      })
      .catch(function (err) { reject(err); });
  });
}


/**
 * Update single document by identifier
 * @param {Object} col
 * @param {string} identifier
 * @param {object} setFields
 */
function updateOne (col, identifier, setFields) {

  return new Promise(function (resolve, reject) {

    const filter = utils.filterForOne(identifier);

    col.updateOne(filter, { $set: setFields })
      .then(function (result) {
        resolve({ updated: result.modifiedCount });
      })
      .catch(function (err) { reject(err); });
  });
}


/**
 * Permanently remove single document by identifier
 * @param {Object} col
 * @param {string} identifier
 */
function deleteOne (col, identifier) {

  return new Promise(function (resolve, reject) {

    const filter = utils.filterForOne(identifier);

    col.deleteOne(filter)
      .then(function (result) {
        resolve({ deleted: result.deletedCount });
      })
      .catch(function (err) { reject(err); });
  });
}


/**
 * Permanently remove many documents matching any of filtering criteria
 */
function deleteManyOr (col, filterDef) {

  return new Promise(function (resolve, reject) {

    const filter = utils.parseFilter(filterDef, 'or');

    col.deleteMany(filter)
      .then(function (result) {
        resolve({ deleted: result.deletedCount });
      })
      .catch(function (err) { reject(err); });
  });
}


module.exports = {
  insertOne,
  replaceOne,
  updateOne,
  deleteOne,
  deleteManyOr
};
