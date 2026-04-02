'use strict';

var _ = require('lodash');

var SETTINGS_DOC_ID = 'server_settings';
var CONFIG_COLLECTION = 'nightscout_config';
var POLL_INTERVAL = 60000; // 60 seconds

/**
 * Settings store — reads/writes site configuration from MongoDB.
 *
 * Document format in nightscout_config collection:
 * {
 *   _id: 'server_settings',
 *   _srvModified: <timestamp>,
 *   display: { units, timeFormat, theme, language, ... },
 *   alarms: { urgentHigh, high, low, urgentLow, ... },
 *   thresholds: { bgHigh, bgTargetTop, bgTargetBottom, bgLow },
 *   plugins: { enable: [...], showPlugins: [...], showForecast: [...] },
 *   auth: { API_SECRET: '...', defaultRoles: '...' },
 *   integrations: { pushover: {...}, maker: {...}, loop: {...} }
 * }
 */


// Settings that map to env.settings properties
var DISPLAY_TO_SETTINGS = {
  'display.units': 'units',
  'display.timeFormat': 'timeFormat',
  'display.theme': 'theme',
  'display.language': 'language',
  'display.customTitle': 'customTitle',
  'display.nightMode': 'nightMode',
  'display.dayStart': 'dayStart',
  'display.dayEnd': 'dayEnd',
  'display.scaleY': 'scaleY',
  'display.showRawbg': 'showRawbg',
  'display.focusHours': 'focusHours',
  'display.editMode': 'editMode',
  'display.showClockDelta': 'showClockDelta',
  'display.showClockLastTime': 'showClockLastTime'
};

var ALARM_TO_SETTINGS = {
  'alarms.urgentHigh': 'alarmUrgentHigh',
  'alarms.urgentHighMins': 'alarmUrgentHighMins',
  'alarms.high': 'alarmHigh',
  'alarms.highMins': 'alarmHighMins',
  'alarms.low': 'alarmLow',
  'alarms.lowMins': 'alarmLowMins',
  'alarms.urgentLow': 'alarmUrgentLow',
  'alarms.urgentLowMins': 'alarmUrgentLowMins',
  'alarms.timeagoWarn': 'alarmTimeagoWarn',
  'alarms.timeagoWarnMins': 'alarmTimeagoWarnMins',
  'alarms.timeagoUrgent': 'alarmTimeagoUrgent',
  'alarms.timeagoUrgentMins': 'alarmTimeagoUrgentMins',
  'alarms.pumpBatteryLow': 'alarmPumpBatteryLow'
};

function init (env, ctx) {

  var settingsStore = {};
  var currentRev = null;
  var pollTimer = null;

  function getCollection () {
    if (!ctx.store || !ctx.store.collection) return null;
    return ctx.store.collection(CONFIG_COLLECTION);
  }

  /**
   * Load settings from MongoDB at boot time.
   * Merges into env.settings, env.extendedSettings.
   */
  settingsStore.loadFromDB = function loadFromDB (callback) {
    var col = getCollection();
    if (!col) {
      console.log('Settings store: no database connection, skipping');
      return callback(null, null);
    }

    col.findOne({ _id: SETTINGS_DOC_ID }, function (err, doc) {
      if (err) {
        console.warn('Settings store: failed to load settings from DB:', err.message);
        return callback(null, null);
      }

      if (!doc) {
        console.log('Settings store: no server_settings document found, using defaults');
        return callback(null, null);
      }

      console.log('Settings store: loaded settings from MongoDB');
      currentRev = doc._srvModified || 0;
      applySettingsToEnv(doc);
      callback(null, doc);
    });
  };

  /**
   * Save settings to MongoDB.
   */
  settingsStore.save = function save (settingsDoc, callback) {
    var col = getCollection();
    if (!col) return callback(new Error('No database connection'));

    settingsDoc._id = SETTINGS_DOC_ID;
    settingsDoc._srvModified = Date.now();

    col.replaceOne({ _id: SETTINGS_DOC_ID }, settingsDoc, { upsert: true }, function (err) {
      if (err) return callback(err);
      currentRev = settingsDoc._srvModified;
      applySettingsToEnv(settingsDoc);
      if (ctx.bus) ctx.bus.emit('settings-changed');
      callback(null, settingsDoc);
    });
  };

  /**
   * Partial update — deep merge with existing settings.
   */
  settingsStore.update = function update (partialDoc, callback) {
    var col = getCollection();
    if (!col) return callback(new Error('No database connection'));

    col.findOne({ _id: SETTINGS_DOC_ID }, function (err, existing) {
      if (err) return callback(err);
      var merged = _.merge({}, existing || {}, partialDoc);
      settingsStore.save(merged, callback);
    });
  };

  /**
   * Get settings for API response, filtered by access level.
   * level: 'admin' — full settings (secrets masked)
   * level: 'patient' — display, alarms, thresholds, plugins only
   */
  settingsStore.getForAPI = function getForAPI (level, callback) {
    var col = getCollection();
    if (!col) return callback(new Error('No database connection'));

    col.findOne({ _id: SETTINGS_DOC_ID }, function (err, doc) {
      if (err) return callback(err);
      if (!doc) return callback(null, {});

      var result = {};

      // Everyone can see display, alarms, thresholds, plugins
      if (doc.display) result.display = _.cloneDeep(doc.display);
      if (doc.alarms) result.alarms = _.cloneDeep(doc.alarms);
      if (doc.thresholds) result.thresholds = _.cloneDeep(doc.thresholds);
      if (doc.plugins) result.plugins = _.cloneDeep(doc.plugins);

      if (level === 'admin') {
        // Admin sees integrations (with secrets masked)
        if (doc.integrations) {
          result.integrations = _.cloneDeep(doc.integrations);
          // Mask APNS key
          if (result.integrations.loop && result.integrations.loop.apnsKey) {
            result.integrations.loop.apnsKey = '[CONFIGURED]';
          }
          // Mask passwords
          _.forIn(result.integrations, function (plugin) {
            if (plugin && plugin.password) plugin.password = '[CONFIGURED]';
          });
        }
        // Admin sees auth (API_SECRET always masked)
        if (doc.auth) {
          result.auth = _.cloneDeep(doc.auth);
          if (result.auth.API_SECRET) {
            result.auth.API_SECRET = '[CONFIGURED]';
          }
        }
      }

      delete result._id;
      delete result._srvModified;
      callback(null, result);
    });
  };

  /**
   * Apply a MongoDB settings document to env.settings and env.extendedSettings.
   */
  function applySettingsToEnv (doc) {
    if (!doc) return;

    // Display settings
    if (doc.display) {
      _.forIn(DISPLAY_TO_SETTINGS, function (settingsKey, docPath) {
        var val = _.get(doc, docPath);
        if (val !== undefined && val !== null) {
          env.settings[settingsKey] = val;
        }
      });
    }

    // Alarm settings
    if (doc.alarms) {
      _.forIn(ALARM_TO_SETTINGS, function (settingsKey, docPath) {
        var val = _.get(doc, docPath);
        if (val !== undefined && val !== null) {
          env.settings[settingsKey] = val;
        }
      });
    }

    // Thresholds
    if (doc.thresholds) {
      if (doc.thresholds.bgHigh != null) env.settings.thresholds.bgHigh = Number(doc.thresholds.bgHigh);
      if (doc.thresholds.bgTargetTop != null) env.settings.thresholds.bgTargetTop = Number(doc.thresholds.bgTargetTop);
      if (doc.thresholds.bgTargetBottom != null) env.settings.thresholds.bgTargetBottom = Number(doc.thresholds.bgTargetBottom);
      if (doc.thresholds.bgLow != null) env.settings.thresholds.bgLow = Number(doc.thresholds.bgLow);
    }

    // Plugins
    if (doc.plugins) {
      if (doc.plugins.enable && Array.isArray(doc.plugins.enable)) {
        // Rebuild enable string from array, then let settings.eachSettingAsEnv process it
        // For now, directly set the enable array
        env.settings.enable = doc.plugins.enable;
      }
      if (doc.plugins.showPlugins && Array.isArray(doc.plugins.showPlugins)) {
        env.settings.showPlugins = doc.plugins.showPlugins.join(' ');
      }
      if (doc.plugins.showForecast && Array.isArray(doc.plugins.showForecast)) {
        env.settings.showForecast = doc.plugins.showForecast.join(' ');
      }
    }

    // Auth
    if (doc.auth) {
      if (doc.auth.API_SECRET && doc.auth.API_SECRET !== '[CONFIGURED]') {
        env.enclave.setApiKey(doc.auth.API_SECRET);
      }
      if (doc.auth.defaultRoles) {
        env.settings.authDefaultRoles = doc.auth.defaultRoles;
      }
    }

    // Integrations → extendedSettings
    if (doc.integrations) {
      _.forIn(doc.integrations, function (pluginSettings, pluginName) {
        if (pluginSettings && typeof pluginSettings === 'object') {
          env.extendedSettings[pluginName] = _.merge(env.extendedSettings[pluginName] || {}, pluginSettings);
        }
      });
    }
  }

  /**
   * Start polling for settings changes (for hot-reload).
   */
  settingsStore.startWatching = function startWatching () {
    if (pollTimer) return;

    pollTimer = setInterval(function checkForChanges () {
      var col = getCollection();
      if (!col) return;

      col.findOne({ _id: SETTINGS_DOC_ID }, { projection: { _srvModified: 1 } }, function (err, doc) {
        if (err || !doc) return;
        if (doc._srvModified && doc._srvModified !== currentRev) {
          console.log('Settings store: detected settings change, reloading');
          col.findOne({ _id: SETTINGS_DOC_ID }, function (err2, fullDoc) {
            if (err2 || !fullDoc) return;
            currentRev = fullDoc._srvModified;
            applySettingsToEnv(fullDoc);
            if (ctx.bus) ctx.bus.emit('settings-changed');
          });
        }
      });
    }, POLL_INTERVAL);
  };

  /**
   * Stop polling.
   */
  settingsStore.stopWatching = function stopWatching () {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  return settingsStore;
}

module.exports = init;
