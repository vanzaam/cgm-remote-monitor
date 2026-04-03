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
  this.socketIo = null; // Set by server.js after socket.io init
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
  var logManager = require('./log-manager');
  var env = buildEnvForTenant(tenantConfig);

  var language = require('../language')();
  language.set(env.settings.language);
  try {
    language.loadLocalization(fs);
  } catch (e) {
    console.warn('[' + tenantConfig.hostname + '] Failed to load localization:', e.message);
  }

  // Create per-tenant logger with isolated log files
  var tenantLog = logManager.forTenant(tenantConfig.hostname);

  tenantLog.log('Booting tenant...');

  require('./bootevent')(env, language).boot(function booted (ctx) {
    tenantLog.log('Boot completed');

    var app = require('./app')(env, ctx);

    callback(null, {
      hostname: tenantConfig.hostname,
      env: env,
      ctx: ctx,
      app: app,
      language: language,
      logger: tenantLog
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
 * Add a new tenant at runtime (hot-add). Boots it, sets up websocket namespace,
 * and starts accepting requests immediately.
 */
TenantRegistry.prototype.addTenant = function addTenant (tenantConfig, callback) {
  var self = this;

  if (!tenantConfig.hostname) {
    return callback(new Error('Missing hostname'));
  }

  if (self.tenants.has(tenantConfig.hostname)) {
    return callback(new Error('Tenant ' + tenantConfig.hostname + ' already exists'));
  }

  // Return immediately — boot runs in background via setImmediate
  // This prevents blocking the event loop during the heavy boot process
  callback(null, { hostname: tenantConfig.hostname, status: 'booting' });

  setImmediate(function () {
    self.bootTenant(tenantConfig, function (err, tenant) {
      if (err) {
        console.error('[' + tenantConfig.hostname + '] Hot-add FAILED:', err.message);
        return;
      }

      self.tenants.set(tenant.hostname, tenant);
      self.configs.push(tenantConfig);

      // Set up websocket namespace if socket.io is available
      if (self.socketIo && tenant.ctx && (!tenant.ctx.bootErrors || tenant.ctx.bootErrors.length === 0)) {
        var nsp = self.socketIo.of('/' + encodeURIComponent(tenant.hostname));
        require('./websocket')(tenant.env, tenant.ctx, nsp);
        console.log('[' + tenant.hostname + '] WebSocket namespace ready');
      }

      // Send all-clear after startup
      setTimeout(function () {
        if (tenant.ctx.notifications) {
          var alarm = tenant.ctx.notifications.findHighestAlarm();
          if (!alarm) {
            tenant.ctx.bus.emit('notification', {
              clear: true, title: 'All Clear', message: 'Tenant started'
            });
          }
        }
      }, 5000);

      console.log('[' + tenantConfig.hostname + '] Hot-added successfully. Total tenants:', self.tenants.size);
    });
  });
};

/**
 * Remove a tenant at runtime (hot-remove). Tears down and stops accepting requests.
 */
TenantRegistry.prototype.removeTenant = function removeTenant (hostname, callback) {
  var tenant = this.tenants.get(hostname);
  if (!tenant) {
    return callback(new Error('Tenant ' + hostname + ' not found'));
  }

  console.log('[' + hostname + '] Removing tenant...');

  if (tenant.ctx && tenant.ctx.bus) {
    tenant.ctx.bus.emit('teardown');
  }

  // Remove websocket namespace
  if (this.socketIo) {
    var nsp = this.socketIo.of('/' + encodeURIComponent(hostname));
    nsp.disconnectSockets(true);
  }

  this.tenants.delete(hostname);
  this.configs = this.configs.filter(function (c) { return c.hostname !== hostname; });

  console.log('[' + hostname + '] Removed. Remaining tenants:', this.tenants.size);
  callback(null, { hostname: hostname, status: 'removed' });
};

/**
 * List all active tenants with basic info.
 */
TenantRegistry.prototype.list = function list () {
  var result = [];
  this.tenants.forEach(function (tenant, hostname) {
    result.push({
      hostname: hostname,
      units: tenant.env.settings.units,
      title: tenant.env.settings.customTitle,
      language: tenant.env.settings.language,
      plugins: tenant.env.settings.enable ? tenant.env.settings.enable.length : 0,
      status: tenant.ctx.runtimeState || 'unknown'
    });
  });
  return result;
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
