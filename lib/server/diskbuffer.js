'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');

/**
 * Disk buffer for Nightscout — Write-Ahead Log (WAL).
 *
 * When MongoDB is unavailable, incoming data (SGV entries, treatments,
 * device status) is appended to a JSON Lines file on disk. When MongoDB
 * recovers, buffered data is flushed to the database.
 *
 * This ensures zero data loss during MongoDB outages.
 *
 * File format: one JSON object per line (JSON Lines / NDJSON)
 * Each line: {"collection":"entries","doc":{...},"timestamp":1234567890}
 */

var BUFFER_DIR = process.env.NIGHTSCOUT_BUFFER_DIR || path.join(os.tmpdir(), 'nightscout-buffer');
var MAX_BUFFER_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours retention
var MAX_BUFFER_SIZE_MB = 50; // 50 MB max buffer file size (~250K entries)
var FLUSH_BATCH_SIZE = 500;

function init (env, ctx) {

  var diskBuffer = {};
  // Use hostname as subdirectory for multi-tenant isolation
  var tenantHostname = env && env.HOSTNAME ? env.HOSTNAME.replace(/[^a-zA-Z0-9._-]/g, '_') : '';
  var bufferDir = tenantHostname ? path.join(BUFFER_DIR, tenantHostname) : BUFFER_DIR;
  var bufferFile = path.join(bufferDir, 'wal.jsonl');
  var flushInProgress = false;
  var bufferedCount = 0;

  /**
   * Save a JSON object to a named cache file on disk.
   * Used for VAPID keys, push subscriptions, profile, etc.
   * These files survive process restarts and MongoDB outages.
   */
  diskBuffer.cacheWrite = function cacheWrite (name, data) {
    try {
      var cacheFile = path.join(bufferDir, name + '.json');
      fs.writeFileSync(cacheFile, JSON.stringify(data), 'utf8');
    } catch (e) {
      console.warn('Disk cache: failed to write', name, ':', e.message);
    }
  };

  /**
   * Read a cached JSON object from disk.
   * Returns null if file doesn't exist or is corrupt.
   */
  diskBuffer.cacheRead = function cacheRead (name) {
    try {
      var cacheFile = path.join(bufferDir, name + '.json');
      if (!fs.existsSync(cacheFile)) return null;
      var content = fs.readFileSync(cacheFile, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      console.warn('Disk cache: failed to read', name, ':', e.message);
      return null;
    }
  };

  // Ensure buffer directory exists
  try {
    fs.mkdirSync(bufferDir, { recursive: true });
  } catch (e) {
    console.warn('Disk buffer: failed to create directory', bufferDir, e.message);
  }

  /**
   * Append a document to the disk buffer.
   * Called when MongoDB write fails.
   */
  diskBuffer.append = function append (collection, doc) {
    try {
      var line = JSON.stringify({
        collection: collection,
        doc: doc,
        timestamp: Date.now()
      }) + '\n';

      fs.appendFileSync(bufferFile, line, 'utf8');
      bufferedCount++;

      if (bufferedCount === 1) {
        console.log('Disk buffer: started buffering to', bufferFile);
      }
      if (bufferedCount % 100 === 0) {
        console.log('Disk buffer:', bufferedCount, 'documents buffered');
      }
    } catch (e) {
      console.error('Disk buffer: CRITICAL — failed to write to disk:', e.message);
    }
  };

  /**
   * Check if there are buffered documents waiting to be flushed.
   */
  diskBuffer.hasData = function hasData () {
    try {
      return fs.existsSync(bufferFile) && fs.statSync(bufferFile).size > 0;
    } catch (e) {
      return false;
    }
  };

  /**
   * Get count of buffered documents.
   */
  diskBuffer.count = function count () {
    if (!diskBuffer.hasData()) return 0;
    try {
      var content = fs.readFileSync(bufferFile, 'utf8');
      return content.split('\n').filter(function (line) { return line.trim().length > 0; }).length;
    } catch (e) {
      return 0;
    }
  };

  /**
   * Flush buffered documents to MongoDB.
   * Called when MongoDB connection recovers.
   * Processes in batches to avoid overwhelming MongoDB.
   */
  diskBuffer.flush = function flush (callback) {
    if (flushInProgress) {
      return callback ? callback(null, 0) : undefined;
    }
    if (!diskBuffer.hasData()) {
      return callback ? callback(null, 0) : undefined;
    }
    if (!ctx.store || !ctx.store.collection) {
      return callback ? callback(new Error('No database connection')) : undefined;
    }

    flushInProgress = true;
    var totalFlushed = 0;

    console.log('Disk buffer: starting flush to MongoDB...');

    try {
      var content = fs.readFileSync(bufferFile, 'utf8');
      var lines = content.split('\n').filter(function (line) { return line.trim().length > 0; });

      if (lines.length === 0) {
        flushInProgress = false;
        return callback ? callback(null, 0) : undefined;
      }

      console.log('Disk buffer: flushing', lines.length, 'documents');

      // Group by collection for batch inserts
      var byCollection = {};
      lines.forEach(function (line) {
        try {
          var entry = JSON.parse(line);
          var col = entry.collection;
          if (!byCollection[col]) byCollection[col] = [];
          byCollection[col].push(entry.doc);
        } catch (e) {
          console.warn('Disk buffer: skipping malformed line');
        }
      });

      var collections = Object.keys(byCollection);
      var remaining = collections.length;

      if (remaining === 0) {
        clearBuffer();
        flushInProgress = false;
        return callback ? callback(null, 0) : undefined;
      }

      collections.forEach(function (colName) {
        var docs = byCollection[colName];
        var col = ctx.store.collection(colName);

        // Use insertMany with ordered:false to continue on duplicates
        col.insertMany(docs, { ordered: false })
          .then(function (result) {
            totalFlushed += result.insertedCount || docs.length;
            remaining--;
            if (remaining === 0) finishFlush();
          })
          .catch(function (err) {
            // BulkWriteError with some duplicates is OK
            if (err.insertedCount) {
              totalFlushed += err.insertedCount;
            }
            remaining--;
            if (remaining === 0) finishFlush();
          });
      });

      function finishFlush () {
        clearBuffer();
        flushInProgress = false;
        bufferedCount = 0;
        console.log('Disk buffer: flushed', totalFlushed, 'documents to MongoDB');

        // Trigger data reload so in-memory cache picks up flushed data
        if (ctx.bus) {
          ctx.bus.emit('data-received');
        }

        if (callback) callback(null, totalFlushed);
      }
    } catch (e) {
      flushInProgress = false;
      console.error('Disk buffer: flush failed:', e.message);
      if (callback) callback(e);
    }
  };

  /**
   * Clear the buffer file after successful flush.
   */
  function clearBuffer () {
    try {
      fs.writeFileSync(bufferFile, '', 'utf8');
    } catch (e) {
      console.warn('Disk buffer: failed to clear buffer file:', e.message);
    }
  }

  /**
   * Remove entries older than 24 hours from the buffer file.
   * Also enforces max file size.
   */
  diskBuffer.trim = function trim () {
    if (!diskBuffer.hasData()) return;

    try {
      var stat = fs.statSync(bufferFile);

      // Check file size
      if (stat.size > MAX_BUFFER_SIZE_MB * 1024 * 1024) {
        console.warn('Disk buffer: file exceeds', MAX_BUFFER_SIZE_MB, 'MB, trimming old entries');
      }

      var content = fs.readFileSync(bufferFile, 'utf8');
      var lines = content.split('\n').filter(function (line) { return line.trim().length > 0; });
      var cutoff = Date.now() - MAX_BUFFER_AGE_MS;
      var kept = [];

      lines.forEach(function (line) {
        try {
          var entry = JSON.parse(line);
          if (entry.timestamp && entry.timestamp >= cutoff) {
            kept.push(line);
          }
        } catch (e) {
          // Keep unparseable lines (don't lose data)
          kept.push(line);
        }
      });

      var removed = lines.length - kept.length;
      if (removed > 0) {
        fs.writeFileSync(bufferFile, kept.join('\n') + (kept.length > 0 ? '\n' : ''), 'utf8');
        console.log('Disk buffer: trimmed', removed, 'entries older than 24h,', kept.length, 'remaining');
      }
    } catch (e) {
      console.warn('Disk buffer: trim failed:', e.message);
    }
  };

  /**
   * Get buffer status for monitoring.
   */
  diskBuffer.status = function status () {
    try {
      if (!fs.existsSync(bufferFile)) {
        return { active: false, count: 0, sizeBytes: 0, path: bufferFile };
      }
      var stat = fs.statSync(bufferFile);
      return {
        active: stat.size > 0,
        count: diskBuffer.count(),
        sizeBytes: stat.size,
        sizeMB: Math.round(stat.size / 1024 / 1024 * 100) / 100,
        path: bufferFile,
        maxAgeMins: Math.round(MAX_BUFFER_AGE_MS / 60000),
        maxSizeMB: MAX_BUFFER_SIZE_MB
      };
    } catch (e) {
      return { active: false, error: e.message, path: bufferFile };
    }
  };

  /**
   * Get buffer file path (for monitoring/debugging).
   */
  diskBuffer.getBufferPath = function getBufferPath () {
    return bufferFile;
  };

  // Trim old data on init (in case process restarted with stale buffer)
  diskBuffer.trim();

  return diskBuffer;
}

module.exports = init;
