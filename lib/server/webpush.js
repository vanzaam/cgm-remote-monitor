'use strict';

var webpush = require('web-push');

/**
 * Web Push notification module for Nightscout.
 *
 * Sends browser push notifications when alarms fire, so patients
 * receive alerts even when the Nightscout tab is closed.
 *
 * VAPID keys are generated once and stored in the nightscout_config
 * collection. Subscriptions are stored per-site in push_subscriptions.
 */
function init (env, ctx) {

  var webPush = {};
  var vapidConfigured = false;
  var SUBSCRIPTION_COLLECTION = 'push_subscriptions';

  function getSubCollection () {
    if (!ctx.store || !ctx.store.collection) return null;
    return ctx.store.collection(SUBSCRIPTION_COLLECTION);
  }

  /**
   * Initialize VAPID keys. Loads from MongoDB or generates new ones.
   */
  webPush.setupVAPID = function setupVAPID (callback) {
    if (!ctx.store || !ctx.store.collection) {
      console.log('Web Push: no database, skipping VAPID setup');
      return callback(null);
    }

    var configCol = ctx.store.collection('nightscout_config');
    configCol.findOne({ _id: 'vapid_keys' })
      .then(function (doc) {
        if (doc && doc.publicKey && doc.privateKey) {
          console.log('Web Push: loaded existing VAPID keys');
          configureVAPID(doc.publicKey, doc.privateKey, doc.contactEmail);
          return callback(null);
        }

        // Generate new VAPID keys
        var keys = webpush.generateVAPIDKeys();
        var vapidDoc = {
          _id: 'vapid_keys',
          publicKey: keys.publicKey,
          privateKey: keys.privateKey,
          contactEmail: 'mailto:nightscout@example.com',
          createdAt: new Date().toISOString()
        };

        configCol.insertOne(vapidDoc)
          .then(function () {
            console.log('Web Push: generated and saved new VAPID keys');
            configureVAPID(keys.publicKey, keys.privateKey, vapidDoc.contactEmail);
            callback(null);
          })
          .catch(function (err) {
            console.warn('Web Push: failed to save VAPID keys:', err.message);
            // Still configure them for this session
            configureVAPID(keys.publicKey, keys.privateKey, vapidDoc.contactEmail);
            callback(null);
          });
      })
      .catch(function (err) {
        console.warn('Web Push: failed to load VAPID keys:', err.message);
        callback(null);
      });
  };

  function configureVAPID (publicKey, privateKey, contactEmail) {
    webpush.setVapidDetails(
      contactEmail || 'mailto:nightscout@example.com',
      publicKey,
      privateKey
    );
    webPush.publicKey = publicKey;
    vapidConfigured = true;
  }

  /**
   * Get the VAPID public key (client needs this to subscribe).
   */
  webPush.getPublicKey = function getPublicKey () {
    return webPush.publicKey || null;
  };

  /**
   * Save a push subscription from a client.
   */
  webPush.subscribe = function subscribe (subscription, callback) {
    var col = getSubCollection();
    if (!col) return callback(new Error('No database connection'));

    if (!subscription || !subscription.endpoint) {
      return callback(new Error('Invalid subscription: missing endpoint'));
    }

    var doc = {
      endpoint: subscription.endpoint,
      keys: subscription.keys || {},
      createdAt: new Date().toISOString(),
      userAgent: subscription.userAgent || 'unknown'
    };

    // Use endpoint as unique key (upsert to avoid duplicates)
    col.replaceOne(
      { endpoint: subscription.endpoint },
      doc,
      { upsert: true }
    )
      .then(function () {
        callback(null, { success: true });
      })
      .catch(callback);
  };

  /**
   * Remove a push subscription.
   */
  webPush.unsubscribe = function unsubscribe (endpoint, callback) {
    var col = getSubCollection();
    if (!col) return callback(new Error('No database connection'));

    col.deleteOne({ endpoint: endpoint })
      .then(function () {
        callback(null, { success: true });
      })
      .catch(callback);
  };

  /**
   * Send a push notification to ALL subscribed devices for this site.
   */
  webPush.sendNotification = function sendNotification (payload) {
    if (!vapidConfigured) return;

    var col = getSubCollection();
    if (!col) return;

    var payloadStr = JSON.stringify(payload);

    col.find({}).toArray()
      .then(function (subscriptions) {
        if (!subscriptions || subscriptions.length === 0) return;

        console.log('Web Push: sending to', subscriptions.length, 'subscription(s)');

        subscriptions.forEach(function (sub) {
          var pushSub = {
            endpoint: sub.endpoint,
            keys: sub.keys
          };

          webpush.sendNotification(pushSub, payloadStr)
            .catch(function (err) {
              if (err.statusCode === 410 || err.statusCode === 404) {
                // Subscription expired or invalid — remove it
                console.log('Web Push: removing expired subscription:', sub.endpoint.substring(0, 50) + '...');
                col.deleteOne({ endpoint: sub.endpoint }).catch(function () {});
              } else {
                console.warn('Web Push: failed to send to', sub.endpoint.substring(0, 50) + '...', err.statusCode || err.message);
              }
            });
        });
      })
      .catch(function (err) {
        console.warn('Web Push: failed to load subscriptions:', err.message);
      });
  };

  /**
   * Handle Nightscout notification events — bridge to Web Push.
   */
  webPush.emitNotification = function emitNotification (notify) {
    if (!vapidConfigured) return;

    if (notify.clear) {
      webPush.sendNotification({
        type: 'clear',
        title: notify.title || 'All Clear',
        message: notify.message || '',
        group: notify.group || 'default'
      });
      return;
    }

    if (notify.isAnnouncement) {
      webPush.sendNotification({
        type: 'announcement',
        title: notify.title || 'Announcement',
        message: notify.message || '',
        level: 'announce'
      });
      return;
    }

    var level = 'info';
    if (ctx.levels) {
      if (notify.level === ctx.levels.URGENT) level = 'urgent';
      else if (notify.level === ctx.levels.WARN) level = 'warn';
    }

    webPush.sendNotification({
      type: 'alarm',
      title: notify.title || 'Nightscout Alert',
      message: notify.message || '',
      level: level,
      group: notify.group || 'default',
      plugin: notify.plugin ? notify.plugin.name : undefined
    });
  };

  return webPush;
}

module.exports = init;
