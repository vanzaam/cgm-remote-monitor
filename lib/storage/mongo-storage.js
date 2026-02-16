'use strict';

const { MongoClient } = require('mongodb');

const mongo = {
  client: null,
  db: null,
};

function init(env, cb, forceNewConnection) {

  function maybe_connect(cb) {

    if (mongo.db != null && !forceNewConnection) {
      console.log('Reusing MongoDB connection handler');
      // If there is a valid callback, then return the Mongo-object

      if (cb && cb.call) {
        cb(null, mongo);
      }
    } else {
      if (!env.storageURI) {
        throw new Error('MongoDB connection string is missing. Please set MONGODB_URI environment variable');
      }

      console.log('Setting up new connection to MongoDB');
      const options = {
        maxPoolSize: 5,
        minPoolSize: 1,
        maxIdleTimeMS: 30000,
        serverSelectionTimeoutMS: 20000,
        socketTimeoutMS: 45000,
      };

      var bootErrorReported = false;
      var bootCallbackFired = false;

      const connect_with_retry = async function (i) {

        if (mongo.client) {
          try {
            await mongo.client.close();
          } catch (err) {
            console.warn('Error closing previous MongoDB client', err.message || err);
          }
          mongo.client = null;
          mongo.db = null;
        }

        mongo.client = new MongoClient(env.storageURI, options);
        try {
          await mongo.client.connect();

          console.log('Successfully established connection to MongoDB');

          // Use driver's built-in method to get database from connection URI
          mongo.db = mongo.client.db();

          const result = await mongo.db.command({ connectionStatus: 1 });
          const roles = result.authInfo.authenticatedUserRoles;
          if (roles.length > 0 && roles[0].role == 'readAnyDatabase') {
            console.error('Mongo user is read only');
            cb(new Error('MongoDB connection is in read only mode! Go back to MongoDB configuration and check your database user has read and write access.'), null);
            return;
          }

          console.log('Mongo user role seems ok:', roles);

          if (bootErrorReported) {
            console.log('MongoDB recovered after boot error! Signaling recovery...');
          }

          // If there is a valid callback, then invoke the function to perform the callback
          if (cb && cb.call) {
            if (!bootCallbackFired) {
              bootCallbackFired = true;
              cb(null, mongo);
            } else if (bootErrorReported) {
              // Recovery after boot error — call cb again to signal reconnection
              cb(null, mongo);
            }
          }
        } catch (err) {
          if (err && err.message && err.message.includes('Cannot use import statement outside a module')) {
            console.error('MongoDB connect error stack:', err.stack || err);
          }
          if (mongo.client) {
            mongo.client.close().catch(function(closeErr) {
              console.warn('Error closing failed MongoDB client', closeErr.message || closeErr);
            });
            mongo.client = null;
            mongo.db = null;
          }
          if (err.message && err.message.includes('AuthenticationFailed')) {
            console.log('Authentication to Mongo failed');
            cb(new Error('MongoDB authentication failed! Double check the URL has the right username and password in MONGODB_URI.'), null);
            return;
          }

          if (err.name && err.name === "MongoServerSelectionError") {
            // Calculate retry timeout: 3s, 6s, 9s, ... up to 300s (5 min)
            var timeout;
            if (i <= 15) {
              timeout = i * 3000;
            } else if (i <= 30) {
              timeout = 60000; // 1 min
            } else {
              timeout = 300000; // 5 min
            }
            console.log('Error connecting to MongoDB (attempt ' + i + '): ' + err.message + ' - retrying in ' + timeout / 1000 + ' sec');
            setTimeout(connect_with_retry, timeout, i + 1);

            // Report boot error after first failure so server can start and show "Retrying..." page
            if (i >= 1 && !bootErrorReported) {
              bootErrorReported = true;
              bootCallbackFired = true;
              cb(new Error('MongoDB connection failed (attempt ' + i + '). Starting server anyway; retrying in background. Check MONGODB_URI if this persists.'), null);
            }
          } else {
            cb(new Error('MONGODB_URI seems invalid: ' + err.message));
          }
        }
      };

      return connect_with_retry(1);

    }
  }

  mongo.collection = function get_collection(name) {
    return mongo.db.collection(name);
  };

  mongo.ensureIndexes = function ensureIndexes(collection, fields) {
    fields.forEach(function (field) {
      console.info('ensuring index for: ' + field);
      collection.createIndex(field, { 'background': true }).catch(function (err) {
        console.error('unable to ensureIndex for: ' + field + ' - ' + err);
      });
    });
  };

  return maybe_connect(cb);
}

module.exports = init;
