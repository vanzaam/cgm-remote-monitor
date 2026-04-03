'use strict';

var should = require('should');
var fs = require('fs');
var path = require('path');
var os = require('os');

var BUFFER_DIR = path.join(os.tmpdir(), 'nightscout-test-buffer-' + process.pid);

// Clean up before/after tests
function cleanDir () {
  try {
    if (fs.existsSync(BUFFER_DIR)) {
      fs.readdirSync(BUFFER_DIR).forEach(function (f) {
        fs.unlinkSync(path.join(BUFFER_DIR, f));
      });
      fs.rmdirSync(BUFFER_DIR);
    }
  } catch (e) { /* ignore */ }
}

describe('memory-storage', function () {
  var store;

  before(function (done) {
    cleanDir();
    process.env.NIGHTSCOUT_BUFFER_DIR = BUFFER_DIR;
    var memStore = require('../lib/storage/memory-storage');
    memStore({}, function (err, s) {
      store = s;
      done();
    });
  });

  after(function () {
    if (store && store.client) store.client.close();
    cleanDir();
  });

  it('should create collections', function () {
    var col = store.collection('test');
    should.exist(col);
    col.name.should.equal('test');
  });

  it('should insertOne and findOne', async function () {
    var col = store.collection('entries');
    var result = await col.insertOne({ sgv: 120, type: 'sgv', date: 1000 });
    should.exist(result.insertedId);

    var doc = await col.findOne({ sgv: 120 });
    should.exist(doc);
    doc.sgv.should.equal(120);
  });

  it('should insertMany and find all', async function () {
    var col = store.collection('batch_test');
    await col.insertMany([
      { sgv: 100, date: 1 },
      { sgv: 200, date: 2 },
      { sgv: 300, date: 3 }
    ]);
    var all = await col.find({}).toArray();
    all.length.should.equal(3);
  });

  it('should replaceOne with upsert', async function () {
    var col = store.collection('upsert_test');
    var r1 = await col.replaceOne({ key: 'a' }, { key: 'a', value: 1 }, { upsert: true });
    r1.upsertedCount.should.equal(1);

    var r2 = await col.replaceOne({ key: 'a' }, { key: 'a', value: 2 }, { upsert: true });
    r2.matchedCount.should.equal(1);

    var doc = await col.findOne({ key: 'a' });
    doc.value.should.equal(2);
  });

  it('should updateOne with $set and $unset', async function () {
    var col = store.collection('update_test');
    await col.insertOne({ name: 'test', status: 'active', temp: true });

    await col.updateOne({ name: 'test' }, { $set: { status: 'inactive' }, $unset: { temp: 1 } });

    var doc = await col.findOne({ name: 'test' });
    doc.status.should.equal('inactive');
    should.not.exist(doc.temp);
  });

  it('should deleteOne', async function () {
    var col = store.collection('delete_test');
    await col.insertOne({ x: 1 });
    await col.insertOne({ x: 2 });

    var result = await col.deleteOne({ x: 1 });
    result.deletedCount.should.equal(1);

    var remaining = await col.find({}).toArray();
    remaining.length.should.equal(1);
    remaining[0].x.should.equal(2);
  });

  it('should deleteMany', async function () {
    var col = store.collection('delmany_test');
    await col.insertOne({ type: 'a' });
    await col.insertOne({ type: 'a' });
    await col.insertOne({ type: 'b' });

    var result = await col.deleteMany({ type: 'a' });
    result.deletedCount.should.equal(2);

    var remaining = await col.find({}).toArray();
    remaining.length.should.equal(1);
  });

  it('should sort and limit', async function () {
    var col = store.collection('sort_test');
    await col.insertOne({ v: 3 });
    await col.insertOne({ v: 1 });
    await col.insertOne({ v: 2 });

    var sorted = await col.find({}).sort({ v: 1 }).toArray();
    sorted[0].v.should.equal(1);
    sorted[2].v.should.equal(3);

    var limited = await col.find({}).sort({ v: -1 }).limit(2).toArray();
    limited.length.should.equal(2);
    limited[0].v.should.equal(3);
  });

  describe('query operators', function () {
    var col;
    before(async function () {
      col = store.collection('query_test');
      await col.insertOne({ sgv: 50, date: 100 });
      await col.insertOne({ sgv: 120, date: 200 });
      await col.insertOne({ sgv: 250, date: 300 });
    });

    it('$gte', async function () {
      var r = await col.find({ sgv: { $gte: 120 } }).toArray();
      r.length.should.equal(2);
    });

    it('$gt', async function () {
      var r = await col.find({ sgv: { $gt: 120 } }).toArray();
      r.length.should.equal(1);
    });

    it('$lte', async function () {
      var r = await col.find({ sgv: { $lte: 120 } }).toArray();
      r.length.should.equal(2);
    });

    it('$lt', async function () {
      var r = await col.find({ sgv: { $lt: 120 } }).toArray();
      r.length.should.equal(1);
    });

    it('$ne', async function () {
      var r = await col.find({ sgv: { $ne: 120 } }).toArray();
      r.length.should.equal(2);
    });

    it('$in', async function () {
      var r = await col.find({ sgv: { $in: [50, 250] } }).toArray();
      r.length.should.equal(2);
    });

    it('$and', async function () {
      var r = await col.find({ $and: [{ sgv: { $gte: 100 } }, { sgv: { $lte: 200 } }] }).toArray();
      r.length.should.equal(1);
    });

    it('$or', async function () {
      var r = await col.find({ $or: [{ sgv: 50 }, { sgv: 250 }] }).toArray();
      r.length.should.equal(2);
    });
  });

  it('should provide db.stats()', async function () {
    var stats = await store.db.stats();
    stats.dataSize.should.be.above(0);
    stats.indexSize.should.be.above(0);
  });
});

describe('diskbuffer', function () {
  var diskBuffer;

  before(function () {
    cleanDir();
    process.env.NIGHTSCOUT_BUFFER_DIR = BUFFER_DIR;
    diskBuffer = require('../lib/server/diskbuffer')({}, {});
  });

  after(function () {
    cleanDir();
  });

  it('should append entries', function () {
    diskBuffer.append('entries', { sgv: 120, date: Date.now() });
    diskBuffer.append('entries', { sgv: 200, date: Date.now() });
    diskBuffer.hasData().should.be.true();
    diskBuffer.count().should.equal(2);
  });

  it('should cacheWrite and cacheRead', function () {
    diskBuffer.cacheWrite('test_cache', { hello: 'world', num: 42 });
    var cached = diskBuffer.cacheRead('test_cache');
    should.exist(cached);
    cached.hello.should.equal('world');
    cached.num.should.equal(42);
  });

  it('should return null for missing cache', function () {
    var result = diskBuffer.cacheRead('nonexistent');
    should(result).be.null();
  });

  it('should report status', function () {
    var status = diskBuffer.status();
    status.active.should.be.true();
    status.count.should.be.above(0);
    status.sizeBytes.should.be.above(0);
    status.maxAgeMins.should.equal(1440);
  });

  it('should trim old entries', function () {
    // Write an old entry directly
    var bufferFile = diskBuffer.getBufferPath();
    var oldLine = JSON.stringify({ collection: 'entries', doc: { sgv: 1 }, timestamp: 1000 }) + '\n';
    fs.appendFileSync(bufferFile, oldLine, 'utf8');

    var beforeTrim = diskBuffer.count();
    diskBuffer.trim();
    var afterTrim = diskBuffer.count();
    afterTrim.should.be.below(beforeTrim);
  });
});

describe('tenant-env', function () {
  var buildEnvForTenant = require('../lib/server/tenant-env');

  it('should build env from config object', function () {
    var env = buildEnvForTenant({
      hostname: 'test.example.com',
      mongoUri: 'mongodb://localhost/test',
      settings: {
        DISPLAY_UNITS: 'mmol',
        ENABLE: 'careportal iob cob',
        THEME: 'colors',
        LANGUAGE: 'ru',
        TIME_FORMAT: '24',
        NIGHT_MODE: 'true'
      }
    });

    env.storageURI.should.equal('mongodb://localhost/test');
    env.settings.units.should.equal('mmol');
    env.settings.theme.should.equal('colors');
    env.settings.language.should.equal('ru');
    env.settings.timeFormat.should.equal(24);
    env.settings.nightMode.should.equal(true);
    env.settings.enable.should.containEql('careportal');
    env.settings.enable.should.containEql('iob');
  });

  it('should set API_SECRET via enclave', function () {
    var env = buildEnvForTenant({
      mongoUri: 'mongodb://localhost/test',
      apiSecret: 'test-secret-long-enough'
    });
    should.exist(env.enclave);
  });

  it('should reject short API_SECRET', function () {
    var env = buildEnvForTenant({
      mongoUri: 'mongodb://localhost/test',
      apiSecret: 'short'
    });
    env.err.length.should.be.above(0);
  });

  it('should use default collection names', function () {
    var env = buildEnvForTenant({ mongoUri: 'mongodb://localhost/test' });
    env.entries_collection.should.equal('entries');
    env.treatments_collection.should.equal('treatments');
    env.profile_collection.should.equal('profile');
  });

  it('should set version from package.json', function () {
    var env = buildEnvForTenant({ mongoUri: 'mongodb://localhost/test' });
    should.exist(env.version);
    env.version.should.match(/^\d+\.\d+\.\d+/);
  });

  it('should default insecureUseHttp to false', function () {
    var env = buildEnvForTenant({ mongoUri: 'mongodb://localhost/test' });
    env.insecureUseHttp.should.equal(false);
  });
});

describe('settings-store', function () {
  var settingsStore, mockCtx;

  before(function (done) {
    process.env.NIGHTSCOUT_BUFFER_DIR = BUFFER_DIR;
    var memStore = require('../lib/storage/memory-storage');
    memStore({}, function (err, store) {
      mockCtx = {
        store: store,
        bus: { emit: function () {} },
        diskBuffer: require('../lib/server/diskbuffer')({}, {})
      };
      var env = { settings: require('../lib/settings')(), extendedSettings: {}, enclave: { setApiKey: function () {} } };
      settingsStore = require('../lib/server/settings-store')(env, mockCtx);
      done();
    });
  });

  after(function () { cleanDir(); });

  it('should save and load settings', function (done) {
    settingsStore.save({ display: { units: 'mmol', theme: 'colors' } }, function (err, doc) {
      should.not.exist(err);
      doc._srvModified.should.be.above(0);

      settingsStore.getForAPI('admin', function (err2, result) {
        should.not.exist(err2);
        result.display.units.should.equal('mmol');
        done();
      });
    });
  });

  it('should update with deep merge', function (done) {
    settingsStore.update({ display: { language: 'ru' } }, function (err) {
      should.not.exist(err);
      settingsStore.getForAPI('admin', function (err2, result) {
        result.display.units.should.equal('mmol'); // preserved
        result.display.language.should.equal('ru'); // added
        done();
      });
    });
  });

  it('should mask secrets for admin', function (done) {
    settingsStore.update({ auth: { API_SECRET: 'supersecret12345' } }, function (err) {
      should.not.exist(err);
      settingsStore.getForAPI('admin', function (err2, result) {
        result.auth.API_SECRET.should.equal('[CONFIGURED]');
        done();
      });
    });
  });

  it('should not show auth to patient', function (done) {
    settingsStore.getForAPI('patient', function (err, result) {
      should.not.exist(err);
      should.not.exist(result.auth);
      should.not.exist(result.integrations);
      done();
    });
  });

  it('should reject short API_SECRET', function (done) {
    settingsStore.update({ auth: { API_SECRET: 'short' } }, function (err) {
      should.exist(err);
      err.message.should.containEql('at least 12');
      done();
    });
  });

  it('should reject invalid thresholds', function (done) {
    settingsStore.update({ thresholds: { bgHigh: 9999 } }, function (err) {
      should.exist(err);
      err.message.should.containEql('bgHigh');
      done();
    });
  });

  it('should sanitize prototype pollution', function (done) {
    settingsStore.update({ '__proto__': { admin: true }, display: { theme: 'safe' } }, function (err) {
      should.not.exist(err);
      // __proto__ should not pollute Object prototype
      var obj = {};
      should.not.exist(obj.admin);
      done();
    });
  });

  it('should change API secret', function (done) {
    settingsStore.changeApiSecret('new-secret-12345-long', function (err) {
      should.not.exist(err);
      done();
    });
  });
});

describe('simulator', function () {
  var simulator, mockCtx;

  before(function () {
    mockCtx = {
      ddata: {
        sgvs: [], treatments: [], devicestatus: [],
        processRawDataForRuntime: function (d) { return d; }
      },
      bus: { emit: function () {} },
      diskBuffer: { append: function () {} },
      levels: { URGENT: 2, WARN: 1 }
    };
    simulator = require('../lib/server/simulator')({}, mockCtx);
  });

  after(function () {
    simulator.stop();
  });

  it('should start and stop', function () {
    simulator.isRunning().should.be.false();
    simulator.start();
    simulator.isRunning().should.be.true();
    simulator.stop();
    simulator.isRunning().should.be.false();
  });

  it('should generate SGV data on start', function () {
    mockCtx.ddata.sgvs = [];
    simulator.start();

    // After start, at least one tick should fire immediately
    mockCtx.ddata.sgvs.length.should.be.above(0);
    var entry = mockCtx.ddata.sgvs[0];
    entry.sgv.should.be.above(0);
    entry.type.should.equal('sgv');
    should.exist(entry.direction);
    should.exist(entry.date);

    simulator.stop();
  });

  it('should generate device status', function () {
    mockCtx.ddata.devicestatus = [];
    simulator.start();

    mockCtx.ddata.devicestatus.length.should.be.above(0);
    var ds = mockCtx.ddata.devicestatus[0];
    should.exist(ds.pump);
    ds.pump.battery.percent.should.be.above(0);
    should.exist(ds.uploader);

    simulator.stop();
  });

  it('should report status', function () {
    var status = simulator.status();
    status.running.should.be.false();
    status.cycleMinutes.should.equal(60);

    simulator.start();
    var running = simulator.status();
    running.running.should.be.true();
    running.phase.should.be.type('string');
    running.minuteInCycle.should.be.type('number');

    simulator.stop();
  });
});

describe('webpush', function () {
  var webPush, mockCtx;

  before(function (done) {
    cleanDir();
    process.env.NIGHTSCOUT_BUFFER_DIR = BUFFER_DIR;
    var memStore = require('../lib/storage/memory-storage');
    memStore({}, function (err, store) {
      mockCtx = {
        store: store,
        bus: { emit: function () {} },
        diskBuffer: require('../lib/server/diskbuffer')({}, {}),
        levels: { URGENT: 2, WARN: 1 }
      };
      webPush = require('../lib/server/webpush')({}, mockCtx);
      done();
    });
  });

  after(function () { cleanDir(); });

  it('should setup VAPID keys', function (done) {
    webPush.setupVAPID(function (err) {
      should.not.exist(err);
      var key = webPush.getPublicKey();
      should.exist(key);
      key.length.should.be.above(40);
      done();
    });
  });

  it('should persist VAPID keys to disk', function () {
    var diskBuffer = mockCtx.diskBuffer;
    var cached = diskBuffer.cacheRead('vapid_keys');
    should.exist(cached);
    cached.publicKey.should.equal(webPush.getPublicKey());
  });

  it('should subscribe a push endpoint', function (done) {
    webPush.subscribe({
      endpoint: 'https://fcm.googleapis.com/fcm/send/test123',
      keys: { p256dh: 'testkey', auth: 'testauth' },
      userAgent: 'TestBrowser/1.0'
    }, function (err, result) {
      should.not.exist(err);
      result.success.should.be.true();
      done();
    });
  });

  it('should reject subscription without endpoint', function (done) {
    webPush.subscribe({ keys: {} }, function (err) {
      should.exist(err);
      err.message.should.containEql('endpoint');
      done();
    });
  });

  it('should unsubscribe', function (done) {
    webPush.subscribe({
      endpoint: 'https://fcm.googleapis.com/fcm/send/to-remove',
      keys: { p256dh: 'x', auth: 'y' }
    }, function () {
      webPush.unsubscribe('https://fcm.googleapis.com/fcm/send/to-remove', function (err, result) {
        should.not.exist(err);
        result.success.should.be.true();
        done();
      });
    });
  });

  it('should persist subscriptions to disk', function (done) {
    webPush.subscribe({
      endpoint: 'https://test.push/disk-persist',
      keys: { p256dh: 'a', auth: 'b' }
    }, function () {
      var cached = mockCtx.diskBuffer.cacheRead('push_subscriptions');
      should.exist(cached);
      cached.should.be.Array();
      cached.some(function (s) { return s.endpoint === 'https://test.push/disk-persist'; }).should.be.true();
      done();
    });
  });
});
