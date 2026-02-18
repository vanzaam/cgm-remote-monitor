'use strict';

const _ = require('lodash');
const UPDATE_THROTTLE = 5000;

function boot (env, language) {

  function startBoot(ctx, next) {

    console.log('Executing startBoot');

    ctx.bootErrors = [ ];
    ctx.moment = require('moment-timezone');
    ctx.runtimeState = 'booting';
    ctx.settings = env.settings;
    ctx.bus = require('../bus')(env.settings, ctx);
    ctx.adminnotifies = require('../adminnotifies')(ctx);
    if (env.notifies) {
      for (var i = 0; i < env.notifies.length; i++) {
        ctx.adminnotifies.addNotify(env.notifies[i]);
      }
    }
    next();
  }

  //////////////////////////////////////////////////
  // Check Node version.
  // Latest Node LTS releases are recommended and supported.
  // Current Node releases MAY work, but are not recommended. Will be tested in CI
  // Older Node versions or Node versions with known security issues will not work.
  ///////////////////////////////////////////////////
  function checkNodeVersion (ctx, next) {

    console.log('Executing checkNodeVersion');

    var semver = require('semver');
    var nodeVersion = process.version;

    const isLTS = process.release.lts ? true : false;

    if (isLTS || semver.satisfies(nodeVersion, '>=14.0.0')) {
      console.debug('Node version ' + nodeVersion + ' is supported');
      next();
      return;
    }

    // Don't crash on newer Node versions, just warn
    console.warn('WARNING: Node version ' + nodeVersion + ' has not been tested with Nightscout. Proceeding anyway.');
    next();

  }

  function checkEnv (ctx, next) {

    console.log('Executing checkEnv');

    ctx.language = language;
    if (env.err.length > 0) {
      ctx.bootErrors = ctx.bootErrors || [ ];
      ctx.bootErrors.push({'desc': 'ENV Error', err: env.err});
    }
    next();
  }

  function hasBootErrors(ctx) {
    return ctx.bootErrors && ctx.bootErrors.length > 0;
  }

  function augmentSettings (ctx, next) {

    console.log('Executing augmentSettings');

    var configURL = env.IMPORT_CONFIG || null;
    var url = require('url');
    var href = null;

    if (configURL) {
      try {
        href = url.parse(configURL).href;
      } catch (e) {
        console.error('Parsing config URL from IMPORT_CONFIG failed');
      }
    }

    if(configURL && href) {
      var axios_default = { headers: { 'Accept': 'application/json' } };
      var axios = require('axios').create(axios_default);
      console.log('Getting settings from', href);
      return axios.get(href).then(function (resp) {
        var body = resp.data;
        var settings = body.settings || body;
        console.log('extending settings with', settings);
        _.merge(env.settings, settings);
        if (body.extendedSettings) {
          console.log('extending extendedSettings with', body.extendedSettings);
          _.merge(env.extendedSettings, body.extendedSettings);
        }
        next( );
      }).catch(function (err) {
        var synopsis = ['Attempt to fetch config', href, 'failed.'];
        console.log('Attempt to fetch config', href, 'failed.', err.response);
        ctx.bootErrors.push({desc: synopsis.join(' '), err});
        next( );

      });
    } else {
      next( );
    }
  }

  function checkSettings (ctx, next) {

    console.log('Executing checkSettings');

    ctx.bootErrors = ctx.bootErrors || [];

    console.log('Checking settings');

    if (!env.storageURI) {
      ctx.bootErrors.push({'desc': 'Mandatory setting missing',
      err: 'MONGODB_URI setting is missing, cannot connect to database'});
    }

    if (!env.enclave.isApiKeySet()) {
      ctx.bootErrors.push({'desc': 'Mandatory setting missing',
      err: 'API_SECRET setting is missing, cannot enable REST API'});
    }

    if (env.settings.authDefaultRoles == 'readable') {
      const message = {
        title: "Nightscout readable by world"
        ,message: "Your Nightscout installation is readable by anyone who knows the web page URL. Please consider closing access to the site by following the instructions in the <a href=\"http://nightscout.github.io/nightscout/security/#how-to-turn-off-unauthorized-access\" target=\"_new\">Nightscout documentation</a>."
        ,persistent: true
      };
      ctx.adminnotifies.addNotify(message);
    }

    next();
  }

  function setupStorage (ctx, next) {

    console.log('Executing setupStorage');

    if (hasBootErrors(ctx)) {
      return next();
    }

    try {
      if (_.startsWith(env.storageURI, 'openaps://')) {
        require('../storage/openaps-storage')(env, function ready (err, store) {
          if (err) {
            throw err;
          }
          ctx.store = store;
          console.log('OpenAPS Storage system ready');
          next();
        });
      } else {
        var mongoBootErrorAdded = false;
        //TODO assume mongo for now, when there are more storage options add a lookup
        require('../storage/mongo-storage')(env, function ready(err, store) {
          if (err) {
            console.info('ERROR CONNECTING TO MONGO', err);
            ctx.bootErrors = ctx.bootErrors || [ ];
            if (!mongoBootErrorAdded) {
              mongoBootErrorAdded = true;
              ctx.bootErrors.push({'desc': 'Unable to connect to Mongo', err: err.message});
            }
            // Don't call next() yet if store is null — retry is still running
            if (store) {
              ctx.store = store;
              next();
            } else {
              // Boot continues with error, retry keeps running in background
              next();
            }
          } else {
            if (mongoBootErrorAdded) {
              // Recovery! MongoDB reconnected after boot error
              console.log('MongoDB RECOVERED! Clearing boot errors and signaling recovery...');
              ctx.bootErrors = [];
              ctx.store = store;
              ctx.mongoRecovered = true;
              // Emit recovery event so server.js can re-initialize
              if (ctx.bus) {
                ctx.bus.emit('mongo-recovered', store);
              }
            } else {
              console.log('Mongo Storage system ready');
              ctx.store = store;
              next();
            }
          }
        });
      }
    } catch (err) {
      console.info('ERROR CONNECTING TO MONGO', err);
      ctx.bootErrors = ctx.bootErrors || [ ];
      ctx.bootErrors.push({'desc': 'Unable to connect to Mongo', err: err.message});
      next();
    }
  }

  function setupAuthorization (ctx, next) {

    console.log('Executing setupAuthorization');

    if (hasBootErrors(ctx)) {
      return next();
    }

    ctx.authorization = require('../authorization')(env, ctx);
    ctx.authorization.storage.ensureIndexes();
    ctx.authorization.storage.reload(function loaded (err) {
      if (err) {
        ctx.bootErrors = ctx.bootErrors || [ ];
        ctx.bootErrors.push({'desc': 'Unable to setup authorization', err: err});
      }
      next();
    });
  }

  function setupInternals (ctx, next) {

    console.log('Executing setupInternals');

    if (hasBootErrors(ctx)) {
      return next();
    }

    ctx.levels = require('../levels');
    ctx.levels.translate = ctx.language.translate;

    ///////////////////////////////////////////////////
    // api and json object variables
    ///////////////////////////////////////////////////
    ctx.plugins = require('../plugins')({
      settings: env.settings
      , language: ctx.language
      , levels: ctx.levels
      , moment: ctx.moment
    }).registerServerDefaults();

    ctx.wares = require('../middleware/')(env);

    ctx.pushover = require('../plugins/pushover')(env, ctx);
    ctx.maker = require('../plugins/maker')(env);
    ctx.pushnotify = require('./pushnotify')(env, ctx);
    ctx.loop = require('./loop')(env, ctx);

    ctx.activity = require('./activity')(env, ctx);
    ctx.entries = require('./entries')(env, ctx);
    ctx.treatments = require('./treatments')(env, ctx);
    ctx.devicestatus = require('./devicestatus')(env.devicestatus_collection, ctx);
    ctx.profile = require('./profile')(env.profile_collection, ctx);
    ctx.food = require('./food')(env, ctx);
    ctx.pebble = require('./pebble')(env, ctx);
    ctx.properties = require('../api2/properties')(env, ctx);
    ctx.ddata = require('../data/ddata')();
    ctx.cache = require('./cache')(env,ctx);
    ctx.dataloader = require('../data/dataloader')(env, ctx);
    ctx.notifications = require('../notifications')(env, ctx);
    ctx.purifier = require('./purifier')(env,ctx);

    if (env.settings.isEnabled('alexa') || env.settings.isEnabled('googlehome')) {
      ctx.virtAsstBase = require('../plugins/virtAsstBase')(env, ctx);
    }

    if (env.settings.isEnabled('alexa')) {
      ctx.alexa = require('../plugins/alexa')(env, ctx);
    }

    if (env.settings.isEnabled('googlehome')) {
      ctx.googleHome = require('../plugins/googlehome')(env, ctx);
    }

    // Ensure there is at least one treatment profile in a fresh database.
    ensureDefaultProfile(ctx, next);
  }

  function ensureDefaultProfile (ctx, done) {
    try {
      ctx.profile.last(function (err, docs) {
        if (err) {
          console.error('Error while checking for existing treatment profile', err);
          return done();
        }

        if (docs && docs.length > 0) {
          // Profile already exists, nothing to do.
          return done();
        }

        console.log('No treatment profile found, creating default profile for Europe/Moscow');

        const now = new Date();
        const startOfYear = new Date(Date.UTC(now.getFullYear(), 0, 1, 0, 0, 0, 0)).toISOString();

        // Regional configuration: This default profile is configured for Russian/European users
        // - Timezone: Europe/Moscow (UTC+3)
        // - Units: mmol/L (standard in Russia, Europe, and most of the world)
        // - Target range: 5-8 mmol/L (90-144 mg/dl equivalent)
        // - Sensitivity: 5 mmol/L per unit (90 mg/dl per unit equivalent)
        // Note: This is a profile-level default. System DISPLAY_UNITS defaults to 'mg/dl' but
        //       can be overridden via DISPLAY_UNITS environment variable to match profile units.
        const defaultProfile = {
          defaultProfile: 'Default',
          store: {
            Default: {
              dia: 5,
              carbratio: [
                { time: '00:00', value: 12, timeAsSeconds: 0 }
              ],
              carbs_hr: 20,
              delay: 20,
              sens: [
                { time: '00:00', value: 5, timeAsSeconds: 0 }
              ],
              timezone: 'Europe/Moscow',
              basal: [
                { time: '00:00', value: 0.1, timeAsSeconds: 0 }
              ],
              target_low: [
                { time: '00:00', value: 5, timeAsSeconds: 0 }
              ],
              target_high: [
                { time: '00:00', value: 8, timeAsSeconds: 0 }
              ],
              units: 'mmol'
            }
          },
          startDate: startOfYear,
          mills: 0,
          srvModified: Date.now(),
          units: 'mmol'
        };

        ctx.profile.create(defaultProfile, function (err) {
          if (err) {
            console.error('Failed to create default treatment profile:', err);
          } else {
            console.log('Default treatment profile created');
          }
          done();
        });
      });
    } catch (e) {
      console.error('Unexpected error while ensuring default treatment profile', e);
      done();
    }
  }

  function ensureIndexes (ctx, next) {

    console.log('Executing ensureIndexes');

    if (hasBootErrors(ctx)) {
      return next();
    }

    console.info('Ensuring indexes');
    ctx.store.ensureIndexes(ctx.entries( ), ctx.entries.indexedFields);
    ctx.store.ensureIndexes(ctx.treatments( ), ctx.treatments.indexedFields);
    ctx.store.ensureIndexes(ctx.devicestatus( ), ctx.devicestatus.indexedFields);
    ctx.store.ensureIndexes(ctx.profile( ), ctx.profile.indexedFields);
    ctx.store.ensureIndexes(ctx.food( ), ctx.food.indexedFields);
    ctx.store.ensureIndexes(ctx.activity( ), ctx.activity.indexedFields);

    next( );
  }

  function setupListeners (ctx, next) {

    console.log('Executing setupListeners');
    
    if (hasBootErrors(ctx)) {
      return next();
    }

    var updateData = _.debounce(function debouncedUpdateData ( ) {
      ctx.dataloader.update(ctx.ddata, function dataUpdated () {
        ctx.bus.emit('data-loaded');
      });
    }, UPDATE_THROTTLE);

    ctx.bus.on('tick', function timedReloadData (tick) {
      console.info('tick', tick.now);
      updateData();
    });

    ctx.bus.on('data-received', function forceReloadData ( ) {
      console.info('got data-received event, requesting reload');
      updateData();
    });

    ctx.bus.on('data-loaded', function updatePlugins ( ) {
      console.info('data loaded: reloading sandbox data and updating plugins');
      var sbx = require('../sandbox')().serverInit(env, ctx);
      ctx.plugins.setProperties(sbx);
      ctx.notifications.initRequests();
      ctx.plugins.checkNotifications(sbx);
      ctx.notifications.process(sbx);
      ctx.sbx = sbx;
      ctx.bus.emit('data-processed', sbx);
    });

    ctx.bus.on('data-processed', function processed ( ) {
      ctx.runtimeState = 'loaded';
    });

    ctx.bus.on('notification', ctx.pushnotify.emitNotification);

    next( );
  }

  function setupConnect (ctx, next) {
    console.log('Executing setupConnect');
    ctx.nightscoutConnect = require('nightscout-connect')(env, ctx)
    // ctx.nightscoutConnect.
    return next( );
  }

  function setupBridge (ctx, next) {

    console.log('Executing setupBridge');

    if (hasBootErrors(ctx)) {
      return next();
    }

    ctx.bridge = require('../plugins/bridge')(env, ctx.bus);
    if (ctx.bridge) {
      ctx.bridge.startEngine(ctx.entries);
      console.log("DEPRECATION WARNING", "PLEASE CONSIDER nightscout-connect instead.");
    }
    next( );
  }

  function setupMMConnect (ctx, next) {

    console.log('Executing setupMMConnect');

    if (hasBootErrors(ctx)) {
      return next();
    }

    ctx.mmconnect = require('../plugins/mmconnect').init(env, ctx.entries, ctx.devicestatus, ctx.bus);
    if (ctx.mmconnect) {
      ctx.mmconnect.run();
      console.log("DEPRECATION WARNING", "PLEASE CONSIDER nightscout-connect instead.");
    }
    next( );
  }

  function finishBoot (ctx, next) {

    console.log('Executing finishBoot');

    if (hasBootErrors(ctx)) {
      return next();
    }
    ctx.bus.emit('finishBoot');

    ctx.runtimeState = 'booted';
    ctx.bus.uptime( );

    next( );
  }

  return require('bootevent')( )
    .acquire(startBoot)
    .acquire(checkNodeVersion)
    .acquire(checkEnv)
    .acquire(augmentSettings)
    .acquire(checkSettings)
    .acquire(setupStorage)
    .acquire(setupAuthorization)
    .acquire(setupInternals)
    .acquire(ensureIndexes)
    .acquire(setupListeners)
    .acquire(setupConnect)
    .acquire(setupBridge)
    .acquire(setupMMConnect)
    .acquire(finishBoot);
}

module.exports = boot;
