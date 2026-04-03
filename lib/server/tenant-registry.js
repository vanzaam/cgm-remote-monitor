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
    // mongoUri is optional — if empty, memory-storage will be used
  });

  self.configs = config.tenants;
  console.log('Loaded', self.configs.length, 'tenant configuration(s)');
};

/**
 * Boot a single tenant — creates env, runs bootevent, builds Express app.
 */
TenantRegistry.prototype.bootTenant = function bootTenant (tenantConfig, callback) {
  var buildEnvForTenant = require('./tenant-env');
  var env = buildEnvForTenant(tenantConfig);

  var language = require('../language')();
  language.set(env.settings.language);
  try {
    language.loadLocalization(fs);
  } catch (e) {
    // Localization files may not be available, continue with defaults
    console.warn('[' + tenantConfig.hostname + '] Failed to load localization:', e.message);
  }

  console.log('[' + tenantConfig.hostname + '] Booting tenant...');

  require('./bootevent')(env, language).boot(function booted (ctx) {
    console.log('[' + tenantConfig.hostname + '] Boot completed');

    var app = require('./app')(env, ctx);

    callback(null, {
      hostname: tenantConfig.hostname,
      env: env,
      ctx: ctx,
      app: app,
      language: language
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
  });
};

module.exports = TenantRegistry;
