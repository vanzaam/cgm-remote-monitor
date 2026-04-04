#!/usr/bin/env node
'use strict';

/**
 * Generates tenants.local.generated.json for multi-tenant load / dev.
 *
 * Usage:
 *   node deploy/multi-tenant/generate-tenants-config.js [count] [outfile]
 *   MONGO_HOST=127.0.0.1:27017 node deploy/multi-tenant/generate-tenants-config.js 100
 *
 * Each tenant: hostname ns{i}.local, DB mongodb://HOST/ns{i}_nightscout
 * Browser needs Host header or /etc/hosts — see deploy/multi-tenant/hosts-snippet.txt
 */

var fs = require('fs');
var path = require('path');

var count = parseInt(process.argv[2], 10) || 100;
if (count < 1 || count > 5000) {
  console.error('count must be 1..5000');
  process.exit(1);
}

var outPath = process.argv[3] || path.join(__dirname, '..', '..', 'tenants.local.generated.json');
var mongoHost = process.env.MONGO_HOST || '127.0.0.1:27017';

var baseEnable = 'careportal basal rawbg iob cob pump openaps loop devicestatus treatmentnotify';

var tenants = [];
for (var i = 1; i <= count; i++) {
  tenants.push({
    hostname: 'ns' + i + '.local',
    mongoUri: 'mongodb://' + mongoHost + '/ns' + i + '_nightscout',
    settings: {
      API_SECRET: 'change_me_ns' + i + '_secret_min_12_chars_long',
      INSECURE_USE_HTTP: 'true',
      ENABLE: baseEnable,
      DISPLAY_UNITS: 'mg/dl',
      THEME: 'colors',
      ALARM_TIMEAGO_URGENT: '60',
      ALARM_TIMEAGO_WARN: '30'
    }
  });
}

fs.writeFileSync(outPath, JSON.stringify({ tenants: tenants }, null, 2));
console.log('Wrote', tenants.length, 'tenant(s) to', path.resolve(outPath));
console.log('Mongo URI pattern: mongodb://' + mongoHost + '/ns{N}_nightscout');
