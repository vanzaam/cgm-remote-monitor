'use strict';

const utils = require('./utils')
  , _ = require('lodash')
  ;


/**
 * Find single document by identifier
 * @param {Object} col
 * @param {string} identifier
 * @param {Object} projection
 * @param {Object} options
 */
function findOne (col, identifier, projection, options) {

  return new Promise(function (resolve, reject) {

    const filter = utils.filterForOne(identifier);

    col.find(filter)
      .project(projection)
      .sort({ identifier: -1 }) // document with identifier first (not the fallback one)
      .toArray()
      .then(function (result) {
        if (!options || options.normalize !== false) {
          _.each(result, utils.normalizeDoc);
        }
        resolve(result);
      })
      .catch(function (err) { reject(err); });
  });
}


/**
 * Find single document by query filter
 * @param {Object} col
 * @param {Object} filter specific filter
 * @param {Object} projection
 * @param {Object} options
 */
function findOneFilter (col, filter, projection, options) {

  return new Promise(function (resolve, reject) {

    col.find(filter)
      .project(projection)
      .sort({ identifier: -1 }) // document with identifier first (not the fallback one)
      .toArray()
      .then(function (result) {
        if (!options || options.normalize !== false) {
          _.each(result, utils.normalizeDoc);
        }
        resolve(result);
      })
      .catch(function (err) { reject(err); });
  });
}


/**
 * Find many documents matching the filtering criteria
 */
function findMany (col, args) {
  const logicalOperator = args.logicalOperator || 'and';
  return new Promise(function (resolve, reject) {

    const filter = utils.parseFilter(args.filter, logicalOperator, args.onlyValid);

    col.find(filter)
      .sort(args.sort)
      .limit(args.limit)
      .skip(args.skip)
      .project(args.projection)
      .toArray()
      .then(function (result) {
        if (!args.options || args.options.normalize !== false) {
          _.each(result, utils.normalizeDoc);
        }
        resolve(result);
      })
      .catch(function (err) { reject(err); });
  });
}


module.exports = {
  findOne,
  findOneFilter,
  findMany
};
