'use strict';

var find_options = require('./query');


function storage (env, ctx) {
   var ObjectId = require('mongodb').ObjectId;

  function create (obj, fn) {
    obj.created_at = (new Date( )).toISOString( );
    api().insertOne(obj).then(function () {
      fn(null, [obj]);
    }).catch(function (err) {
      console.log('Activity data insertion error', err.message);
      fn(err.message, null);
    });
  }

  function save (obj, fn) {
    obj._id = new ObjectId(obj._id);
    obj.created_at = (new Date( )).toISOString( );
    api().replaceOne({ _id: obj._id }, obj, { upsert: true }).then(function () {
      fn(null, obj);
    }).catch(function (err) {
      fn(err, null);
    });
  }

  function query_for (opts) {
    return find_options(opts, storage.queryOpts);
  }

  function list(opts, fn) {
    // these functions, find, sort, and limit, are used to
    // dynamically configure the request, based on the options we've
    // been given

    // determine sort options
    function sort ( ) {
      return opts && opts.sort || {created_at: -1};
    }

    // configure the limit portion of the current query
    function limit ( ) {
      if (opts && opts.count) {
        return this.limit(parseInt(opts.count));
      }
      return this;
    }

    // now just stitch them all together
    limit.call(api( )
        .find(query_for(opts))
        .sort(sort( ))
    ).toArray().then(function(entries) {
      fn(null, entries);
    }).catch(function(err) {
      fn(err, null);
    });
  }
  
  function remove (_id, fn) {
    var objId = new ObjectId(_id);
    return api( ).deleteOne({ '_id': objId }).then(function(result) {
      fn(null, result);
    }).catch(function(err) {
      fn(err, null);
    });
  }

  function api ( ) {
    return ctx.store.collection(env.activity_collection);
  }
  
  api.list = list;
  api.create = create;
  api.query_for = query_for;
  api.save = save;
  api.remove = remove;
  api.indexedFields = ['created_at'];
  return api;
}

module.exports = storage;

storage.queryOpts = {
  dateField: 'created_at'
};
