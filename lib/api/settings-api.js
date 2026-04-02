'use strict';

/**
 * Settings API — read/write site configuration stored in MongoDB.
 *
 * GET  /settings         — admin: full settings (secrets masked)
 * GET  /settings/display — readable: display, alarms, thresholds, plugins
 * PUT  /settings         — admin: full settings update (deep merge)
 * PUT  /settings/display — readable: update display, alarms, thresholds only
 */
function configure (app, wares, ctx, env) {
  var express = require('express');
  var api = express.Router();

  api.use(wares.bodyParser({
    limit: 1048576 // 1MB
  }));

  // GET /settings — full settings for admin
  api.get('/settings', ctx.authorization.isPermitted('api:settings:admin'), function getSettings (req, res) {
    if (!ctx.settingsStore) {
      return res.status(503).json({ status: 503, message: 'Settings store not available' });
    }

    ctx.settingsStore.getForAPI('admin', function (err, settings) {
      if (err) {
        return res.status(500).json({ status: 500, message: err.message });
      }
      res.json(settings);
    });
  });

  // GET /settings/display — display settings for anyone with readable access
  api.get('/settings/display', ctx.authorization.isPermitted('api:settings:read'), function getDisplaySettings (req, res) {
    if (!ctx.settingsStore) {
      return res.status(503).json({ status: 503, message: 'Settings store not available' });
    }

    ctx.settingsStore.getForAPI('patient', function (err, settings) {
      if (err) {
        return res.status(500).json({ status: 500, message: err.message });
      }
      res.json(settings);
    });
  });

  // PUT /settings — full settings update for admin
  api.put('/settings', ctx.authorization.isPermitted('api:settings:admin'), function putSettings (req, res) {
    if (!ctx.settingsStore) {
      return res.status(503).json({ status: 503, message: 'Settings store not available' });
    }

    var body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ status: 400, message: 'Request body must be a JSON object' });
    }

    ctx.settingsStore.update(body, function (err, result) {
      if (err) {
        return res.status(500).json({ status: 500, message: err.message });
      }
      res.json({ status: 200, message: 'Settings updated', _srvModified: result._srvModified });
    });
  });

  // PUT /settings/display — patient-level settings update
  api.put('/settings/display', ctx.authorization.isPermitted('api:settings:read'), function putDisplaySettings (req, res) {
    if (!ctx.settingsStore) {
      return res.status(503).json({ status: 503, message: 'Settings store not available' });
    }

    var body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ status: 400, message: 'Request body must be a JSON object' });
    }

    // Only allow patient-safe fields
    var allowed = {};
    if (body.display) allowed.display = body.display;
    if (body.alarms) allowed.alarms = body.alarms;
    if (body.thresholds) allowed.thresholds = body.thresholds;

    if (Object.keys(allowed).length === 0) {
      return res.status(400).json({ status: 400, message: 'No valid fields provided. Allowed: display, alarms, thresholds' });
    }

    ctx.settingsStore.update(allowed, function (err, result) {
      if (err) {
        return res.status(500).json({ status: 500, message: err.message });
      }
      res.json({ status: 200, message: 'Display settings updated', _srvModified: result._srvModified });
    });
  });

  return api;
}

module.exports = configure;
