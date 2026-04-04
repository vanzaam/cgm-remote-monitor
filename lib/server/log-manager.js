'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');

/**
 * Nightscout Log Manager
 *
 * Replaces global console.log/info/warn/error with a logger that:
 * - Prefixes each line with tenant hostname (multi-tenant)
 * - Writes to rotating log files (max 48h / configurable)
 * - Limits total log size per tenant
 * - Provides per-tenant log isolation
 *
 * In single-tenant mode: writes to one log file.
 * In multi-tenant mode: each tenant gets its own log directory.
 */

var LOG_DIR = process.env.NIGHTSCOUT_LOG_DIR || path.join(
  process.env.NIGHTSCOUT_BUFFER_DIR || path.join(os.tmpdir(), 'nightscout-buffer'),
  'logs'
);
var MAX_LOG_AGE_HOURS = parseInt(process.env.NIGHTSCOUT_LOG_HOURS || '48', 10);
var MAX_LOG_SIZE_MB = parseInt(process.env.NIGHTSCOUT_LOG_MAX_MB || '50', 10);
var ROTATE_CHECK_INTERVAL = 60 * 60 * 1000; // Check every hour

// Keep reference to original console methods
var _origLog = console.log.bind(console);
var _origInfo = console.info.bind(console);
var _origWarn = console.warn.bind(console);
var _origError = console.error.bind(console);

/**
 * Create a logger for a specific tenant (or global).
 */
function createLogger (hostname) {
  var logger = {};
  var logDir = hostname ? path.join(LOG_DIR, hostname.replace(/[^a-zA-Z0-9._-]/g, '_')) : LOG_DIR;
  var currentStream = null;
  var currentDate = null;
  var prefix = hostname ? '[' + hostname + '] ' : '';

  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (e) { /* ignore */ }

  function getDateStr () {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function getTimeStr () {
    var d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0') + ':' +
      String(d.getSeconds()).padStart(2, '0');
  }

  function getStream () {
    var dateStr = getDateStr();
    if (currentDate !== dateStr || !currentStream) {
      if (currentStream) {
        try { currentStream.end(); } catch (e) { /* ignore */ }
      }
      currentDate = dateStr;
      var logFile = path.join(logDir, dateStr + '.log');
      currentStream = fs.createWriteStream(logFile, { flags: 'a' });
      currentStream.on('error', function () { currentStream = null; });
    }
    return currentStream;
  }

  function writeLog (level, args) {
    var line = getTimeStr() + ' ' + level + ' ' + prefix +
      Array.prototype.map.call(args, function (a) {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }).join(' ') + '\n';

    var stream = getStream();
    if (stream) {
      stream.write(line);
    }
  }

  logger.log = function () {
    writeLog('LOG', arguments);
    _origLog.apply(null, [prefix].concat(Array.prototype.slice.call(arguments)));
  };

  logger.info = function () {
    writeLog('INF', arguments);
    _origInfo.apply(null, [prefix].concat(Array.prototype.slice.call(arguments)));
  };

  logger.warn = function () {
    writeLog('WRN', arguments);
    _origWarn.apply(null, [prefix].concat(Array.prototype.slice.call(arguments)));
  };

  logger.error = function () {
    writeLog('ERR', arguments);
    _origError.apply(null, [prefix].concat(Array.prototype.slice.call(arguments)));
  };

  logger.debug = _origLog; // debug = stdout only, no file

  /**
   * Write one line to the rotating log file only (no stdout). Used by multi-tenant
   * console interceptor so tagged [hostname] lines land in the tenant's log file.
   */
  logger.appendFileOnly = function appendFileOnly (level, argsArr) {
    var levelCode = 'INF';
    if (level === 'error') levelCode = 'ERR';
    else if (level === 'warn') levelCode = 'WRN';
    else if (level === 'info' || level === 'log') levelCode = 'INF';
    writeLog(levelCode, argsArr || []);
  };

  /**
   * Close the current log stream.
   */
  logger.close = function () {
    if (currentStream) {
      try { currentStream.end(); } catch (e) { /* ignore */ }
      currentStream = null;
    }
  };

  /**
   * Rotate logs: remove files older than MAX_LOG_AGE_HOURS.
   */
  logger.rotate = function () {
    try {
      var files = fs.readdirSync(logDir);
      var cutoff = Date.now() - MAX_LOG_AGE_HOURS * 60 * 60 * 1000;
      var totalSize = 0;
      var fileInfos = [];

      files.forEach(function (f) {
        if (!f.endsWith('.log')) return;
        var filePath = path.join(logDir, f);
        try {
          var stat = fs.statSync(filePath);
          totalSize += stat.size;
          fileInfos.push({ name: f, path: filePath, mtime: stat.mtimeMs, size: stat.size });
        } catch (e) { /* ignore */ }
      });

      // Remove by age
      var removed = 0;
      fileInfos.forEach(function (fi) {
        if (fi.mtime < cutoff) {
          try { fs.unlinkSync(fi.path); removed++; totalSize -= fi.size; } catch (e) { /* ignore */ }
        }
      });

      // Remove oldest if total size exceeds limit
      if (totalSize > MAX_LOG_SIZE_MB * 1024 * 1024) {
        fileInfos.sort(function (a, b) { return a.mtime - b.mtime; });
        for (var i = 0; i < fileInfos.length && totalSize > MAX_LOG_SIZE_MB * 1024 * 1024; i++) {
          try {
            fs.unlinkSync(fileInfos[i].path);
            totalSize -= fileInfos[i].size;
            removed++;
          } catch (e) { /* ignore */ }
        }
      }

      if (removed > 0) {
        _origLog(prefix + 'Log rotation: removed', removed, 'old log file(s)');
      }
    } catch (e) {
      _origWarn(prefix + 'Log rotation failed:', e.message);
    }
  };

  return logger;
}

/**
 * Install the global log manager — replaces console.log/info/warn/error.
 * Call once at startup.
 */
function installGlobal () {
  var globalLogger = createLogger(null);

  console.log = globalLogger.log;
  console.info = globalLogger.info;
  console.warn = globalLogger.warn;
  console.error = globalLogger.error;

  // Rotate on startup and every hour
  globalLogger.rotate();
  setInterval(function () { globalLogger.rotate(); }, ROTATE_CHECK_INTERVAL);

  _origLog('Log manager installed: dir=' + LOG_DIR + ' maxAge=' + MAX_LOG_AGE_HOURS + 'h maxSize=' + MAX_LOG_SIZE_MB + 'MB');

  return globalLogger;
}

/**
 * Create a per-tenant logger that prefixes all output with hostname.
 * Also writes to per-tenant log files.
 */
function forTenant (hostname) {
  var tenantLogger = createLogger(hostname);

  // Start rotation timer for this tenant
  tenantLogger.rotate();
  var rotateTimer = setInterval(function () { tenantLogger.rotate(); }, ROTATE_CHECK_INTERVAL);

  tenantLogger.stopRotation = function () {
    clearInterval(rotateTimer);
  };

  return tenantLogger;
}

module.exports = {
  install: installGlobal,
  forTenant: forTenant,
  createLogger: createLogger
};
