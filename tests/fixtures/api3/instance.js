'use strict';

var fs = require('fs')
  , language = require('../../../lib/language')()
  , api = require('../../../lib/api3/')
  , http = require('http')
  , https = require('https')
  , request = require('supertest')
  , websocket = require('../../../lib/server/websocket')
  , io = require('socket.io-client')
  , CacheMonitor = require('./cacheMonitor')
  ;

function configure () {
  const self = { };

  self.prepareEnv = function prepareEnv({ apiSecret, useHttps, authDefaultRoles, enable }) {

    if (useHttps) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
    else {
      process.env.INSECURE_USE_HTTP = true;
    }
    process.env.API_SECRET = apiSecret;

    process.env.HOSTNAME = 'localhost';
    // Set MongoDB connection for API3 tests
    process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/testdb';
    
    const env = require('../../../lib/server/env')();

    if (useHttps) {
      env.ssl = {
        key: fs.readFileSync(__dirname + '/localhost.key'),
        cert: fs.readFileSync(__dirname + '/localhost.crt')
      };
    }

    env.settings.authDefaultRoles = authDefaultRoles;
    env.settings.enable = enable;

    return env;
  };


  function addJwt (req, jwt) {
    return jwt
      ? req.set('Authorization', `Bearer ${jwt}`)
      : req;
  }


  self.addSecuredOperations = function addSecuredOperations (instance) {

    instance.get = (url, jwt) => addJwt(request(instance.baseUrl).get(url), jwt);

    instance.post = (url, jwt) => addJwt(request(instance.baseUrl).post(url), jwt);

    instance.put = (url, jwt) => addJwt(request(instance.baseUrl).put(url), jwt);

    instance.patch = (url, jwt) => addJwt(request(instance.baseUrl).patch(url), jwt);

    instance.delete = (url, jwt) => addJwt(request(instance.baseUrl).delete(url), jwt);
  };



  self.bindSocket = function bindSocket (storageSocket, instance) {

    return new Promise(function (resolve, reject) {
      if (!storageSocket) {
        resolve();
      }
      else {
        let socket = io(`${instance.baseUrl}/storage`, {
          origins:"*",
          transports: ['websocket', 'flashsocket', 'polling'],
          rejectUnauthorized: false
        });

        socket.on('connect', function () {
          resolve(socket);
        });
        socket.on('connect_error', function (error) {
          console.error(error);
          reject(error);
        });
      }
    });
  };


  self.unbindSocket = function unbindSocket (instance) {
    if (instance.clientSocket.connected) {
      instance.clientSocket.disconnect();
    }
  };

  /*
   * Create new web server instance for testing purposes
   */
  self.create = function createHttpServer ({
    apiSecret = 'this is my long pass phrase',
    disableSecurity = false,
    useHttps = true,
    authDefaultRoles = '',
    enable = ['careportal', 'api'],
    storageSocket = null
    }) {

    return new Promise(function (resolve, reject) {

      try {
        let instance = { },
          hasBooted = false
          ;

        function waitForMongo (ctx) {
          return new Promise(function (resolveWait, rejectWait) {
            // Check if MongoDB is already connected
            if (ctx.store && ctx.store.db && ctx.store.db.serverConfig && ctx.store.db.serverConfig.isConnected()) {
              ctx.bootErrors = [];
              return resolveWait();
            }
            
            const timeout = setTimeout(function () {
              rejectWait(new Error('mongo-recovered timeout'));
            }, 10000); // Reduce timeout for faster feedback
            
            if (ctx.bus && ctx.bus.once) {
              ctx.bus.once('mongo-recovered', function () {
                clearTimeout(timeout);
                ctx.bootErrors = [];
                resolveWait();
              });
            } else {
              clearTimeout(timeout);
              rejectWait(new Error('mongo-recovered event bus unavailable'));
            }
          });
        }

        function ensureAuthorization (ctx) {
          if (ctx.authorization) {
            return Promise.resolve();
          }
          ctx.authorization = require('../../../lib/authorization')(instance.env, ctx);
          ctx.authorization.storage.ensureIndexes();
          return new Promise(function (resolveAuth, rejectAuth) {
            ctx.authorization.storage.reload(function loaded (err) {
              if (err) {
                return rejectAuth(err);
              }
              resolveAuth();
            });
          });
        }

        instance.env = self.prepareEnv({ apiSecret, useHttps, authDefaultRoles, enable });

        self.wares = require('../../../lib/middleware/')(instance.env);
        instance.app = require('express')();
        instance.app.enable('api');

        require('../../../lib/server/bootevent')(instance.env, language).boot(function booted (ctx) {
          instance.ctx = ctx;

          console.log('API3 Instance bootErrors:', ctx.bootErrors ? ctx.bootErrors.length : 'none');
          console.log('API3 Instance ctx.store:', !!ctx.store);
          
          const bootSequence = (ctx.bootErrors && ctx.bootErrors.length > 0)
            ? waitForMongo(ctx).then(function () { return ensureAuthorization(ctx); })
            : ensureAuthorization(ctx);

          bootSequence.then(function () {
            instance.ctx.ddata = require('../../../lib/data/ddata')();
            instance.ctx.apiApp = api(instance.env, ctx);

            if (disableSecurity) {
              instance.ctx.apiApp.set('API3_SECURITY_ENABLE', false);
            }

            instance.app.use('/api/v3', instance.ctx.apiApp);
            instance.app.use('/api/v2/authorization', instance.ctx.authorization.endpoints);

            const transport = useHttps ? https : http;

            instance.server = transport.createServer(instance.env.ssl || { }, instance.app).listen(0);
            instance.env.PORT = instance.server.address().port;

            instance.baseUrl = `${useHttps ? 'https' : 'http'}://${instance.env.HOSTNAME}:${instance.env.PORT}`;

            self.addSecuredOperations(instance);
            instance.cacheMonitor = new CacheMonitor(instance).listen();

            websocket(instance.env, instance.ctx, instance.server);

            self.bindSocket(storageSocket, instance)
              .then((socket) => {
                instance.clientSocket = socket;

                console.log(`Started ${useHttps ? 'SSL' : 'HTTP'} instance on ${instance.baseUrl}`);
                hasBooted = true;
                resolve(instance);
              })
              .catch((reason) => {
                console.error(reason);
                reject(reason);
              });
          }).catch(function (err) {
            reject(err);
          });
        });

        setTimeout(function watchDog() {
          if (!hasBooted)
            reject('timeout');
        }, 30000);

      } catch (err) {
        reject(err);
      }
    });
  };

  return self;
}

module.exports = configure();
