'use strict';

var engine = require('share2nightscout-bridge');

// Track the most recently seen record
var mostRecentRecord;

function dexcomShareApiHostFromDefaults () {
  if (!engine.Defaults || !engine.Defaults.auth) return '';
  var m = String(engine.Defaults.auth).match(/^https?:\/\/([^/]+)/);
  return m ? m[1] : '';
}

/**
 * Host for Dexcom Share API — must match share2nightscout-bridge + site settings "Server" (US/EU).
 * UI field: extendedSettings.bridge.server. Env fallback: BRIDGE_SERVER=EU or custom hostname.
 */
function resolveDexcomShareHostname (bridge) {
  var s = bridge && bridge.server != null ? String(bridge.server).trim() : '';
  if (s === 'EU') return 'shareous1.dexcom.com';
  if (s === 'US') return 'share2.dexcom.com';

  var b = process.env.BRIDGE_SERVER;
  if (b && String(b).toUpperCase() === 'EU') return 'shareous1.dexcom.com';
  if (b && String(b).indexOf('.') > 1) return String(b).trim();

  return 'share2.dexcom.com';
}

function dexcomShareUrls (hostname) {
  var base = 'https://' + hostname;
  return {
    auth: base + '/ShareWebServices/Services/General/AuthenticatePublisherAccount'
    , loginUrl: base + '/ShareWebServices/Services/General/LoginPublisherAccountById'
    , latestGlucose: base + '/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues'
  };
}

function init (env, bus) {
  if (env.extendedSettings.bridge && env.extendedSettings.bridge.userName && env.extendedSettings.bridge.password) {
    return create(env, bus);
  } else {
    console.info('Dexcom bridge not enabled');
  }
}

function bridged (entries) {
  function payload (err, glucose) {
    if (err) {
      console.error('Bridge error: ', err);
    } else {
      if (glucose) {
        for (var i = 0; i < glucose.length; i++) {
          if (glucose[i].date > mostRecentRecord) {
            mostRecentRecord = glucose[i].date;
          }
        }
        //console.log("DEXCOM: Most recent entry received; "+new Date(mostRecentRecord).toString());
      }
      entries.create(glucose, function stored (err) {
        if (err) {
          console.error('Bridge storage error: ', err);
        }
      });
    }
  }
  return payload;
}

function options (env) {
  var br = env.extendedSettings.bridge;
  var hostname = resolveDexcomShareHostname(br);
  var urls = dexcomShareUrls(hostname);

  // share2nightscout-bridge: credential bag uses .auth and .login (URL strings); do not rely on process.env only.
  var config = {
    accountName: br.userName
    , password: br.password
    , auth: urls.auth
    , login: urls.loginUrl
  };

  var fetch_config = {
    maxCount: br.maxCount || 1
    , minutes: br.minutes || 1440
    , LatestGlucose: urls.latestGlucose
  };

  var interval = br.interval || 60000 * 2.6; // Default: 2.6 minutes

  if (interval < 1000 || interval > 300000) {
        // Invalid interval range. Revert to default
        console.error("Invalid interval set: [" + interval + "ms]. Defaulting to 2.6 minutes.")
        interval = 60000 * 2.6 // 2.6 minutes
  }

  return {
    login: config
    , interval: interval
    , fetch: fetch_config
    , nightscout: { }
    , maxFailures: br.maxFailures || 3
    , firstFetchCount: br.firstFetchCount || 3
    , dexcomShareHost: hostname
  };
}

function create (env, bus) {

  var bridge = { };

  var opts = options(env);
  var interval = opts.interval;

  // Helps debug Dexcom auth without logging the password (never log password chars — logs leak).
  var br = env.extendedSettings.bridge;
  if (br && br.userName) {
    var plen = String(br.password || '').length;
    console.info('DEXCOM bridge: account (email) =', br.userName, '| password length =', plen, 'chars (if 0, check Nightscout bridge settings / env)');
  }
  if (opts.dexcomShareHost) {
    console.info('DEXCOM bridge: Share API host =', opts.dexcomShareHost, '(Dexcom Share bridge "Server" in site settings, or BRIDGE_SERVER env)');
  }

  mostRecentRecord = new Date().getTime() - opts.fetch.minutes * 60000;

  bridge.startEngine = function startEngine (entries) {


    opts.callback = bridged(entries);

    let last_run = new Date(0).getTime();
    let last_ondemand = new Date(0).getTime();

    function should_run() {
      // Time we expect to have to collect again
      const msRUN_AFTER = (300+20) * 1000;
      const msNow = new Date().getTime();

      const next_entry_expected = mostRecentRecord + msRUN_AFTER;

      if (next_entry_expected > msNow) {
        // we're not due to collect a new slot yet. Use interval
        const ms_since_last_run = msNow - last_run;
        if (ms_since_last_run < interval) {
          return false;
        }

        last_run = msNow;
        last_ondemand = new Date(0).getTime();
        console.log("DEXCOM: Running poll");
        return true;
      }

      const ms_since_last_run = msNow - last_ondemand;

      if (ms_since_last_run < interval) {
        return false;
      }
      last_run = msNow;
      last_ondemand = msNow;
      console.log("DEXCOM: Data due, running extra poll");
      return true;
    }

    var loggedBridgeCredsOnce = false;

    let timer = setInterval(function () {
      if  (!should_run()) return;


      opts.fetch.minutes = parseInt((new Date() - mostRecentRecord) / 60000);
      opts.fetch.maxCount = parseInt((opts.fetch.minutes / 5) + 1);
      opts.firstFetchCount = opts.fetch.maxCount;
      console.log("Fetching Share Data: ", 'minutes', opts.fetch.minutes, 'maxCount', opts.fetch.maxCount);
      if (!loggedBridgeCredsOnce) {
        loggedBridgeCredsOnce = true;
        var login = opts.login || {};
        var host = opts.dexcomShareHost || dexcomShareApiHostFromDefaults();
        console.info('DEXCOM bridge (first poll): accountName =', login.accountName, '| password length =', String(login.password || '').length, '| Share API host =', host || '(unknown)');
      }
      engine(opts);
    }, 1000 /*interval*/);

    if (bus) {
      bus.on('teardown', function serverTeardown () {
        clearInterval(timer);
      });
    }
  };

  return bridge;
}

init.create = create;
init.bridged = bridged;
init.options = options;
exports = module.exports = init;
