'use strict';

/**
 * Ring buffer logger for tenant-scoped log capture.
 * Captures console output and stores last N lines per tenant.
 */
function TenantLog (maxLines) {
  this.maxLines = maxLines || 500;
  this.lines = [];
}

TenantLog.prototype.push = function push (level, args) {
  var msg = Array.prototype.slice.call(args).map(function (a) {
    if (a === null) return 'null';
    if (a === undefined) return 'undefined';
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }
    return String(a);
  }).join(' ');

  this.lines.push({
    t: Date.now(),
    l: level,
    m: msg
  });

  if (this.lines.length > this.maxLines) {
    this.lines.splice(0, this.lines.length - this.maxLines);
  }
};

TenantLog.prototype.getLines = function getLines (since, limit) {
  var result = this.lines;
  if (since) {
    result = result.filter(function (line) { return line.t > since; });
  }
  if (limit) {
    result = result.slice(-limit);
  }
  return result;
};

TenantLog.prototype.clear = function clear () {
  this.lines = [];
};

/**
 * Wrap a tenant's boot process to capture its console output.
 * Returns patched console-like object for the tenant.
 */
TenantLog.prototype.wrapConsole = function wrapConsole (hostname) {
  var self = this;
  var prefix = '[' + hostname + '] ';
  var origLog = console.log;
  var origError = console.error;
  var origWarn = console.warn;
  var origInfo = console.info;

  return {
    install: function () {
      // We don't replace global console — instead we hook into ctx.bus events
      // and provide a capture function
    },
    capture: function (level, args) {
      self.push(level, args);
    },
    log: function () {
      self.push('info', arguments);
      origLog.apply(console, [prefix].concat(Array.prototype.slice.call(arguments)));
    },
    error: function () {
      self.push('error', arguments);
      origError.apply(console, [prefix].concat(Array.prototype.slice.call(arguments)));
    },
    warn: function () {
      self.push('warn', arguments);
      origWarn.apply(console, [prefix].concat(Array.prototype.slice.call(arguments)));
    },
    info: function () {
      self.push('info', arguments);
      origInfo.apply(console, [prefix].concat(Array.prototype.slice.call(arguments)));
    }
  };
};

module.exports = TenantLog;
