'use strict';

const _each = require('lodash/each');
const _trim = require('lodash/trim');
const _forIn = require('lodash/forIn');
const _startsWith = require('lodash/startsWith');
const _camelCase = require('lodash/camelCase');
const enclave = require('./enclave');
const stringEntropy = require('fast-password-entropy');
const consts = require('../constants');

/**
 * Build an env object from a tenant config object instead of process.env.
 *
 * tenantConfig = {
 *   mongoUri: 'mongodb://...',
 *   apiSecret: '...',         // optional, can also be in settings or loaded from DB later
 *   settings: {               // optional, key-value pairs matching env var names
 *     DISPLAY_UNITS: 'mmol',
 *     ENABLE: 'careportal iob cob',
 *     THEME: 'colors',
 *     ...
 *   }
 * }
 */
function buildEnvForTenant (tenantConfig) {

  var env = {
    settings: require('../settings')()
  };

  // Build shadowEnv from tenantConfig.settings (mimics process.env trimming in env.js)
  var shadowEnv = {};
  var rawSettings = tenantConfig.settings || {};
  Object.keys(rawSettings).forEach(function (key) {
    var val = rawSettings[key];
    shadowEnv[_trim(key)] = val != null ? _trim(String(val)) : '';
  });

  function readENV (varName, defaultValue) {
    var value = shadowEnv['CUSTOMCONNSTR_' + varName] ||
      shadowEnv['CUSTOMCONNSTR_' + varName.toLowerCase()] ||
      shadowEnv[varName] ||
      shadowEnv[varName.toLowerCase()];

    if (varName === 'DISPLAY_UNITS') {
      if (value && value.toLowerCase().includes('mmol')) {
        value = 'mmol';
      } else {
        value = defaultValue;
      }
    }

    return value != null ? value : defaultValue;
  }

  function readENVTruthy (varName, defaultValue) {
    var value = readENV(varName, defaultValue);
    if (typeof value === 'string' && (value.toLowerCase() === 'on' || value.toLowerCase() === 'true')) { value = true; }
    else if (typeof value === 'string' && (value.toLowerCase() === 'off' || value.toLowerCase() === 'false')) { value = false; }
    else { value = defaultValue; }
    return value;
  }

  // Infrastructure
  env.PORT = tenantConfig.port || 1337;
  env.HOSTNAME = tenantConfig.hostname || null;
  env.IMPORT_CONFIG = null;
  env.static_files = '/static';
  env.debug = { minify: false };

  env.err = [];
  env.notifies = [];
  env.enclave = enclave();

  // SSL — tenants inherit from the master process, not per-tenant
  env.ssl = false;
  env.insecureUseHttp = readENVTruthy('INSECURE_USE_HTTP', true);
  env.secureHstsHeader = readENVTruthy('SECURE_HSTS_HEADER', true);
  env.secureHstsHeaderIncludeSubdomains = readENVTruthy('SECURE_HSTS_HEADER_INCLUDESUBDOMAINS', false);
  env.secureHstsHeaderPreload = readENVTruthy('SECURE_HSTS_HEADER_PRELOAD', false);
  env.secureCsp = readENVTruthy('SECURE_CSP', false);
  env.secureCspReportOnly = readENVTruthy('SECURE_CSP_REPORT_ONLY', false);

  // Storage
  env.storageURI = tenantConfig.mongoUri;
  env.entries_collection = readENV('ENTRIES_COLLECTION') || readENV('MONGO_COLLECTION', 'entries');
  env.authentication_collections_prefix = readENV('MONGO_AUTHENTICATION_COLLECTIONS_PREFIX', 'auth_');
  env.treatments_collection = readENV('MONGO_TREATMENTS_COLLECTION', 'treatments');
  env.profile_collection = readENV('MONGO_PROFILE_COLLECTION', 'profile');
  env.settings_collection = readENV('MONGO_SETTINGS_COLLECTION', 'settings');
  env.devicestatus_collection = readENV('MONGO_DEVICESTATUS_COLLECTION', 'devicestatus');
  env.food_collection = readENV('MONGO_FOOD_COLLECTION', 'food');
  env.activity_collection = readENV('MONGO_ACTIVITY_COLLECTION', 'activity');

  // API Secret
  var apiSecret = tenantConfig.apiSecret || readENV('API_SECRET');
  env.api_secret = null;

  if (apiSecret && apiSecret.length > 0) {
    if (apiSecret.length < consts.MIN_PASSPHRASE_LENGTH) {
      var msg = ['API_SECRET should be at least', consts.MIN_PASSPHRASE_LENGTH, 'characters'].join(' ');
      console.error('[' + (tenantConfig.hostname || 'tenant') + '] ' + msg);
      env.err.push({ desc: msg });
    } else {
      env.enclave.setApiKey(apiSecret);
      var testresult = stringEntropy(apiSecret);
      if (testresult < 60) {
        env.notifies.push({ persistent: true, title: 'Security issue', message: 'Weak API_SECRET detected.' });
      }
    }
  }

  // Version
  var software = require('../../package.json');
  env.version = software.version;
  env.name = software.name;

  // Settings from config object (same mechanism as env.js updateSettings)
  var envNameOverrides = { UNITS: 'DISPLAY_UNITS' };
  var envDefaultOverrides = { DISPLAY_UNITS: 'mg/dl' };

  env.settings.eachSettingAsEnv(function settingFromEnv (name) {
    var envName = envNameOverrides[name] || name;
    return readENV(envName, envDefaultOverrides[envName]);
  });

  // Extended settings
  env.extendedSettings = findExtendedSettings(shadowEnv, env.settings.enable);

  if (!readENVTruthy('TREATMENTS_AUTH', true)) {
    env.settings.authDefaultRoles = env.settings.authDefaultRoles || '';
    env.settings.authDefaultRoles += ' careportal';
  }

  return env;
}

function findExtendedSettings (envs, enableList) {
  var extended = {};

  extended.devicestatus = {};
  extended.devicestatus.advanced = true;
  extended.devicestatus.days = 1;
  if (envs['DEVICESTATUS_DAYS'] && envs['DEVICESTATUS_DAYS'] === '2') extended.devicestatus.days = 1;

  function normalizeEnv (key) {
    return key.toUpperCase().replace('CUSTOMCONNSTR_', '');
  }

  _each(enableList, function eachEnable (enable) {
    if (_trim(enable)) {
      _forIn(envs, function eachEnvPair (value, key) {
        var envKey = normalizeEnv(key);
        if (_startsWith(envKey, enable.toUpperCase() + '_')) {
          var split = envKey.indexOf('_');
          if (split > -1 && split <= envKey.length) {
            var exts = extended[enable] || {};
            extended[enable] = exts;
            var ext = _camelCase(envKey.substring(split + 1).toLowerCase());
            if (!isNaN(value)) { value = Number(value); }
            if (typeof value === 'string' && (value.toLowerCase() === 'on' || value.toLowerCase() === 'true')) { value = true; }
            if (typeof value === 'string' && (value.toLowerCase() === 'off' || value.toLowerCase() === 'false')) { value = false; }
            exts[ext] = value;
          }
        }
      });
    }
  });
  return extended;
}

module.exports = buildEnvForTenant;
