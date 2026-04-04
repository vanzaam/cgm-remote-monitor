# Web Push Notifications for Nightscout

## Overview

Nightscout supports browser-native push notifications via the Web Push API.
When a BG alarm fires, subscribed devices receive a system notification even
if the Nightscout tab is closed or the phone is locked.

This replaces the need for paid services like Pushover for basic alarm delivery.

## How It Works

```
Nightscout Server
  |
  +-- alarm fires -> notification event on bus
  |     |
  |     +-- WebSocket (existing) -> in-app audio/visual alarm
  |     +-- Pushover  (existing) -> Pushover app notification
  |     +-- Web Push  (NEW)      -> browser push notification
  |
  +-- POST /api/v1/push/subscribe
  |     Client sends PushSubscription to server, stored in MongoDB
  |
  +-- GET /api/v1/push/vapidkey
        Returns VAPID public key for client-side subscription
```

## Setup (for site administrators)

VAPID keys are generated on first boot and stored in MongoDB (`nightscout_config`,
document `_id: "vapid_keys"`). The server also mirrors them to a disk cache file
`vapid_keys.json` under the Nightscout buffer directory (see `lib/server/diskbuffer.js`).

**Stable keys across restarts:** set **`NIGHTSCOUT_BUFFER_DIR`** to a **persistent**
path (e.g. Docker `/data/buffer`, or on a Mac something like `$HOME/nightscout-buffer`).
If it is unset, the default is `path.join(os.tmpdir(), 'nightscout-buffer')` — on many
systems `/tmp` is cleared on reboot, so the on-disk VAPID cache can disappear and keys
may be regenerated when Mongo is empty or unreachable (clients must re-subscribe to push).

Optional: **`VAPID_EMAIL`** (or **`NIGHTSCOUT_EMAIL`**) — contact email embedded in VAPID
(subject); some push endpoints (e.g. Apple) reject placeholder domains.

## Usage (for patients / caregivers)

### On Android (Chrome)

1. Open your Nightscout site in Chrome
2. Open the browser console (for now) and run:
   ```javascript
   NightscoutPush.subscribe()
   ```
3. Allow the notification permission when prompted
4. Done! You will receive push notifications for alarms

### On iPhone (Safari, iOS 16.4+)

1. Open your Nightscout site in Safari
2. Tap the Share button -> "Add to Home Screen"
3. Open the Nightscout app from your Home Screen
4. Run `NightscoutPush.subscribe()` from the console, or wait for the UI
   button (coming soon)
5. Allow notification permission
6. Done!

**Important:** On iOS, Web Push only works from a PWA installed to the Home
Screen. It does NOT work from a regular Safari tab.

### On Desktop (Chrome, Firefox, Edge, Safari)

1. Open your Nightscout site
2. Run `NightscoutPush.subscribe()` from the console
3. Allow notifications
4. Works even when the tab is closed (browser must be running)

## API Endpoints

### `GET /api/v1/push/vapidkey`

Returns the VAPID public key. No authentication required.

```json
{ "vapidPublicKey": "BNx..." }
```

### `POST /api/v1/push/subscribe`

Saves a push subscription. Requires readable token.

**Request body:** The `PushSubscription` object from
`pushManager.subscribe()`:

```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "keys": {
    "p256dh": "...",
    "auth": "..."
  }
}
```

### `DELETE /api/v1/push/subscribe`

Removes a subscription. Requires readable token.

```json
{ "endpoint": "https://fcm.googleapis.com/fcm/send/..." }
```

## Notification Payload

Push messages sent to service workers have this format:

```json
{
  "type": "alarm",           // "alarm", "clear", "announcement"
  "title": "Urgent Low",
  "message": "BG 50 mg/dl dropping fast",
  "level": "urgent",         // "urgent", "warn", "info"
  "group": "default",
  "plugin": "simplealarms"
}
```

For `type: "clear"`, existing notifications with matching `group` tag are
automatically dismissed.

## Architecture Notes (for AI assistants and developers)

### Files

| File | Purpose |
|------|---------|
| `lib/server/webpush.js` | Server-side Web Push: VAPID setup, subscription CRUD, sending |
| `lib/api/push-api.js` | REST API endpoints for subscription management |
| `views/service-worker.js` | Service worker: `push` and `notificationclick` handlers |
| `views/index.html` | Client-side `NightscoutPush.subscribe()` helper |
| `static/manifest.json` | PWA manifest with icons and standalone display |

### Data Flow

1. `lib/server/bootevent.js` initializes `ctx.webPush` and calls `setupVAPID()`
2. VAPID keys are loaded from `nightscout_config` collection or generated
3. `ctx.bus.on('notification', ctx.webPush.emitNotification)` listens for alarms
4. When alarm fires: `webpush.sendNotification()` sends HTTP POST to each
   subscription endpoint (FCM for Chrome, APNs for Safari, etc.)
5. Browser receives push, service worker shows `Notification`
6. Expired subscriptions (HTTP 410) are auto-removed from MongoDB

### Collections

- `nightscout_config` document `_id: "vapid_keys"` — VAPID public/private key pair
- `push_subscriptions` — one document per subscribed device

### Server Load

Sending push to N devices = N small HTTP POST requests (~200 bytes each).
For 5 caregivers, an alarm generates 5 requests. This is negligible compared
to the WebSocket data-update cycle.

### Multi-Tenant

In multi-tenant mode, each tenant has its own VAPID keys and subscription
collection in its own MongoDB database. Complete isolation.
