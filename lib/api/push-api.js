'use strict';

/**
 * Web Push subscription API.
 *
 * GET    /push/vapidkey  — get VAPID public key (no auth required)
 * POST   /push/subscribe — save push subscription (readable access)
 * DELETE /push/subscribe — remove push subscription (readable access)
 */
function configure (app, wares, ctx) {
  var express = require('express');
  var api = express.Router();

  api.use(wares.bodyParser({
    limit: 10240 // 10KB — subscriptions are small
  }));

  // GET /push/vapidkey — public, no auth needed (client needs this to subscribe)
  api.get('/push/vapidkey', function getVapidKey (req, res) {
    if (!ctx.webPush) {
      return res.status(503).json({ status: 503, message: 'Web Push not configured' });
    }

    var key = ctx.webPush.getPublicKey();
    if (!key) {
      return res.status(503).json({ status: 503, message: 'VAPID keys not ready' });
    }

    res.json({ vapidPublicKey: key });
  });

  // POST /push/subscribe — save a push subscription
  api.post('/push/subscribe', ctx.authorization.isPermitted('api:*:read'), function postSubscribe (req, res) {
    if (!ctx.webPush) {
      return res.status(503).json({ status: 503, message: 'Web Push not configured' });
    }

    var subscription = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ status: 400, message: 'Invalid subscription object. Expected {endpoint, keys: {p256dh, auth}}' });
    }

    // Add user agent for debugging
    subscription.userAgent = req.headers['user-agent'] || 'unknown';

    ctx.webPush.subscribe(subscription, function (err) {
      if (err) {
        console.error('Web Push: subscribe failed:', err.message);
        return res.status(500).json({ status: 500, message: err.message });
      }
      console.log('Web Push: new subscription from', (subscription.userAgent || 'unknown').substring(0, 60));
      res.json({ status: 200, message: 'Subscribed to push notifications' });
    });
  });

  // POST /push/verify — check if a subscription still exists on the server
  api.post('/push/verify', ctx.authorization.isPermitted('api:*:read'), function postVerify (req, res) {
    if (!ctx.webPush) {
      return res.status(503).json({ status: 503, message: 'Web Push not configured' });
    }

    var endpoint = req.body && req.body.endpoint;
    if (!endpoint) {
      return res.status(400).json({ status: 400, message: 'Missing endpoint in request body' });
    }

    ctx.webPush.hasSubscription(endpoint, function (err, exists) {
      if (err) {
        return res.status(500).json({ status: 500, message: err.message });
      }
      res.json({ status: 200, exists: exists });
    });
  });

  // DELETE /push/subscribe — remove a push subscription
  api.delete('/push/subscribe', ctx.authorization.isPermitted('api:*:read'), function deleteSubscribe (req, res) {
    if (!ctx.webPush) {
      return res.status(503).json({ status: 503, message: 'Web Push not configured' });
    }

    var endpoint = req.body && req.body.endpoint;
    if (!endpoint) {
      return res.status(400).json({ status: 400, message: 'Missing endpoint in request body' });
    }

    ctx.webPush.unsubscribe(endpoint, function (err) {
      if (err) {
        return res.status(500).json({ status: 500, message: err.message });
      }
      res.json({ status: 200, message: 'Unsubscribed from push notifications' });
    });
  });

  return api;
}

module.exports = configure;
