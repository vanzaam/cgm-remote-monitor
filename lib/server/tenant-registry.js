'use strict';

var fs = require('fs');
var path = require('path');

/**
 * Tenant Registry — manages multiple Nightscout sites in one process.
 *
 * tenants.json format:
 * {
 *   "tenants": [
 *     { "hostname": "alice.example.com", "mongoUri": "mongodb://host/alice_ns" },
 *     { "hostname": "bob.example.com", "mongoUri": "mongodb://host/bob_ns" }
 *   ]
 * }
 *
 * All other settings (API_SECRET, DISPLAY_UNITS, ENABLE, etc.) are loaded from
 * the nightscout_config collection in each tenant's MongoDB database.
 */
function TenantRegistry () {
  this.tenants = new Map(); // hostname -> { env, ctx, app, language }
  this.configs = [];
  this.logBuffers = new Map(); // hostname -> TenantLog (available before boot completes)
  this._currentlyBooting = null;
}

/**
 * Load tenant configurations from a JSON file.
 */
TenantRegistry.prototype.loadFromFile = function loadFromFile (filePath) {
  var resolvedPath = path.resolve(filePath);
  console.log('Loading tenant configuration from', resolvedPath);

  var raw = fs.readFileSync(resolvedPath, 'utf8');
  var config = JSON.parse(raw);

  if (!config.tenants || !Array.isArray(config.tenants)) {
    throw new Error('tenants.json must contain a "tenants" array');
  }

  var self = this;
  config.tenants.forEach(function validateTenant (tenant, i) {
    if (!tenant.hostname) throw new Error('Tenant #' + i + ' missing "hostname"');
    if (!tenant.mongoUri) throw new Error('Tenant #' + i + ' missing "mongoUri"');
  });

  self.configs = config.tenants;
  console.log('Loaded', self.configs.length, 'tenant configuration(s)');
};

/**
 * Boot a single tenant — creates env, runs bootevent, builds Express app.
 */
TenantRegistry.prototype.bootTenant = function bootTenant (tenantConfig, callback) {
  var buildEnvForTenant = require('./tenant-env');
  var TenantLog = require('./tenant-log');
  var env = buildEnvForTenant(tenantConfig);

  var language = require('../language')();
  language.set(env.settings.language);
  try {
    language.loadLocalization(fs);
  } catch (e) {
    console.warn('[' + tenantConfig.hostname + '] Failed to load localization:', e.message);
  }

  // Create tenant log buffer and register it immediately so interceptor can find it
  var tenantLog = new TenantLog(500);
  tenantLog.push('info', ['Booting tenant ' + tenantConfig.hostname + '...']);
  this.logBuffers.set(tenantConfig.hostname, tenantLog);

  // Mark this tenant as currently booting so global interceptor routes untagged logs here
  this._currentlyBooting = tenantConfig.hostname;

  console.log('[' + tenantConfig.hostname + '] Booting tenant...');

  var self = this;
  require('./bootevent')(env, language).boot(function booted (ctx) {
    console.log('[' + tenantConfig.hostname + '] Boot completed');
    self._currentlyBooting = null;

    // Attach log buffer to ctx so API can access it
    ctx.tenantLog = tenantLog;

    var app = require('./app')(env, ctx);

    callback(null, {
      hostname: tenantConfig.hostname,
      env: env,
      ctx: ctx,
      app: app,
      language: language,
      tenantLog: tenantLog
    });
  });
};

/**
 * Boot all tenants sequentially.
 */
TenantRegistry.prototype.bootAll = function bootAll (callback) {
  var self = this;
  var remaining = self.configs.slice();

  function bootNext () {
    if (remaining.length === 0) {
      console.log('All', self.tenants.size, 'tenant(s) booted successfully');
      return callback(null);
    }

    var config = remaining.shift();
    self.bootTenant(config, function (err, tenant) {
      if (err) {
        console.error('[' + config.hostname + '] Failed to boot:', err.message);
        // Continue booting other tenants
        return bootNext();
      }
      self.tenants.set(tenant.hostname, tenant);
      bootNext();
    });
  }

  bootNext();
};

/**
 * Get tenant by hostname.
 */
TenantRegistry.prototype.get = function get (hostname) {
  return this.tenants.get(hostname) || null;
};

/**
 * Teardown all tenants.
 */
TenantRegistry.prototype.teardownAll = function teardownAll () {
  this.tenants.forEach(function (tenant, hostname) {
    console.log('[' + hostname + '] Tearing down...');
    if (tenant.ctx && tenant.ctx.bus) {
      tenant.ctx.bus.emit('teardown');
    }
    if (tenant.ctx && tenant.ctx.settingsStore) {
      tenant.ctx.settingsStore.stopWatching();
    }
  });
};

/**
 * Teardown a single tenant.
 */
TenantRegistry.prototype.teardownTenant = function teardownTenant (hostname) {
  var tenant = this.tenants.get(hostname);
  if (!tenant) return;

  console.log('[' + hostname + '] Tearing down for reload...');
  if (tenant.ctx && tenant.ctx.bus) {
    tenant.ctx.bus.emit('teardown');
  }
  if (tenant.ctx && tenant.ctx.settingsStore) {
    tenant.ctx.settingsStore.stopWatching();
  }
};

/**
 * Reload a single tenant — teardown, reboot, replace in registry.
 * Calls back with (err, newTenant).
 */
TenantRegistry.prototype.reloadTenant = function reloadTenant (hostname, callback) {
  var self = this;
  var config = null;

  for (var i = 0; i < self.configs.length; i++) {
    if (self.configs[i].hostname === hostname) {
      config = self.configs[i];
      break;
    }
  }

  if (!config) {
    return callback(new Error('Tenant config not found for ' + hostname));
  }

  self.teardownTenant(hostname);
  self.tenants.delete(hostname);

  self.bootTenant(config, function (err, tenant) {
    if (err) {
      return callback(err);
    }
    self.tenants.set(hostname, tenant);
    callback(null, tenant);
  });
};

module.exports = TenantRegistry;
