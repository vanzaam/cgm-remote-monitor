'use strict';

var crypto = require('crypto');
var webpush = require('web-push');

/**
 * Web Push notification module for Nightscout.
 *
 * Sends browser push notifications when alarms fire, so patients
 * receive alerts even when the Nightscout tab is closed.
 *
 * VAPID keys are generated once and stored in the nightscout_config
 * collection. Subscriptions are stored per-site in push_subscriptions.
 *
 * Multi-instance safety: when multiple Nightscout servers share the same
 * MongoDB (HA/failover setup), only ONE server sends each push notification.
 * This is achieved via atomic "claim" in push_sent collection — the first
 * server to insert the claim document wins, others skip.
 */
function init (env, ctx) {

  var webPush = {};
  var vapidConfigured = false;
  var SUBSCRIPTION_COLLECTION = 'push_subscriptions';
  var PUSH_SENT_COLLECTION = 'push_sent';
  var DEDUP_WINDOW_MS = 30000; // 30 seconds — ignore duplicate alarms within this window
  var instanceId = crypto.randomBytes(8).toString('hex'); // unique ID for this server instance

  function getSubCollection () {
    if (!ctx.store || !ctx.store.collection) return null;
    return ctx.store.collection(SUBSCRIPTION_COLLECTION);
  }

  /**
   * Initialize VAPID keys. Loads from MongoDB → disk cache → generates new.
   * Always caches to disk so Web Push works when MongoDB is down.
   */
  webPush.setupVAPID = function setupVAPID (callback) {

    // Try disk cache first (works even without MongoDB)
    if (ctx.diskBuffer) {
      var cached = ctx.diskBuffer.cacheRead('vapid_keys');
      if (cached && cached.publicKey && cached.privateKey) {
        console.log('Web Push: loaded VAPID keys from disk cache');
        configureVAPID(cached.publicKey, cached.privateKey, cached.contactEmail);
        // Still try to sync with MongoDB in background
        syncVAPIDtoMongo(cached);
        return callback(null);
      }
    }

    if (!ctx.store || !ctx.store.collection) {
      // No MongoDB, no disk cache — generate fresh keys and cache them
      var keys = webpush.generateVAPIDKeys();
      var vapidDoc = {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        contactEmail: 'mailto:nightscout@example.com'
      };
      configureVAPID(vapidDoc.publicKey, vapidDoc.privateKey, vapidDoc.contactEmail);
      if (ctx.diskBuffer) ctx.diskBuffer.cacheWrite('vapid_keys', vapidDoc);
      console.log('Web Push: generated new VAPID keys (no MongoDB, cached to disk)');
      return callback(null);
    }

    var configCol = ctx.store.collection('nightscout_config');
    configCol.findOne({ _id: 'vapid_keys' })
      .then(function (doc) {
        if (doc && doc.publicKey && doc.privateKey) {
          console.log('Web Push: loaded existing VAPID keys from MongoDB');
          configureVAPID(doc.publicKey, doc.privateKey, doc.contactEmail);
          // Cache to disk for offline use
          if (ctx.diskBuffer) {
            ctx.diskBuffer.cacheWrite('vapid_keys', {
              publicKey: doc.publicKey,
              privateKey: doc.privateKey,
              contactEmail: doc.contactEmail
            });
          }
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
            if (ctx.diskBuffer) {
              ctx.diskBuffer.cacheWrite('vapid_keys', {
                publicKey: keys.publicKey,
                privateKey: keys.privateKey,
                contactEmail: vapidDoc.contactEmail
              });
            }
            callback(null);
          })
          .catch(function (err) {
            console.warn('Web Push: failed to save VAPID keys to MongoDB:', err.message);
            configureVAPID(keys.publicKey, keys.privateKey, vapidDoc.contactEmail);
            if (ctx.diskBuffer) {
              ctx.diskBuffer.cacheWrite('vapid_keys', {
                publicKey: keys.publicKey,
                privateKey: keys.privateKey,
                contactEmail: vapidDoc.contactEmail
              });
            }
            callback(null);
          });
      })
      .catch(function (err) {
        console.warn('Web Push: failed to load VAPID keys from MongoDB:', err.message);
        // Fall back to disk cache (already checked above, but in case of race)
        callback(null);
      });
  };

  function syncVAPIDtoMongo (vapidDoc) {
    if (!ctx.store || !ctx.store.collection) return;
    var configCol = ctx.store.collection('nightscout_config');
    configCol.replaceOne({ _id: 'vapid_keys' }, {
      _id: 'vapid_keys',
      publicKey: vapidDoc.publicKey,
      privateKey: vapidDoc.privateKey,
      contactEmail: vapidDoc.contactEmail,
      createdAt: new Date().toISOString()
    }, { upsert: true }).catch(function () {});
  }

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

  // In-memory cache of subscriptions (always kept in sync)
  var subscriptionsCache = [];

  /**
   * Save a push subscription from a client.
   * Persists to MongoDB + disk cache.
   */
  webPush.subscribe = function subscribe (subscription, callback) {
    if (!subscription || !subscription.endpoint) {
      return callback(new Error('Invalid subscription: missing endpoint'));
    }

    var doc = {
      endpoint: subscription.endpoint,
      keys: subscription.keys || {},
      createdAt: new Date().toISOString(),
      userAgent: subscription.userAgent || 'unknown'
    };

    // Always update in-memory + disk cache
    updateSubscriptionCache(doc);

    var col = getSubCollection();
    if (!col) {
      // No MongoDB — saved to memory + disk, that's enough
      return callback(null, { success: true });
    }

    col.replaceOne(
      { endpoint: subscription.endpoint },
      doc,
      { upsert: true }
    )
      .then(function () {
        callback(null, { success: true });
      })
      .catch(function (err) {
        // MongoDB failed but we have it in disk cache — still OK
        console.warn('Web Push: MongoDB save failed, subscription cached to disk:', err.message);
        callback(null, { success: true });
      });
  };

  /**
   * Remove a push subscription.
   */
  webPush.unsubscribe = function unsubscribe (endpoint, callback) {
    // Remove from in-memory + disk cache
    subscriptionsCache = subscriptionsCache.filter(function (s) {
      return s.endpoint !== endpoint;
    });
    persistSubscriptionCache();

    var col = getSubCollection();
    if (!col) {
      return callback(null, { success: true });
    }

    col.deleteOne({ endpoint: endpoint })
      .then(function () {
        callback(null, { success: true });
      })
      .catch(function () {
        callback(null, { success: true });
      });
  };

  function updateSubscriptionCache (doc) {
    // Replace or add subscription in memory
    var found = false;
    for (var i = 0; i < subscriptionsCache.length; i++) {
      if (subscriptionsCache[i].endpoint === doc.endpoint) {
        subscriptionsCache[i] = doc;
        found = true;
        break;
      }
    }
    if (!found) subscriptionsCache.push(doc);
    persistSubscriptionCache();
  }

  function persistSubscriptionCache () {
    if (ctx.diskBuffer) {
      ctx.diskBuffer.cacheWrite('push_subscriptions', subscriptionsCache);
    }
  }

  /**
   * Load subscriptions from MongoDB, with disk cache fallback.
   */
  function loadSubscriptions (callback) {
    var col = getSubCollection();
    if (col) {
      col.find({}).toArray()
        .then(function (subs) {
          if (subs && subs.length > 0) {
            subscriptionsCache = subs;
            persistSubscriptionCache();
          }
          callback(subscriptionsCache);
        })
        .catch(function () {
          // MongoDB failed — use disk cache
          if (subscriptionsCache.length === 0 && ctx.diskBuffer) {
            var cached = ctx.diskBuffer.cacheRead('push_subscriptions');
            if (cached && Array.isArray(cached)) {
              subscriptionsCache = cached;
            }
          }
          callback(subscriptionsCache);
        });
    } else {
      // No MongoDB at all — load from disk
      if (subscriptionsCache.length === 0 && ctx.diskBuffer) {
        var cached = ctx.diskBuffer.cacheRead('push_subscriptions');
        if (cached && Array.isArray(cached)) {
          subscriptionsCache = cached;
        }
      }
      callback(subscriptionsCache);
    }
  }

  // Load subscriptions from disk on init
  if (ctx.diskBuffer) {
    var cached = ctx.diskBuffer.cacheRead('push_subscriptions');
    if (cached && Array.isArray(cached)) {
      subscriptionsCache = cached;
      console.log('Web Push: loaded', subscriptionsCache.length, 'subscription(s) from disk cache');
    }
  }

  /**
   * Claim the right to send a notification (multi-instance deduplication).
   *
   * Uses MongoDB insertOne with a unique _id derived from notification content.
   * The first server to insert wins (MongoDB guarantees atomic insert).
   * Second server gets duplicate key error → skips sending.
   *
   * TTL index on push_sent ensures old claims are cleaned up automatically.
   */
  function claimNotification (notifyKey, callback) {
    if (!ctx.store || !ctx.store.collection) {
      // No DB = no dedup = always send (single instance assumed)
      return callback(null, true);
    }

    var sentCol = ctx.store.collection(PUSH_SENT_COLLECTION);
    var claimDoc = {
      _id: notifyKey,
      instanceId: instanceId,
      sentAt: new Date()
    };

    sentCol.insertOne(claimDoc)
      .then(function () {
        callback(null, true); // We claimed it — send the push
      })
      .catch(function (err) {
        if (err.code === 11000) {
          // Duplicate key = another instance already claimed this notification
          console.log('Web Push: notification already sent by another instance, skipping');
          callback(null, false);
        } else {
          // DB error — send anyway to avoid missing critical alarms
          console.warn('Web Push: dedup claim error, sending anyway:', err.message);
          callback(null, true);
        }
      });
  }

  /**
   * Ensure TTL index on push_sent collection (auto-cleanup old claims).
   */
  webPush.ensureIndexes = function ensureIndexes () {
    if (!ctx.store || !ctx.store.collection) return;

    var sentCol = ctx.store.collection(PUSH_SENT_COLLECTION);
    sentCol.createIndex(
      { sentAt: 1 },
      { expireAfterSeconds: 300, background: true } // Clean up after 5 minutes
    ).catch(function (err) {
      console.warn('Web Push: failed to create TTL index on push_sent:', err.message);
    });
  };

  /**
   * Send a push notification to ALL subscribed devices for this site.
   * Deduplicates across multiple server instances via MongoDB claim.
   */
  webPush.sendNotification = function sendNotification (payload, notifyKey) {
    if (!vapidConfigured) return;

    // Generate dedup key from payload content + time window
    var dedupKey = notifyKey || payload.type + ':' + payload.level + ':' +
      (payload.group || 'default') + ':' +
      Math.floor(Date.now() / DEDUP_WINDOW_MS);

    claimNotification(dedupKey, function (err, claimed) {
      if (!claimed) return; // Another instance will send this

      var payloadStr = JSON.stringify(payload);

      loadSubscriptions(function (subscriptions) {
        if (!subscriptions || subscriptions.length === 0) return;

        console.log('Web Push: sending to', subscriptions.length, 'subscription(s) [instance:', instanceId.substring(0, 6) + ']');

        subscriptions.forEach(function (sub) {
          var pushSub = {
            endpoint: sub.endpoint,
            keys: sub.keys
          };

          webpush.sendNotification(pushSub, payloadStr)
            .catch(function (sendErr) {
              if (sendErr.statusCode === 410 || sendErr.statusCode === 404 || sendErr.statusCode === 403 || sendErr.statusCode === 400 || sendErr.statusCode === 401) {
                // Subscription expired, invalid, or VAPID key mismatch — remove
                console.log('Web Push: removing invalid subscription (' + sendErr.statusCode + '):', sub.endpoint.substring(0, 50) + '...');
                webPush.unsubscribe(sub.endpoint, function () {});
              } else {
                console.warn('Web Push: failed to send to', sub.endpoint.substring(0, 50) + '...', sendErr.statusCode || sendErr.message);
              }
            });
        });
      });
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
