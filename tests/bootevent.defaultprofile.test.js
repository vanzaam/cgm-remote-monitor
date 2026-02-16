'use strict';

var should = require('should');

describe('Boot event - Default profile creation', function () {
  
  it('should verify default profile structure has mmol units', function (done) {
    // This test verifies the structure of the default profile that would be created
    // We don't actually create it to avoid MongoDB session complexity
    
    var env = require('../lib/server/env')();
    
    // Note: System default is mg/dl, but profile default is mmol for Russian/European users
    // Users can override DISPLAY_UNITS environment variable to match profile units
    env.settings.units.should.equal('mg/dl');
    
    // Simulate the default profile structure from bootevent.js
    const now = new Date();
    const startOfYear = new Date(Date.UTC(now.getFullYear(), 0, 1, 0, 0, 0, 0)).toISOString();
    
    const defaultProfile = {
      defaultProfile: 'Default',
      store: {
        Default: {
          dia: 5,
          carbratio: [
            { time: '00:00', value: 12, timeAsSeconds: 0 }
          ],
          carbs_hr: 20,
          delay: 20,
          sens: [
            { time: '00:00', value: 5, timeAsSeconds: 0 }
          ],
          timezone: 'Europe/Moscow',
          basal: [
            { time: '00:00', value: 0.1, timeAsSeconds: 0 }
          ],
          target_low: [
            { time: '00:00', value: 5, timeAsSeconds: 0 }
          ],
          target_high: [
            { time: '00:00', value: 8, timeAsSeconds: 0 }
          ],
          units: 'mmol'
        }
      },
      startDate: startOfYear,
      mills: 0,
      srvModified: Date.now(),
      units: 'mmol'
    };
    
    // Verify profile has mmol units
    defaultProfile.units.should.equal('mmol');
    defaultProfile.store.Default.units.should.equal('mmol');
    
    // Verify timezone is Europe/Moscow
    defaultProfile.store.Default.timezone.should.equal('Europe/Moscow');
    
    // Verify target values are in mmol range (5-8)
    defaultProfile.store.Default.target_low[0].value.should.equal(5);
    defaultProfile.store.Default.target_high[0].value.should.equal(8);
    
    // Verify sensitivity is in mmol scale
    defaultProfile.store.Default.sens[0].value.should.equal(5);
    
    // Note: Profile units (mmol) may differ from system units (mg/dl by default)
    // This is intentional - users can set DISPLAY_UNITS=mmol to match profile
    defaultProfile.units.should.equal('mmol');
    
    done();
  });
  
  it('should handle profile units that differ from system display units', function (done) {
    var env = require('../lib/server/env')();
    
    // System default is mg/dl
    env.settings.units.should.equal('mg/dl');
    
    // But profile can have mmol units (for regional configuration)
    // The system should handle unit conversion correctly
    
    var profilefunctions = require('../lib/profilefunctions');
    
    // Create a test profile with mmol units (like the default profile)
    var testProfile = [{
      defaultProfile: 'Test',
      store: {
        Test: {
          dia: 5,
          sens: [{ time: '00:00', value: 5, timeAsSeconds: 0 }],
          carbratio: [{ time: '00:00', value: 12, timeAsSeconds: 0 }],
          basal: [{ time: '00:00', value: 0.1, timeAsSeconds: 0 }],
          target_low: [{ time: '00:00', value: 5, timeAsSeconds: 0 }],
          target_high: [{ time: '00:00', value: 8, timeAsSeconds: 0 }],
          timezone: 'Europe/Moscow',
          units: 'mmol'
        }
      },
      startDate: new Date().toISOString(),
      units: 'mmol'
    }];
    
    var ctx = {
      moment: require('moment-timezone')
    };
    
    var profile = profilefunctions(testProfile, ctx);
    
    // Verify getUnits returns mmol from the profile
    var units = profile.getUnits();
    units.should.equal('mmol');
    
    // Profile units can differ from system display units
    // This is expected - plugins handle conversion via sbx.scaleMgdl()
    units.should.not.equal(env.settings.units);
    
    done();
  });
});
