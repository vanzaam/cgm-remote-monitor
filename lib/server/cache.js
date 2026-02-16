'use strict';

/* This is a simple cache intended to reduce the amount of load
 * Nightscout puts on MongoDB. The cache is based on identifying
 * elements based on the MongoDB _id field and implements simple
 * semantics for adding data to the cache in the runtime, intended
 * to be accessed by the persistence layer as data is inserted, updated
 * or deleted, as well as the periodic dataloader, which polls Mongo
 * for new inserts.
 *
 * Longer term, the cache is planned to allow skipping the Mongo polls
 * altogether.
 */

const _ = require('lodash');
const constants = require('../constants');

function cache (env, ctx) {

  const data = {
    treatments: []
    , devicestatus: []
    , entries: []
  };

  const retentionPeriods = {
    treatments: constants.ONE_HOUR * 60
    , devicestatus: env.extendedSettings.devicestatus && env.extendedSettings.devicestatus.days && env.extendedSettings.devicestatus.days == 2 ? constants.TWO_DAYS : constants.ONE_DAY
    , entries: constants.TWO_DAYS
  };

  function getObjectAge(object) {
    let age = object.mills || object.date;
    if (isNaN(age) && object.created_at) age = Date.parse(object.created_at).valueOf();
    return age;
  }

  function mergeCacheArrays (oldData, newData, retentionPeriod) {

    const ageLimit = Date.now() - retentionPeriod;

    var filteredOld = filterForAge(oldData, ageLimit);
    var filteredNew = filterForAge(newData, ageLimit);

    // Use Map-based merge instead of O(n²) idMergePreferNew
    const mergedMap = new Map();
    for (let i = 0; i < filteredOld.length; i++) {
      const item = filteredOld[i];
      if (item._id) mergedMap.set(String(item._id), item);
    }
    for (let i = 0; i < filteredNew.length; i++) {
      const item = filteredNew[i];
      if (item._id) mergedMap.set(String(item._id), item);
    }
    const merged = Array.from(mergedMap.values());

    return merged.sort(function(a, b) {
      const ageA = getObjectAge(a);
      const ageB = getObjectAge(b);
      return ageB - ageA;
    });

    function filterForAge(data, ageLimit) {
      return _.filter(data, function hasId(object) {
        const hasId = !_.isEmpty(object._id);
        const age = getObjectAge(object);
        const isFresh = age >= ageLimit;
        return isFresh && hasId;
      });
    }

  }

  data.isEmpty = (datatype) => {
    return data[datatype].length < 20;
  }

  data.getData = (datatype) => {
    return _.cloneDeep(data[datatype]);
  }

  data.insertData = (datatype, newData) => {
    data[datatype] = mergeCacheArrays(data[datatype], newData, retentionPeriods[datatype]);
    return data.getData(datatype);
  }

  function dataChanged (operation) {
    if (!data[operation.type]) return;

    if (operation.op == 'remove') {
      // if multiple items were deleted, flush entire cache
      if (!operation.changes) {
        data.treatments = [];
        data.devicestatus = [];
        data.entries = [];
      } else {
        removeFromArray(data[operation.type], operation.changes);
      }
    }

    if (operation.op == 'update') {
      data[operation.type] = mergeCacheArrays(data[operation.type], operation.changes, retentionPeriods[operation.type]);
    }
  }

  ctx.bus.on('data-update', dataChanged);

  function removeFromArray (array, id) {
    if (Array.isArray(id)) {
      for (let j = 0; j < id.length; j++) {
        removeFromArray(array, id[j]);
      }
      return;
    }
    var idStr = String(id);
    for (let i = 0; i < array.length; i++) {
      const o = array[i];
      if (String(o._id) == idStr) {
        //console.log('Deleting object from cache', id);
        array.splice(i, 1);
        break;
      }
    }
  }

  return data;
}

module.exports = cache;
