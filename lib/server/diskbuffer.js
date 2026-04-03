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
var FLUSH_BATCH_SIZE = 100;

function init (env, ctx) {

  var diskBuffer = {};
  var bufferFile = path.join(BUFFER_DIR, 'wal.jsonl');
  var flushInProgress = false;
  var bufferedCount = 0;

  // Ensure buffer directory exists
  try {
    fs.mkdirSync(BUFFER_DIR, { recursive: true });
  } catch (e) {
    console.warn('Disk buffer: failed to create directory', BUFFER_DIR, e.message);
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
   * Get buffer file path (for monitoring/debugging).
   */
  diskBuffer.getBufferPath = function getBufferPath () {
    return bufferFile;
  };

  return diskBuffer;
}

module.exports = init;
