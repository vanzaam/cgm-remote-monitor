/*
* cgm-remote-monitor - web app to broadcast cgm readings
* Copyright (C) 2014 Nightscout contributors.  See the COPYRIGHT file
* at the root directory of this distribution and at
* https://github.com/nightscout/cgm-remote-monitor/blob/master/COPYRIGHT
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU Affero General Public License as published
* by the Free Software Foundation, either version 3 of the License, or
* (at your option) any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
* GNU Affero General Public License for more details.
*
* You should have received a copy of the GNU Affero General Public License
* along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

// Description: Basic web server to display data from Dexcom G4.  Requires a database that contains
// the Dexcom SGV data.
'use strict';

// Polyfill SlowBuffer for Node 25+ where it was removed
// Required by buffer-equal-constant-time (dependency of jsonwebtoken)
const bufferModule = require('buffer');
if (!bufferModule.SlowBuffer) {
  bufferModule.SlowBuffer = bufferModule.Buffer;
}

const fs = require('fs');
const http = require('http');

// Install log manager — rotating log files, 48h retention, size limits
var logManager = require('./log-manager');
logManager.install();

///////////////////////////////////////////////////
// Check for multi-tenant mode
///////////////////////////////////////////////////
var TENANTS_CONFIG = process.env.TENANTS_CONFIG || null;

if (TENANTS_CONFIG) {
  startMultiTenant(TENANTS_CONFIG);
} else {
  startSingleTenant();
}

///////////////////////////////////////////////////
// Single tenant mode (existing behavior, unchanged)
///////////////////////////////////////////////////
function startSingleTenant () {
  const env = require('./env')( );
  const language = require('../language')();
  const translate = language.set(env.settings.language).translate;
  language.loadLocalization(fs);

  var PORT = env.PORT;
  var HOSTNAME = env.HOSTNAME;

  function create (app) {
    var transport = (env.ssl
                  ? require('https') : require('http'));
    if (env.ssl) {
      return transport.createServer(env.ssl, app);
    }
    return transport.createServer(app);
  }

  require('./bootevent')(env, language).boot(function booted (ctx) {

      console.log('Boot event processing completed');

      var app = require('./app')(env, ctx);
      var server = create(app).listen(PORT, HOSTNAME);
      console.log(translate('Listening on port'), PORT, HOSTNAME);

      if (ctx.bootErrors && ctx.bootErrors.length > 0) {
        console.log('Boot completed with errors, waiting for MongoDB recovery...');
        if (ctx.bus) {
          ctx.bus.on('mongo-recovered', function onMongoRecovered () {
            console.log('MongoDB recovered! Restarting server process to re-initialize...');
            server.close(function () {
              process.exit(0);
            });
            setTimeout(function () { process.exit(0); }, 5000);
          });
        }
        return;
      }

      ctx.bus.on('teardown', function serverTeardown () {
        server.close();
        clearTimeout(sendStartupAllClearTimer);
        ctx.store.client.close();
      });

      var websocket = require('./websocket')(env, ctx, server);

      let sendStartupAllClearTimer = setTimeout(function sendStartupAllClear () {
        var alarm = ctx.notifications.findHighestAlarm();
        if (!alarm) {
          ctx.bus.emit('notification', {
            clear: true
            , title: 'All Clear'
            , message: 'Server started without alarms'
          });
        }
      }, 20000);
  });
}

///////////////////////////////////////////////////
// Multi-tenant mode
///////////////////////////////////////////////////

/**
 * Global console interceptor that routes all stdout/stderr to the correct
 * tenant's log buffer. Works by:
 * 1. Matching [hostname] prefix in log messages
 * 2. During boot: routing unmatched logs to the currently-booting tenant
 * 3. At runtime: routing unmatched logs to ALL tenants (shared logs)
 */
function installConsoleInterceptor (registry) {
  var origLog = console.log;
  var origError = console.error;
  var origWarn = console.warn;
  var origInfo = console.info;

  function routeLog (level, args) {
    var msg = args.length > 0 ? String(args[0]) : '';
    var argsArr = Array.prototype.slice.call(args);
    var routed = false;

    // Try to match [hostname] prefix in the message
    registry.logBuffers.forEach(function (logBuf, hostname) {
      if (msg.indexOf('[' + hostname + ']') !== -1) {
        logBuf.push(level, argsArr);
        routed = true;
        var fl = registry.fileLoggers && registry.fileLoggers.get(hostname);
        if (fl && fl.appendFileOnly) {
          fl.appendFileOnly(level, argsArr);
        }
      }
    });

    if (!routed) {
      // During boot, route untagged logs to the currently-booting tenant
      if (registry._currentlyBooting) {
        var bootLog = registry.logBuffers.get(registry._currentlyBooting);
        if (bootLog) {
          bootLog.push(level, argsArr);
          routed = true;
        }
        var bootFl = registry.fileLoggers && registry.fileLoggers.get(registry._currentlyBooting);
        if (bootFl && bootFl.appendFileOnly) {
          bootFl.appendFileOnly(level, argsArr);
        }
      }

      // At runtime, untagged logs go to all tenants
      if (!routed && registry.logBuffers.size > 0) {
        registry.logBuffers.forEach(function (logBuf) {
          logBuf.push(level, argsArr);
        });
      }
    }
  }

  console.log = function () {
    routeLog('info', arguments);
    origLog.apply(console, arguments);
  };
  console.error = function () {
    routeLog('error', arguments);
    origError.apply(console, arguments);
  };
  console.warn = function () {
    routeLog('warn', arguments);
    origWarn.apply(console, arguments);
  };
  console.info = function () {
    routeLog('info', arguments);
    origInfo.apply(console, arguments);
  };
}

function startMultiTenant (tenantsConfigPath) {
  var express = require('express');
  var TenantRegistry = require('./tenant-registry');

  var PORT = process.env.PORT || 1337;
  var HOSTNAME = process.env.HOSTNAME || null;

  var registry = new TenantRegistry();

  try {
    registry.loadFromFile(tenantsConfigPath);
  } catch (err) {
    console.error('Failed to load tenants configuration:', err.message);
    process.exit(1);
  }

  // Install global console interceptor to route ALL logs to tenant log buffers
  installConsoleInterceptor(registry);

  registry.bootAll(function onAllBooted (err) {
    if (err) {
      console.error('Fatal error during tenant boot:', err.message);
      process.exit(1);
    }

    if (registry.tenants.size === 0) {
      console.error('No tenants booted successfully. Exiting.');
      process.exit(1);
    }

    // Master Express app — routes requests by hostname
    var masterApp = express();
    var ADMIN_KEY = process.env.ADMIN_KEY || process.env.API_SECRET || '';

    masterApp.use(express.json());

    masterApp.get('/_admin/tenants', function (req, res) {
      if (!checkAdminKey(req)) return res.status(401).json({ error: 'Unauthorized' });
      res.json({ tenants: registry.list(), count: registry.tenants.size });
    });

    masterApp.post('/_admin/tenants', function (req, res) {
      if (!checkAdminKey(req)) return res.status(401).json({ error: 'Unauthorized' });
      var config = req.body;
      if (!config || !config.hostname) {
        return res.status(400).json({ error: 'Missing hostname in request body' });
      }
      registry.addTenant(config, function (err, result) {
        if (err) return res.status(400).json({ error: err.message });
        res.json(result);
      });
    });

    masterApp.delete('/_admin/tenants/:hostname', function (req, res) {
      if (!checkAdminKey(req)) return res.status(401).json({ error: 'Unauthorized' });
      registry.removeTenant(req.params.hostname, function (err, result) {
        if (err) return res.status(404).json({ error: err.message });
        res.json(result);
      });
    });

    function checkAdminKey (req) {
      if (!ADMIN_KEY) return true; // No key set = open (dev mode)
      var key = req.headers['x-admin-key'] || req.query.admin_key;
      return key === ADMIN_KEY;
    }

    masterApp.get('/_admin/status', function (req, res) {
      if (!checkAdminKey(req)) return res.status(401).json({ error: 'Unauthorized' });
      var mem = process.memoryUsage();
      res.json({
        tenants: registry.tenants.size,
        uptime: process.uptime(),
        memory: {
          rss: Math.round(mem.rss / 1024 / 1024) + ' MB',
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + ' MB',
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + ' MB'
        }
      });
    });

    // Tenant reload — must be before tenantDispatch (uses tenant Host header + api-secret)
    masterApp.post('/api/v1/tenant/reload', function (req, res) {
      var hostname = req.hostname;
      var tenant = registry.get(hostname);

      if (!tenant) {
        return res.status(404).json({ status: 'error', message: 'Tenant not found' });
      }

      var secret = req.header('api-secret') || '';
      tenant.ctx.authorization.resolve({ api_secret: secret, token: null, ip: req.ip }, function (err, auth) {
        if (err || !auth || !auth.shiros) {
          return res.status(403).json({ status: 'error', message: 'Admin authorization required' });
        }
        var isAdmin = auth.shiros.some(function (s) { return s.check && s.check('*'); });
        if (!isAdmin) {
          return res.status(403).json({ status: 'error', message: 'Admin authorization required' });
        }

        console.log('[' + hostname + '] Reload requested via admin API');

        var oldNsp = socketIo.of('/' + encodeURIComponent(hostname));
        oldNsp.disconnectSockets(true);
        socketIo._nsps.delete('/' + encodeURIComponent(hostname));

        registry.reloadTenant(hostname, function (reloadErr, newTenant) {
          if (reloadErr) {
            console.error('[' + hostname + '] Reload failed:', reloadErr.message);
            return res.status(500).json({ status: 'error', message: reloadErr.message });
          }

          setupTenantWebsocket(newTenant, hostname);
          console.log('[' + hostname + '] Reload completed');
          res.json({ status: 'ok', message: 'Tenant reloaded successfully' });
        });
      });
    });

    masterApp.get('/api/v1/tenant/logs', function (req, res) {
      var hostname = req.hostname;
      var tenant = registry.get(hostname);

      if (!tenant) {
        return res.status(404).json({ status: 'error', message: 'Tenant not found' });
      }

      var secret = req.header('api-secret') || '';
      tenant.ctx.authorization.resolve({ api_secret: secret, token: null, ip: req.ip }, function (err, auth) {
        if (err || !auth || !auth.shiros) {
          return res.status(403).json({ status: 'error', message: 'Admin authorization required' });
        }
        var isAdmin = auth.shiros.some(function (s) { return s.check && s.check('*'); });
        if (!isAdmin) {
          return res.status(403).json({ status: 'error', message: 'Admin authorization required' });
        }

        var log = registry.logBuffers.get(hostname) || tenant.tenantLog || (tenant.ctx && tenant.ctx.tenantLog);
        if (!log) {
          return res.json({ lines: [] });
        }

        var since = req.query.since ? Number(req.query.since) : 0;
        var limit = req.query.limit ? Number(req.query.limit) : 200;
        res.json({ lines: log.getLines(since, limit) });
      });
    });

    masterApp.use(function tenantDispatch (req, res, next) {
      var hostname = req.hostname;
      var tenant = registry.get(hostname);

      if (!tenant) {
        res.status(404).send('Site not found');
        return;
      }

      // Delegate to the tenant's Express app
      tenant.app(req, res, next);
    });

    var server = http.createServer(masterApp);
    server.listen(PORT, HOSTNAME);
    console.log('Multi-tenant server listening on port', PORT, HOSTNAME || '');
    console.log('Serving', registry.tenants.size, 'tenant(s)');

    // Socket.io with per-tenant namespaces
    var socketIo = require('socket.io')(server, {
      allowEIO3: true,
      transports: ['polling', 'websocket'],
      perMessageDeflate: { threshold: 512 },
      httpCompression: { threshold: 512 }
    });
    registry.socketIo = socketIo;

    function setupTenantWebsocket (tenant, hostname) {
      if (tenant.ctx.bootErrors && tenant.ctx.bootErrors.length > 0) {
        console.log('[' + hostname + '] Skipping websocket setup due to boot errors');
        return;
      }

      var nsp = socketIo.of('/' + encodeURIComponent(hostname));
      var websocket = require('./websocket')(tenant.env, tenant.ctx, nsp, socketIo, hostname);
      console.log('[' + hostname + '] WebSocket namespace /' + hostname + ' ready');

      // Capture runtime bus events into tenant log
      setupTenantLogCapture(tenant, hostname);

      // Send all-clear after startup
      setTimeout(function sendStartupAllClear () {
        var alarm = tenant.ctx.notifications.findHighestAlarm();
        if (!alarm) {
          tenant.ctx.bus.emit('notification', {
            clear: true,
            title: 'All Clear',
            message: 'Server started without alarms'
          });
        }
      }, 20000);
    }

    function setupTenantLogCapture (tenant, hostname) {
      var log = tenant.tenantLog || (tenant.ctx && tenant.ctx.tenantLog);
      if (!log) return;

      var bus = tenant.ctx.bus;
      if (!bus) return;

      bus.on('notification', function (notify) {
        log.push('info', ['Notification: ' + (notify.title || '') + ' ' + (notify.message || '')]);
      });
      bus.on('data-loaded', function () {
        log.push('info', ['Data loaded from MongoDB']);
      });
      bus.on('data-processed', function () {
        log.push('info', ['Data processed, tick ' + new Date().toISOString()]);
      });
      bus.on('settings-changed', function () {
        log.push('info', ['Settings changed in MongoDB']);
      });
      bus.on('mongo-recovered', function () {
        log.push('warn', ['MongoDB connection recovered']);
      });
    }

    registry.tenants.forEach(setupTenantWebsocket);

    // Graceful shutdown
    process.on('SIGTERM', function () {
      console.log('SIGTERM received, shutting down tenants...');
      registry.teardownAll();
      socketIo.close();
      server.close(function () {
        process.exit(0);
      });
      setTimeout(function () { process.exit(0); }, 10000);
    });
  });
}
