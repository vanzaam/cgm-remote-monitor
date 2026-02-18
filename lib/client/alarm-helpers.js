'use strict';

function isAlarmForHigh (notify) {
  return notify && (
    notify.eventName === 'high'
    || (notify.title && /\bHIGH\b/i.test(notify.title))
  );
}

function isAlarmForLow (notify) {
  return notify && (
    notify.eventName === 'low'
    || (notify.title && /\bLOW\b/i.test(notify.title))
  );
}

function isLegacyDefaultGroup (group) {
  return group === null || group === undefined || group === 'default';
}

function isWarningAlarmEnabledForSettings (settings, notify) {
  var group = notify && notify.group;

  if (group === 'Glucose High') {
    return settings.alarmHigh;
  }
  if (group === 'Glucose Low') {
    return settings.alarmLow;
  }
  if (isLegacyDefaultGroup(group)) {
    if (isAlarmForHigh(notify)) {
      return settings.alarmHigh;
    }
    if (isAlarmForLow(notify)) {
      return settings.alarmLow;
    }
    // Legacy default-group behavior for plugins with non-high/low event names.
    return settings.alarmHigh || settings.alarmLow;
  }

  // Preserve legacy coupling for non-glucose groups to avoid behavior changes.
  return settings.alarmHigh || settings.alarmLow;
}

function isUrgentAlarmEnabledForSettings (settings, notify) {
  var group = notify && notify.group;

  if (group === 'Glucose Urgent High') {
    return settings.alarmUrgentHigh;
  }
  if (group === 'Glucose Urgent Low') {
    return settings.alarmUrgentLow;
  }
  if (isLegacyDefaultGroup(group)) {
    if (isAlarmForHigh(notify)) {
      return settings.alarmUrgentHigh;
    }
    if (isAlarmForLow(notify)) {
      return settings.alarmUrgentLow;
    }
    // Legacy default-group behavior for plugins with non-high/low event names.
    return settings.alarmUrgentHigh || settings.alarmUrgentLow;
  }

  // Preserve legacy coupling for non-glucose groups to avoid behavior changes.
  return settings.alarmUrgentHigh || settings.alarmUrgentLow;
}

module.exports = {
  isAlarmForHigh: isAlarmForHigh,
  isAlarmForLow: isAlarmForLow,
  isWarningAlarmEnabledForSettings: isWarningAlarmEnabledForSettings,
  isUrgentAlarmEnabledForSettings: isUrgentAlarmEnabledForSettings
};
