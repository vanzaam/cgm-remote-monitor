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

  // VAPID contact email — Apple validates this and rejects example.com
  // Use env var, or tenant hostname, or settings
  var vapidEmail = process.env.VAPID_EMAIL || process.env.NIGHTSCOUT_EMAIL || '';
  if (!vapidEmail && env && env.HOSTNAME) {
    vapidEmail = 'mailto:admin@' + env.HOSTNAME;
  }
  if (!vapidEmail) {
    vapidEmail = 'mailto:nightscout@localhost';
  }
  if (!vapidEmail.startsWith('mailto:')) {
    vapidEmail = 'mailto:' + vapidEmail;
  }

  /** Prefer VAPID_EMAIL / NIGHTSCOUT_EMAIL over stale Mongo/disk contact (e.g. nightscout@example.com). */
  function effectiveVapidSubject (storedContactEmail) {
    if (process.env.VAPID_EMAIL || process.env.NIGHTSCOUT_EMAIL) {
      return vapidEmail;
    }
    return storedContactEmail || vapidEmail;
  }

  function normalizeMailto (s) {
    if (!s) return '';
    var t = String(s).trim();
    if (t.toLowerCase().indexOf('mailto:') === 0) {
      t = t.slice(7);
    }
    return t.toLowerCase();
  }

  /** When env overrides stored contact, rewrite vapid_keys on disk + Mongo so exports match web-push. */
  function persistVapidContactIfChanged (publicKey, privateKey, previouslyStoredContact) {
    var subject = webPush._vapidSubject;
    if (!subject || !publicKey || !privateKey) return;
    if (normalizeMailto(subject) === normalizeMailto(previouslyStoredContact)) return;
    var doc = { publicKey: publicKey, privateKey: privateKey, contactEmail: subject };
    if (ctx.diskBuffer) {
      ctx.diskBuffer.cacheWrite('vapid_keys', doc);
    }
    syncVAPIDtoMongo(doc);
  }

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
        persistVapidContactIfChanged(cached.publicKey, cached.privateKey, cached.contactEmail);
        // Sync to Mongo if disk had keys but Mongo empty (use canonical subject)
        syncVAPIDtoMongo({
          publicKey: cached.publicKey,
          privateKey: cached.privateKey,
          contactEmail: webPush._vapidSubject || cached.contactEmail
        });
        return callback(null);
      }
    }

    if (!ctx.store || !ctx.store.collection) {
      // No MongoDB, no disk cache — generate fresh keys and cache them
      var keys = webpush.generateVAPIDKeys();
      var vapidDoc = {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
        contactEmail: vapidEmail
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
          persistVapidContactIfChanged(doc.publicKey, doc.privateKey, doc.contactEmail);
          // Cache to disk for offline use (effective contact)
          if (ctx.diskBuffer) {
            ctx.diskBuffer.cacheWrite('vapid_keys', {
              publicKey: doc.publicKey,
              privateKey: doc.privateKey,
              contactEmail: webPush._vapidSubject || doc.contactEmail
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
          contactEmail: vapidEmail,
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

  function configureVAPID (publicKey, privateKey, storedContactEmail) {
    var subject = effectiveVapidSubject(storedContactEmail);
    // Store keys for per-request VAPID (don't rely on global setVapidDetails)
    webPush.publicKey = publicKey;
    webPush._privateKey = privateKey;
    webPush._vapidSubject = subject;
    // Also set globally for backwards compat
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidConfigured = true;
    console.log('Web Push: VAPID configured, subject:', subject, 'key:', publicKey.substring(0, 16) + '...');
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
   * Identify a push endpoint for logging: platform + short hash.
   */
  function identifyEndpoint (endpoint) {
    var platform = 'unknown';
    if (endpoint.includes('fcm.googleapis.com') || endpoint.includes('firebase')) platform = 'Chrome/Android';
    else if (endpoint.includes('push.apple.com')) platform = 'Safari/iOS';
    else if (endpoint.includes('mozilla.com') || endpoint.includes('push.services.mozilla.com')) platform = 'Firefox';
    else if (endpoint.includes('notify.windows.com')) platform = 'Edge/Windows';

    var hash = endpoint.length > 20 ? endpoint.substring(endpoint.length - 12) : endpoint;
    return platform + ':' + hash;
  }

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

    console.log('Web Push: new subscription', identifyEndpoint(doc.endpoint),
      'UA:', (doc.userAgent || '').substring(0, 60),
      '| Total subscriptions:', subscriptionsCache.length);

    var col = getSubCollection();
    if (!col) {
      return callback(null, { success: true, id: identifyEndpoint(doc.endpoint) });
    }

    col.replaceOne(
      { endpoint: subscription.endpoint },
      doc,
      { upsert: true }
    )
      .then(function () {
        callback(null, { success: true, id: identifyEndpoint(doc.endpoint) });
      })
      .catch(function (err) {
        console.warn('Web Push: MongoDB save failed, cached to disk:', err.message);
        callback(null, { success: true, id: identifyEndpoint(doc.endpoint) });
      });
  };

  /**
   * Check if a subscription exists (by endpoint).
   */
  webPush.hasSubscription = function hasSubscription (endpoint, callback) {
    // Check in-memory cache first
    for (var i = 0; i < subscriptionsCache.length; i++) {
      if (subscriptionsCache[i].endpoint === endpoint) {
        return callback(null, true);
      }
    }
    // Check MongoDB if available
    var col = getSubCollection();
    if (!col) return callback(null, false);
    col.findOne({ endpoint: endpoint })
      .then(function (doc) { callback(null, !!doc); })
      .catch(function () { callback(null, false); });
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

        console.log('Web Push: sending to', subscriptions.length, 'sub(s)',
          '[key:', (webPush.publicKey || '?').substring(0, 12) + '...',
          'subject:', webPush._vapidSubject || '?',
          'instance:', instanceId.substring(0, 6) + ']');

        subscriptions.forEach(function (sub) {
          var pushSub = {
            endpoint: sub.endpoint,
            keys: sub.keys
          };

          // Use per-request VAPID to guarantee correct keys per tenant
          var sendOptions = {
            vapidDetails: {
              subject: webPush._vapidSubject,
              publicKey: webPush.publicKey,
              privateKey: webPush._privateKey
            }
          };

          webpush.sendNotification(pushSub, payloadStr, sendOptions)
            .then(function () {
              console.log('Web Push: sent OK to', identifyEndpoint(sub.endpoint));
            })
            .catch(function (sendErr) {
              var code = sendErr.statusCode;
              var id = identifyEndpoint(sub.endpoint);
              if (code === 410) {
                // 410 Gone = subscription permanently expired — remove
                console.log('Web Push: subscription expired (410), removing:', id);
                webPush.unsubscribe(sub.endpoint, function () {});
              } else if (code === 404) {
                // 404 = endpoint no longer valid — remove
                console.log('Web Push: endpoint not found (404), removing:', id);
                webPush.unsubscribe(sub.endpoint, function () {});
              } else if (code === 400) {
                // Parse the error body for specific reasons
                var body = '';
                try { body = typeof sendErr.body === 'string' ? sendErr.body : JSON.stringify(sendErr.body); } catch(e) { body = sendErr.message; }

                if (body.indexOf('VapidPkHashMismatch') > -1) {
                  // Subscription was created with different VAPID keys — permanently broken
                  console.log('Web Push: VAPID key mismatch for', id, '— subscription created with old keys, removing. Client must re-subscribe.');
                  webPush.unsubscribe(sub.endpoint, function () {});
                } else if (body.indexOf('ExpiredSubscription') > -1 || body.indexOf('Unregistered') > -1) {
                  console.log('Web Push: subscription expired for', id, '— removing.');
                  webPush.unsubscribe(sub.endpoint, function () {});
                } else {
                  // Other 400 errors — keep subscription, might be temporary
                  console.warn('Web Push: rejected (400) for', id, ':', body);
                }
              } else if (code === 401 || code === 403) {
                // Auth error — VAPID keys may be wrong for this endpoint
                console.warn('Web Push: auth error (' + code + ') for', id,
                  '— VAPID keys may need regeneration');
              } else {
                console.warn('Web Push: send failed (' + (code || 'network') + ') for', id, ':', sendErr.message);
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

  /**
   * List all active subscriptions (for admin debugging).
   */
  webPush.listSubscriptions = function listSubscriptions () {
    return subscriptionsCache.map(function (sub) {
      return {
        id: identifyEndpoint(sub.endpoint),
        platform: identifyEndpoint(sub.endpoint).split(':')[0],
        endpoint: sub.endpoint.substring(0, 60) + '...',
        createdAt: sub.createdAt,
        userAgent: (sub.userAgent || '').substring(0, 80)
      };
    });
  };

  /**
   * Get VAPID configuration info (for admin debugging).
   */
  webPush.getConfig = function getConfig () {
    return {
      configured: vapidConfigured,
      contactEmail: webPush._vapidSubject || vapidEmail,
      publicKey: webPush.publicKey ? webPush.publicKey.substring(0, 20) + '...' : null,
      subscriptions: subscriptionsCache.length
    };
  };

  return webPush;
}

module.exports = init;
