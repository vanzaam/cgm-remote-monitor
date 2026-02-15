'use strict';

function storage (env, ctx) {
   var ObjectId = require('mongodb').ObjectId;

  function create (obj, fn) {
    obj.created_at = (new Date( )).toISOString( );
    api().insertOne(obj).then(function () {
      fn(null, [obj]);
    }).catch(function (err) {
      console.log('Data insertion error', err.message);
      fn(err.message, null);
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
      fn(err, null);
    });
  }

  function list (fn) {
    return api( ).find({ }).toArray().then(function(results) {
      fn(null, results);
    }).catch(function(err) {
      fn(err, null);
    });
  }
  
  function listquickpicks (fn) {
    return api( ).find({ $and: [ { 'type': 'quickpick'} , { 'hidden' : 'false' } ] }).sort({'position': 1}).toArray().then(function(results) {
      fn(null, results);
    }).catch(function(err) {
      fn(err, null);
    });
  }
  
  function listregular (fn) {
    return api( ).find( { 'type': 'food'} ).toArray().then(function(results) {
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
