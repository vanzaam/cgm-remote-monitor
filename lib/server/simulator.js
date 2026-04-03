'use strict';

/**
 * Nightscout Data Simulator
 *
 * Generates realistic CGM, pump, Loop/OpenAPS and treatment data
 * for testing and demo purposes. Injects directly into ctx.ddata
 * and ctx.bus, triggering real alarm processing and push notifications.
 *
 * Enable via: SIMULATOR=true environment variable
 * Or toggle at runtime via: PUT /api/v1/simulator/start
 *
 * Scenarios cycle automatically:
 * 1. Normal range (5-8 mmol / 90-144 mg/dl) — 15 min
 * 2. Rising toward high (8→15 mmol / 144→270 mg/dl) — 15 min
 * 3. High alarm zone (>180 mg/dl) — 5 min (triggers HIGH alarm)
 * 4. Correction bolus treatment — drops back
 * 5. Falling toward low (8→3.5 mmol / 144→63 mg/dl) — 15 min
 * 6. Low alarm zone (<80 mg/dl) — 5 min (triggers LOW alarm)
 * 7. Urgent low (<55 mg/dl) — 3 min (triggers URGENT LOW)
 * 8. Recovery with carbs treatment — back to normal
 * Total cycle: ~60 minutes, then repeats
 */

var crypto = require('crypto');

function init (env, ctx) {

  var simulator = {};
  var running = false;
  var interval = null;
  var cycleStart = 0;
  var TICK_INTERVAL = 5 * 60 * 1000; // 5 minutes (CGM interval)
  var CYCLE_DURATION = 60 * 60 * 1000; // 60 minute cycle

  // Glucose scenario: array of {minuteOffset, sgv_mgdl, direction}
  // Designed to trigger all alarm levels during one cycle
  var SCENARIO = [
    // Normal range (0-15 min)
    { t: 0,  sgv: 110, dir: 'Flat' },
    { t: 5,  sgv: 115, dir: 'Flat' },
    { t: 10, sgv: 120, dir: 'FortyFiveUp' },
    // Rising (15-30 min)
    { t: 15, sgv: 140, dir: 'FortyFiveUp' },
    { t: 20, sgv: 170, dir: 'SingleUp' },
    { t: 25, sgv: 200, dir: 'SingleUp' },
    // HIGH alarm zone (30-40 min)
    { t: 30, sgv: 230, dir: 'FortyFiveUp' },
    { t: 35, sgv: 265, dir: 'Flat' },         // > bgHigh (260) → URGENT HIGH
    // Correction — insulin bolus treatment injected at t=37
    { t: 40, sgv: 240, dir: 'FortyFiveDown' },
    // Dropping (40-50 min)
    { t: 45, sgv: 180, dir: 'SingleDown' },
    { t: 50, sgv: 120, dir: 'SingleDown' },
    // LOW alarm zone (50-55 min)
    { t: 52, sgv: 75,  dir: 'SingleDown' },    // < bgTargetBottom (80) → LOW
    { t: 55, sgv: 50,  dir: 'SingleDown' },    // < bgLow (55) → URGENT LOW
    // Recovery — carb treatment injected at t=56
    { t: 57, sgv: 55,  dir: 'Flat' },
    { t: 60, sgv: 80,  dir: 'FortyFiveUp' }    // cycle restarts
  ];

  // Treatments injected at specific points
  var TREATMENT_EVENTS = [
    { t: 37, treatment: { eventType: 'Correction Bolus', insulin: 2.5, notes: '[Simulator] Correction for high BG' } },
    { t: 56, treatment: { eventType: 'Carb Correction', carbs: 15, notes: '[Simulator] Fast carbs for low BG' } }
  ];

  // Device status template (Loop-like)
  function makeDeviceStatus (sgv, timestamp) {
    return {
      created_at: new Date(timestamp).toISOString(),
      mills: timestamp,
      device: 'simulator',
      pump: {
        battery: { percent: 75 + Math.round(Math.random() * 20) },
        reservoir: 80 + Math.round(Math.random() * 40),
        status: { status: 'normal', timestamp: new Date(timestamp).toISOString() }
      },
      uploader: {
        battery: 50 + Math.round(Math.random() * 45)
      },
      loop: {
        timestamp: new Date(timestamp).toISOString(),
        iob: { iob: Math.round(Math.random() * 30) / 10, timestamp: new Date(timestamp).toISOString() },
        cob: { cob: Math.round(Math.random() * 20), timestamp: new Date(timestamp).toISOString() },
        predicted: {
          values: generatePrediction(sgv, 12)
        }
      }
    };
  }

  function generatePrediction (currentSgv, points) {
    var vals = [];
    var sgv = currentSgv;
    for (var i = 0; i < points; i++) {
      sgv += (Math.random() - 0.5) * 10;
      sgv = Math.max(40, Math.min(400, sgv));
      vals.push(Math.round(sgv));
    }
    return vals;
  }

  function interpolateSGV (minuteInCycle) {
    // Find surrounding scenario points
    var prev = SCENARIO[0];
    var next = SCENARIO[SCENARIO.length - 1];

    for (var i = 0; i < SCENARIO.length - 1; i++) {
      if (minuteInCycle >= SCENARIO[i].t && minuteInCycle < SCENARIO[i + 1].t) {
        prev = SCENARIO[i];
        next = SCENARIO[i + 1];
        break;
      }
    }

    // Linear interpolation
    var range = next.t - prev.t;
    var progress = range > 0 ? (minuteInCycle - prev.t) / range : 0;
    var sgv = Math.round(prev.sgv + (next.sgv - prev.sgv) * progress);

    // Add small noise
    sgv += Math.round((Math.random() - 0.5) * 6);
    sgv = Math.max(30, Math.min(400, sgv));

    return { sgv: sgv, direction: prev.dir };
  }

  function generateEntry (timestamp, minuteInCycle) {
    var data = interpolateSGV(minuteInCycle);
    return {
      _id: crypto.randomBytes(12).toString('hex'),
      type: 'sgv',
      sgv: data.sgv,
      direction: data.direction,
      device: 'simulator',
      date: timestamp,
      dateString: new Date(timestamp).toISOString(),
      sysTime: new Date(timestamp).toISOString(),
      mills: timestamp,
      noise: 1,
      filtered: data.sgv * 1000,
      unfiltered: data.sgv * 1000
    };
  }

  function tick () {
    if (!running) return;

    var now = Date.now();
    var minuteInCycle = ((now - cycleStart) / 60000) % 60;

    // Generate SGV entry
    var entry = generateEntry(now, minuteInCycle);
    console.log('[Simulator] SGV:', entry.sgv, 'mg/dl (' + Math.round(entry.sgv / 18 * 10) / 10 + ' mmol/L)', entry.direction, 'at minute', Math.round(minuteInCycle));

    // Write through the proper storage API (entries.create) if available
    // This ensures data goes into memory-store/MongoDB AND triggers data-received
    if (ctx.entries && ctx.entries.create) {
      ctx.entries.create([entry], function () {});
    } else {
      // Fallback: inject directly into ctx.ddata
      if (ctx.ddata) {
        ctx.ddata.processRawDataForRuntime([entry]);
        ctx.ddata.sgvs.unshift(entry);
        var cutoff = now - 48 * 60 * 60 * 1000;
        ctx.ddata.sgvs = ctx.ddata.sgvs.filter(function (e) { return e.mills > cutoff; });
      }
      if (ctx.diskBuffer) ctx.diskBuffer.append('entries', entry);
      if (ctx.bus) {
        ctx.bus.emit('data-update', { type: 'entries', op: 'update', changes: [entry] });
        ctx.bus.emit('data-received');
      }
    }

    // Device status — write through storage API
    var ds = makeDeviceStatus(entry.sgv, now);
    if (ctx.devicestatus && ctx.devicestatus.create) {
      ctx.devicestatus.create([ds], function () {});
    } else {
      if (ctx.ddata) {
        ctx.ddata.processRawDataForRuntime([ds]);
        ctx.ddata.devicestatus.unshift(ds);
      }
      if (ctx.diskBuffer) ctx.diskBuffer.append('devicestatus', ds);
    }

    // Check for treatment events at this point in cycle
    var minuteRounded = Math.round(minuteInCycle);
    TREATMENT_EVENTS.forEach(function (te) {
      if (Math.abs(minuteRounded - te.t) < 3 && !te._fired) {
        te._fired = true;
        var treatment = Object.assign({}, te.treatment, {
          _id: crypto.randomBytes(12).toString('hex'),
          created_at: new Date(now).toISOString(),
          mills: now
        });
        console.log('[Simulator] Treatment:', treatment.eventType, treatment.insulin ? treatment.insulin + 'U' : '', treatment.carbs ? treatment.carbs + 'g' : '');

        // Write through storage API
        if (ctx.treatments && ctx.treatments.create) {
          ctx.treatments.create(treatment, function () {});
        } else {
          if (ctx.ddata) {
            ctx.ddata.processRawDataForRuntime([treatment]);
            ctx.ddata.treatments.unshift(treatment);
          }
          if (ctx.diskBuffer) ctx.diskBuffer.append('treatments', treatment);
        }

        setTimeout(function () { te._fired = false; }, 5 * 60 * 1000);
      }
    });
  }

  /**
   * Start the simulator.
   */
  simulator.start = function start () {
    if (running) return;
    running = true;
    cycleStart = Date.now();
    console.log('[Simulator] Started — cycle: normal → high alarm → correction → low alarm → urgent low → recovery (60 min)');

    // Generate immediate first reading
    tick();

    // Then every 5 minutes
    interval = setInterval(tick, TICK_INTERVAL);
  };

  /**
   * Stop the simulator.
   */
  simulator.stop = function stop () {
    if (!running) return;
    running = false;
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    console.log('[Simulator] Stopped');
  };

  /**
   * Check if simulator is running.
   */
  simulator.isRunning = function isRunning () {
    return running;
  };

  /**
   * Get simulator status.
   */
  simulator.status = function status () {
    var minuteInCycle = running ? ((Date.now() - cycleStart) / 60000) % 60 : 0;
    var phase = 'stopped';
    if (running) {
      if (minuteInCycle < 15) phase = 'normal';
      else if (minuteInCycle < 30) phase = 'rising';
      else if (minuteInCycle < 40) phase = 'high-alarm';
      else if (minuteInCycle < 50) phase = 'falling';
      else if (minuteInCycle < 57) phase = 'low-alarm';
      else phase = 'recovery';
    }
    return {
      running: running,
      phase: phase,
      minuteInCycle: Math.round(minuteInCycle),
      cycleMinutes: 60
    };
  };

  // Auto-start if SIMULATOR env var is set
  if (process.env.SIMULATOR === 'true' || process.env.SIMULATOR === '1') {
    // Delay start to let boot complete
    setTimeout(function () {
      simulator.start();
    }, 5000);
  }

  return simulator;
}

module.exports = init;
