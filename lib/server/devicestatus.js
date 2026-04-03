'use strict';

var moment = require('moment');
var find_options = require('./query');

function storage (collection, ctx) {

  function create (statuses, fn) {

    if (!Array.isArray(statuses)) { statuses = [statuses]; }

    const r = [];

    const insertPromises = statuses.map(function insertStatus (obj) {
      // Normalize all dates to UTC
      const d = moment(obj.created_at).isValid() ? moment.parseZone(obj.created_at) : moment();
      obj.created_at = d.toISOString();
      obj.utcOffset = d.utcOffset();

      return api().insertOne(obj).then(function(results) {
        if (!obj._id) obj._id = results.insertedId;
        r.push(obj);

        ctx.bus.emit('data-update', {
          type: 'devicestatus'
          , op: 'update'
          , changes: ctx.ddata.processRawDataForRuntime([obj])
        });
      });
    });

    Promise.all(insertPromises).then(function () {
      fn(null, r);
      ctx.bus.emit('data-received');
    }).catch(function(err) {
      console.log('Error inserting the device status object', err.message);
      // MongoDB write failed — buffer to disk if available
      if (ctx.diskBuffer) {
        statuses.forEach(function (obj) {
          ctx.diskBuffer.append('devicestatus', obj);
          ctx.bus.emit('data-update', {
            type: 'devicestatus',
            op: 'update',
            changes: ctx.ddata.processRawDataForRuntime([obj])
          });
        });
        fn(null, statuses);
        ctx.bus.emit('data-received');
      } else {
        fn(err.message, null);
      }
    });
  }

  function last (fn) {
    return list({ count: 1 }, function(err, entries) {
      if (entries && entries.length > 0) {
        fn(err, entries[0]);
      } else {
        fn(err, null);
      }
    });
  }

  function query_for (opts) {
    return find_options(opts, storage.queryOpts);
  }

  function list (opts, fn) {
    // these functions, find, sort, and limit, are used to
    // dynamically configure the request, based on the options we've
    // been given

    // determine sort options
    function sort () {
      return opts && opts.sort || { created_at: -1 };
    }

    // configure the limit portion of the current query
    function limit () {
      if (opts && opts.count) {
        return this.limit(parseInt(opts.count));
      }
      return this;
    }

    // now just stitch them all together
    limit.call(api()
      .find(query_for(opts))
      .sort(sort())
    ).toArray().then(function(entries) {
      fn(null, entries);
    }).catch(function(err) {
      // MongoDB read failed — fall back to in-memory data
      if (ctx.ddata && ctx.ddata.devicestatus && ctx.ddata.devicestatus.length > 0) {
        console.log('Devicestatus list: MongoDB unavailable, serving from in-memory cache (' + ctx.ddata.devicestatus.length + ' entries)');
        fn(null, ctx.ddata.devicestatus);
      } else {
        fn(err, null);
      }
    });
  }

  function remove (opts, fn) {

    return api().deleteMany(
      query_for(opts)).then(function(stat) {

      ctx.bus.emit('data-update', {
        type: 'devicestatus'
        , op: 'remove'
        , count: stat.deletedCount
        , changes: opts.find._id
      });

      fn(null, stat);
    }).catch(function(err) {
      fn(err, null);
    });
  }

  function api () {
    return ctx.store.collection(collection);
  }

  api.list = list;
  api.create = create;
  api.query_for = query_for;
  api.last = last;
  api.remove = remove;
  api.aggregate = require('./aggregate')({}, api);
  api.indexedFields = [
    'created_at'



  
    , 'NSCLIENT_ID'
  ];
  return api;
}

storage.queryOpts = {
  dateField: 'created_at'
};

module.exports = storage;
