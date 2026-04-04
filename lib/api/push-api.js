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

  // GET /push/subscriptions — admin: list all active subscriptions
  api.get('/push/subscriptions', ctx.authorization.isPermitted('api:settings:admin'), function listSubs (req, res) {
    if (!ctx.webPush) {
      return res.status(503).json({ status: 503, message: 'Web Push not configured' });
    }
    res.json({
      config: ctx.webPush.getConfig(),
      subscriptions: ctx.webPush.listSubscriptions()
    });
  });

  // DELETE /push/subscriptions/all — admin: clear all subscriptions (nuclear option)
  api.delete('/push/subscriptions/all', ctx.authorization.isPermitted('api:settings:admin'), function clearAll (req, res) {
    if (!ctx.webPush) {
      return res.status(503).json({ status: 503, message: 'Web Push not configured' });
    }
    var subs = ctx.webPush.listSubscriptions();
    var count = subs.length;
    subs.forEach(function (sub) {
      // Get full endpoint from the sub list
      ctx.webPush.unsubscribe(sub.endpoint.replace('...', ''), function () {});
    });
    res.json({ status: 200, message: 'Cleared ' + count + ' subscription(s). Clients will need to re-subscribe.' });
  });

  // POST /push/test — admin: send a test push notification
  api.post('/push/test', ctx.authorization.isPermitted('api:settings:admin'), function testPush (req, res) {
    if (!ctx.webPush) {
      return res.status(503).json({ status: 503, message: 'Web Push not configured' });
    }
    ctx.webPush.sendNotification({
      type: 'alarm',
      title: 'Test Notification',
      message: 'This is a test push from Nightscout admin at ' + new Date().toLocaleTimeString(),
      level: 'info',
      group: 'test'
    });
    res.json({ status: 200, message: 'Test push sent to all subscriptions' });
  });

  return api;
}

module.exports = configure;
