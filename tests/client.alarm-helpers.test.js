var should = require('should');
var alarmHelpers = require('../lib/client/alarm-helpers');

describe('client alarm helpers', function () {
  var settings;

  beforeEach(function () {
    settings = {
      alarmHigh: true,
      alarmLow: false,
      alarmUrgentHigh: true,
      alarmUrgentLow: false
    };
  });

  it('enables legacy default warning alarms when eventName identifies high', function () {
    var notify = {
      group: 'default',
      eventName: 'high',
      title: 'Warning HIGH'
    };

    alarmHelpers.isWarningAlarmEnabledForSettings(settings, notify).should.equal(true);
  });

  it('disables legacy default warning alarms when high is disabled', function () {
    settings.alarmHigh = false;

    var notify = {
      group: 'default',
      eventName: 'high',
      title: 'Warning HIGH'
    };

    alarmHelpers.isWarningAlarmEnabledForSettings(settings, notify).should.equal(false);
  });

  it('uses legacy fallback for default warning alarms when type is unrecognized', function () {
    var notify = {
      group: 'default',
      eventName: 'rapid',
      title: 'Watch trend'
    };

    alarmHelpers.isWarningAlarmEnabledForSettings(settings, notify).should.equal(true);
  });

  it('disables legacy default warning alarms when type is unrecognized and warning alarms are off', function () {
    settings.alarmHigh = false;
    settings.alarmLow = false;

    var notify = {
      group: 'default',
      eventName: 'rapid',
      title: 'Watch trend'
    };

    alarmHelpers.isWarningAlarmEnabledForSettings(settings, notify).should.equal(false);
  });

  it('uses legacy fallback for default urgent alarms when type is unrecognized', function () {
    var notify = {
      group: 'default',
      eventName: 'rapid',
      title: 'Watch trend'
    };

    alarmHelpers.isUrgentAlarmEnabledForSettings(settings, notify).should.equal(true);
  });

  it('disables legacy default urgent alarms when type is unrecognized and urgent alarms are off', function () {
    settings.alarmUrgentHigh = false;
    settings.alarmUrgentLow = false;

    var notify = {
      group: 'default',
      eventName: 'rapid',
      title: 'Watch trend'
    };

    alarmHelpers.isUrgentAlarmEnabledForSettings(settings, notify).should.equal(false);
  });

  it('enables warning for Glucose High group based on alarmHigh setting', function () {
    alarmHelpers.isWarningAlarmEnabledForSettings(settings, { group: 'Glucose High' }).should.equal(true);

    settings.alarmHigh = false;
    alarmHelpers.isWarningAlarmEnabledForSettings(settings, { group: 'Glucose High' }).should.equal(false);
  });

  it('enables warning for Glucose Low group based on alarmLow setting', function () {
    alarmHelpers.isWarningAlarmEnabledForSettings(settings, { group: 'Glucose Low' }).should.equal(false);

    settings.alarmLow = true;
    alarmHelpers.isWarningAlarmEnabledForSettings(settings, { group: 'Glucose Low' }).should.equal(true);
  });

  it('enables urgent for Glucose Urgent High group based on alarmUrgentHigh setting', function () {
    alarmHelpers.isUrgentAlarmEnabledForSettings(settings, { group: 'Glucose Urgent High' }).should.equal(true);

    settings.alarmUrgentHigh = false;
    alarmHelpers.isUrgentAlarmEnabledForSettings(settings, { group: 'Glucose Urgent High' }).should.equal(false);
  });

  it('enables urgent for Glucose Urgent Low group based on alarmUrgentLow setting', function () {
    alarmHelpers.isUrgentAlarmEnabledForSettings(settings, { group: 'Glucose Urgent Low' }).should.equal(false);

    settings.alarmUrgentLow = true;
    alarmHelpers.isUrgentAlarmEnabledForSettings(settings, { group: 'Glucose Urgent Low' }).should.equal(true);
  });
});
