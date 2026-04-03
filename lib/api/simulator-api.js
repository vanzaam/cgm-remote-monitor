'use strict';

/**
 * Simulator API — start/stop/status of the data simulator.
 *
 * GET  /simulator/status — check if simulator is running (no auth)
 * PUT  /simulator/start  — start simulator (admin auth)
 * PUT  /simulator/stop   — stop simulator (admin auth)
 */
function configure (app, wares, ctx) {
  var express = require('express');
  var api = express.Router();

  // GET /simulator/status — anyone can check
  api.get('/simulator/status', function getStatus (req, res) {
    if (!ctx.simulator) {
      return res.json({ available: false });
    }
    var status = ctx.simulator.status();
    status.available = true;
    res.json(status);
  });

  // PUT /simulator/start — requires admin
  api.put('/simulator/start', ctx.authorization.isPermitted('api:settings:admin'), function startSim (req, res) {
    if (!ctx.simulator) {
      return res.status(503).json({ status: 503, message: 'Simulator not available' });
    }
    ctx.simulator.start();
    res.json({ status: 200, message: 'Simulator started', simulator: ctx.simulator.status() });
  });

  // PUT /simulator/stop — requires admin
  api.put('/simulator/stop', ctx.authorization.isPermitted('api:settings:admin'), function stopSim (req, res) {
    if (!ctx.simulator) {
      return res.status(503).json({ status: 503, message: 'Simulator not available' });
    }
    ctx.simulator.stop();
    res.json({ status: 200, message: 'Simulator stopped', simulator: ctx.simulator.status() });
  });

  return api;
}

module.exports = configure;
