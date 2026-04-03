'use strict';

function storage (env, ctx) {
   var ObjectId = require('mongodb').ObjectId;

  function create (obj, fn) {
    obj.created_at = (new Date( )).toISOString( );
    api().insertOne(obj).then(function () {
      fn(null, [obj]);
    }).catch(function (err) {
      console.log('Data insertion error', err.message);
      if (ctx.diskBuffer) {
        ctx.diskBuffer.append(env.food_collection, obj);
        fn(null, [obj]);
      } else {
        fn(err.message, null);
      }
    });
  }

  function save (obj, fn) {
    try {
      obj._id = new ObjectId(obj._id);
    } catch (err){
      console.error(err);
      obj._id = new ObjectId();
    }
    obj.created_at = (new Date( )).toISOString( );
    api().replaceOne({ _id: obj._id }, obj, { upsert: true }).then(function () {
      fn(null, obj);
    }).catch(function (err) {
      if (ctx.diskBuffer) {
        ctx.diskBuffer.append(env.food_collection, obj);
        fn(null, obj);
      } else {
        fn(err, null);
      }
    });
  }

  function list (fn) {
    var col = api();
    if (!col) return fn(null, ctx.ddata && ctx.ddata.food || []);
    return col.find({ }).toArray().then(function(results) {
      fn(null, results);
    }).catch(function(err) {
      fn(err, null);
    });
  }

  function listquickpicks (fn) {
    var col = api();
    if (!col) return fn(null, []);
    return col.find({ $and: [ { 'type': 'quickpick'} , { 'hidden' : 'false' } ] }).sort({'position': 1}).toArray().then(function(results) {
      fn(null, results);
    }).catch(function(err) {
      fn(err, null);
    });
  }

  function listregular (fn) {
    var col = api();
    if (!col) return fn(null, []);
    return col.find( { 'type': 'food'} ).toArray().then(function(results) {
      fn(null, results);
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
    if (!ctx.store) return null;
    return ctx.store.collection(env.food_collection);
  }
  
  api.list = list;
  api.listquickpicks = listquickpicks;
  api.listregular = listregular;
  api.create = create;
  api.save = save;
  api.remove = remove;
  api.indexedFields = ['type','position','hidden'];
  return api;
}

module.exports = storage;
