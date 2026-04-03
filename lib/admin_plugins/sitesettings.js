'use strict';

function init (ctx) {

  // mg/dl ↔ mmol conversion
  var MMOL_FACTOR = 18.0;
  function mgToMmol (mg) { return Math.round(mg / MMOL_FACTOR * 10) / 10; }
  function mmolToMg (mmol) { return Math.round(mmol * MMOL_FACTOR); }

  var PLUGIN_GROUPS = {
    'Closed Loop Systems': [
      { name: 'loop', label: 'Loop', forecast: true },
      { name: 'openaps', label: 'OpenAPS', forecast: true },
      { name: 'override', label: 'Override' },
      { name: 'pump', label: 'Pump Status' },
      { name: 'xdripjs', label: 'xDrip.js' }
    ],
    'Treatment & Calculations': [
      { name: 'iob', label: 'Insulin-on-Board (IOB)' },
      { name: 'cob', label: 'Carbs-on-Board (COB)' },
      { name: 'bwp', label: 'Bolus Wizard Preview (BWP)' },
      { name: 'boluscalc', label: 'Bolus Calculator' }
    ],
    'Consumable Ages': [
      { name: 'cage', label: 'Cannula Age (CAGE)' },
      { name: 'sage', label: 'Sensor Age (SAGE)' },
      { name: 'iage', label: 'Insulin Age (IAGE)' },
      { name: 'bage', label: 'Battery Age (BAGE)' }
    ],
    'Data Sources': [
      { name: 'bridge', label: 'Dexcom Share Bridge' }
    ],
    'Notifications': [
      { name: 'speech', label: 'Speech' },
      { name: 'pushover', label: 'Pushover', needsTreatmentNotify: true },
      { name: 'maker', label: 'IFTTT Maker', needsTreatmentNotify: true }
    ],
    'Other': [
      { name: 'rawbg', label: 'Raw BG' },
      { name: 'cors', label: 'CORS' }
    ]
  };

  var ALWAYS_ENABLED = ['bgnow', 'delta', 'direction', 'timeago', 'devicestatus', 'upbat', 'errorcodes', 'profile', 'bolus', 'dbsize', 'runtimestate', 'basal', 'careportal'];

  // Plugin-specific extended settings definitions
  var PLUGIN_SETTINGS = {
    openaps: {
      label: 'OpenAPS',
      fields: [
        { key: 'fields', label: 'Fields', type: 'text', default: 'status-symbol status-label iob meal-assist rssi', hint: 'status-symbol status-label iob meal-assist rssi freq' },
        { key: 'retroFields', label: 'Retro Fields', type: 'text', default: 'status-symbol status-label iob meal-assist rssi' },
        { key: 'warn', label: 'Warn after (min)', type: 'number', default: 20 },
        { key: 'urgent', label: 'Urgent after (min)', type: 'number', default: 60 },
        { key: 'enableAlerts', label: 'Enable Alerts', type: 'checkbox', default: true },
        { key: 'colorPredictionLines', label: 'Color Prediction Lines', type: 'checkbox', default: true }
      ]
    },
    loop: {
      label: 'Loop',
      fields: [
        { key: 'warn', label: 'Warn after (min)', type: 'number', default: 30 },
        { key: 'urgent', label: 'Urgent after (min)', type: 'number', default: 60 },
        { key: 'enableAlerts', label: 'Enable Alerts', type: 'checkbox', default: false }
      ]
    },
    pump: {
      label: 'Pump',
      fields: [
        { key: 'fields', label: 'Fields', type: 'text', default: 'reservoir battery clock status', hint: 'battery reservoir clock status device' },
        { key: 'retroFields', label: 'Retro Fields', type: 'text', default: 'reservoir battery clock status' },
        { key: 'warnClock', label: 'Warn Clock (min)', type: 'number', default: 30 },
        { key: 'urgentClock', label: 'Urgent Clock (min)', type: 'number', default: 60 },
        { key: 'warnRes', label: 'Warn Reservoir (U)', type: 'number', default: 15 },
        { key: 'urgentRes', label: 'Urgent Reservoir (U)', type: 'number', default: 5 },
        { key: 'warnBattV', label: 'Warn Battery (V)', type: 'number', default: 1.25, step: 0.01 },
        { key: 'urgentBattV', label: 'Urgent Battery (V)', type: 'number', default: 1.23, step: 0.01 },
        { key: 'warnBattP', label: 'Warn Battery (%)', type: 'number', default: 30 },
        { key: 'urgentBattP', label: 'Urgent Battery (%)', type: 'number', default: 20 },
        { key: 'enableAlerts', label: 'Enable Alerts', type: 'checkbox', default: true },
        { key: 'warnOnSuspend', label: 'Warn on Suspend', type: 'checkbox', default: true }
      ]
    },
    cage: {
      label: 'Cannula Age (CAGE)',
      fields: [
        { key: 'display', label: 'Display', type: 'select', options: ['hours', 'days'], default: 'days' },
        { key: 'info', label: 'Info (hours)', type: 'number', default: 48 },
        { key: 'warn', label: 'Warn (hours)', type: 'number', default: 65 },
        { key: 'urgent', label: 'Urgent (hours)', type: 'number', default: 72 },
        { key: 'enableAlerts', label: 'Enable Alerts', type: 'checkbox', default: true }
      ]
    },
    sage: {
      label: 'Sensor Age (SAGE)',
      fields: [
        { key: 'display', label: 'Display', type: 'select', options: ['hours', 'days'], default: 'days' },
        { key: 'info', label: 'Info (hours)', type: 'number', default: 312 },
        { key: 'warn', label: 'Warn (hours)', type: 'number', default: 336 },
        { key: 'urgent', label: 'Urgent (hours)', type: 'number', default: 348 },
        { key: 'enableAlerts', label: 'Enable Alerts', type: 'checkbox', default: true }
      ]
    },
    iage: {
      label: 'Insulin Age (IAGE)',
      fields: [
        { key: 'info', label: 'Info (hours)', type: 'number', default: 44 },
        { key: 'warn', label: 'Warn (hours)', type: 'number', default: 672 },
        { key: 'urgent', label: 'Urgent (hours)', type: 'number', default: 744 },
        { key: 'enableAlerts', label: 'Enable Alerts', type: 'checkbox', default: false }
      ]
    },
    bage: {
      label: 'Battery Age (BAGE)',
      fields: [
        { key: 'display', label: 'Display', type: 'select', options: ['hours', 'days'], default: 'days' },
        { key: 'info', label: 'Info (hours)', type: 'number', default: 72 },
        { key: 'warn', label: 'Warn (hours)', type: 'number', default: 96 },
        { key: 'urgent', label: 'Urgent (hours)', type: 'number', default: 120 },
        { key: 'enableAlerts', label: 'Enable Alerts', type: 'checkbox', default: true }
      ]
    },
    bridge: {
      label: 'Dexcom Share Bridge',
      fields: [
        { key: 'userName', label: 'Dexcom Username', type: 'text', default: '' },
        { key: 'password', label: 'Dexcom Password', type: 'password', default: '' },
        { key: 'server', label: 'Server', type: 'select', options: ['US', 'EU', ''], default: '' },
        { key: 'minutes', label: 'Fetch minutes', type: 'number', default: 1400 },
        { key: 'maxCount', label: 'Max count', type: 'number', default: 1 },
        { key: 'firstFetchCount', label: 'First fetch count', type: 'number', default: 3 },
        { key: 'interval', label: 'Interval (ms)', type: 'number', default: 150000 },
        { key: 'maxFailures', label: 'Max failures', type: 'number', default: 3 }
      ]
    },
    maker: {
      label: 'IFTTT Maker',
      fields: [
        { key: 'key', label: 'Maker Key', type: 'text', default: '' }
      ]
    },
    pushover: {
      label: 'Pushover',
      fields: [
        { key: 'apiToken', label: 'API Token', type: 'text', default: '' },
        { key: 'userKey', label: 'User Key', type: 'text', default: '' }
      ]
    },
    upbat: {
      label: 'Uploader Battery',
      fields: [
        { key: 'warn', label: 'Warn (%)', type: 'number', default: 30 },
        { key: 'urgent', label: 'Urgent (%)', type: 'number', default: 20 },
        { key: 'enableAlerts', label: 'Enable Alerts', type: 'checkbox', default: true }
      ]
    },
    devicestatus: {
      label: 'Device Status',
      fields: [
        { key: 'advanced', label: 'Advanced', type: 'checkbox', default: true },
        { key: 'days', label: 'Days to show', type: 'number', default: 1 }
      ]
    }
  };

  // Presets
  var PRESETS = {
    'OpenAPS / AndroidAPS': {
      display: { units: 'mmol', timeFormat: 24, theme: 'colors', language: 'en', customTitle: '', nightMode: false, scaleY: 'linear' },
      thresholds: { bgHigh: 234, bgTargetTop: 180, bgTargetBottom: 81, bgLow: 79 },
      alarms: { urgentHigh: true, high: true, low: true, urgentLow: true, timeagoWarn: true, timeagoWarnMins: 15, timeagoUrgent: true, timeagoUrgentMins: 30, pumpBatteryLow: false },
      plugins: { enable: ['loop', 'careportal', 'bridge', 'basal', 'dbsize', 'rawbg', 'iob', 'maker', 'cob', 'cage', 'iage', 'sage', 'pump', 'profile', 'openaps', 'bage', 'override', 'cors'] },
      integrations: {
        openaps: { fields: 'status-symbol status-label iob meal-assist rssi', retroFields: 'status-symbol status-label iob meal-assist rssi', warn: 20, urgent: 60, enableAlerts: true, colorPredictionLines: true },
        pump: { fields: 'battery reservoir clock status device', retroFields: 'battery reservoir clock status device', warnClock: 30, urgentClock: 60, warnRes: 15, urgentRes: 5, warnBattV: 1.25, urgentBattV: 1.23, warnBattP: 30, urgentBattP: 20, enableAlerts: true, warnOnSuspend: true },
        cage: { display: 'days', info: 48, warn: 65, urgent: 72, enableAlerts: true },
        sage: { display: 'days', info: 312, warn: 336, urgent: 348, enableAlerts: true },
        iage: { warn: 672, urgent: 744 },
        bage: { display: 'days', info: 72, warn: 96, urgent: 120, enableAlerts: true },
        devicestatus: { advanced: true, days: 1 }
      },
      showForecast: ['openaps'],
      alarmTypes: 'simple'
    },
    'Loop (iOS)': {
      display: { units: 'mg/dl', timeFormat: 12, theme: 'colors', language: 'en', customTitle: '', nightMode: false, scaleY: 'log' },
      thresholds: { bgHigh: 260, bgTargetTop: 180, bgTargetBottom: 80, bgLow: 55 },
      alarms: { urgentHigh: true, high: true, low: true, urgentLow: true, timeagoWarn: true, timeagoWarnMins: 15, timeagoUrgent: true, timeagoUrgentMins: 30, pumpBatteryLow: false },
      plugins: { enable: ['loop', 'careportal', 'basal', 'dbsize', 'iob', 'cob', 'cage', 'sage', 'pump', 'profile', 'override'] },
      integrations: {
        loop: { warn: 30, urgent: 60, enableAlerts: true },
        pump: { fields: 'battery reservoir clock status', retroFields: 'battery reservoir clock', warnClock: 30, urgentClock: 60, warnRes: 15, urgentRes: 5, enableAlerts: true },
        cage: { display: 'days', info: 48, warn: 65, urgent: 72, enableAlerts: true },
        sage: { display: 'days', info: 168, warn: 240, urgent: 336, enableAlerts: true },
        devicestatus: { advanced: true, days: 1 }
      },
      showForecast: ['loop'],
      alarmTypes: 'simple'
    },
    'Basic CGM': {
      display: { units: 'mg/dl', timeFormat: 12, theme: 'default', language: 'en', customTitle: '', nightMode: false, scaleY: 'log' },
      thresholds: { bgHigh: 260, bgTargetTop: 180, bgTargetBottom: 80, bgLow: 55 },
      alarms: { urgentHigh: true, high: true, low: true, urgentLow: true, timeagoWarn: true, timeagoWarnMins: 15, timeagoUrgent: true, timeagoUrgentMins: 30, pumpBatteryLow: false },
      plugins: { enable: ['careportal', 'dbsize', 'rawbg', 'iob', 'cob'] },
      integrations: {},
      showForecast: ['ar2'],
      alarmTypes: 'simple'
    }
  };

  var plugin = {
    name: 'sitesettings',
    label: 'Site Settings',
    actions: [
      {
        name: 'Server Settings (stored in MongoDB)',
        description: 'Configure display, plugins, alarms, thresholds and plugin options. Changes are saved to MongoDB. Press Reload Server to apply.',
        buttonLabel: 'Save Settings',
        preventClose: true,
        init: function initSettingsUI (client) {
          var container = $('#admin_sitesettings_0_html');
          container.empty();

          $.ajax({
            url: '/api/v1/settings',
            headers: client.headers(),
            success: function onSuccess (data) {
              renderSettingsForm(container, data, client);
            },
            error: function onError (xhr) {
              if (xhr.status === 403) {
                container.append('<p style="color:red">Admin authentication required.</p>');
              } else {
                renderSettingsForm(container, {}, client);
              }
            }
          });
        },
        code: function saveSettings (client) {
          var settings = collectSettingsFromForm();
          var statusEl = $('#admin_sitesettings_0_status');
          statusEl.text(' Saving...').css('color', '#ccc');

          $.ajax({
            url: '/api/v1/settings',
            method: 'PUT',
            headers: client.headers(),
            contentType: 'application/json',
            data: JSON.stringify(settings),
            success: function () {
              statusEl.text(' Saved! Press Reload Server below to apply.').css('color', '#4caf50');
            },
            error: function (xhr) {
              statusEl.text(' Error: ' + (xhr.responseJSON && xhr.responseJSON.message || xhr.statusText)).css('color', 'red');
            }
          });
        }
      }
    ],
    css: [
      '.ss-group { margin: 8px 0; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 6px; }',
      '.ss-field { margin: 6px 0; display: flex; align-items: center; gap: 8px; }',
      '.ss-field label { min-width: 180px; flex-shrink: 0; }',
      '.ss-field input[type=text], .ss-field input[type=password], .ss-field select { min-width: 200px; padding: 4px 6px; }',
      '.ss-field input[type=number] { width: 80px; padding: 4px 6px; }',
      '.ss-slider-wrap { display: flex; align-items: center; gap: 10px; flex: 1; }',
      '.ss-slider-wrap input[type=range] { flex: 1; min-width: 150px; }',
      '.ss-slider-val { min-width: 60px; text-align: right; font-weight: bold; font-size: 14px; }',
      '.ss-cb { display: inline-block !important; margin: 4px 14px 4px 0 !important; cursor: pointer; }',
      '.ss-section { margin-top: 16px; }',
      '.ss-section h3 { margin: 12px 0 4px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; }',
      '.ss-plugin-opts { margin: 4px 0 8px 24px; padding: 8px; background: rgba(255,255,255,0.03); border-left: 3px solid rgba(255,255,255,0.15); border-radius: 0 4px 4px 0; }',
      '.ss-plugin-opts .ss-field label { min-width: 160px; font-size: 0.9em; }',
      '.ss-hint { font-size: 0.8em; color: #999; margin-left: 4px; }',
      '.ss-preset-btn { margin: 4px 8px 4px 0; padding: 6px 14px; border: 1px solid rgba(255,255,255,0.3); border-radius: 4px; background: rgba(255,255,255,0.08); color: #eee; cursor: pointer; }',
      '.ss-preset-btn:hover { background: rgba(255,255,255,0.15); }',
      '.ss-color-bar { height: 8px; border-radius: 4px; margin-top: 4px; background: linear-gradient(to right, #c62828 0%, #ef5350 15%, #66bb6a 30%, #66bb6a 70%, #ef5350 85%, #c62828 100%); }',
      '.ss-thresh-markers { position: relative; height: 20px; }',
      '.ss-thresh-mark { position: absolute; transform: translateX(-50%); font-size: 10px; color: #aaa; }'
    ].join('\n')
  };

  function getUnits () {
    var sel = $('#display_units');
    return sel.length ? sel.val() : 'mg/dl';
  }

  function isMmol () { return getUnits() === 'mmol'; }

  // Convert mg/dl value for display in current units
  function displayBG (mgVal) {
    return isMmol() ? mgToMmol(mgVal) : mgVal;
  }

  function renderSettingsForm (container, data, client) {
    var t = client.translate;
    var integrations = data.integrations || {};

    // --- Presets ---
    container.append('<h3>' + t('Quick Setup Presets') + '</h3>');
    var presetDiv = $('<div>').addClass('ss-group');
    Object.keys(PRESETS).forEach(function (name) {
      presetDiv.append(
        $('<button>').addClass('ss-preset-btn').text(name).on('click', function (e) {
          e.preventDefault();
          if (window.confirm(t('Apply preset') + ' "' + name + '"? ' + t('This will overwrite current settings.'))) {
            applyPreset(container, PRESETS[name], client);
          }
        })
      );
    });
    container.append(presetDiv);

    // --- Display ---
    container.append('<h3>' + t('Display') + '</h3>');
    var dispDiv = $('<div>').addClass('ss-group');
    var dispFields = [
      { key: 'units', label: 'Display Units', type: 'select', options: [{ value: 'mg/dl', label: 'mg/dl' }, { value: 'mmol', label: 'mmol/L' }] },
      { key: 'timeFormat', label: 'Time Format', type: 'select', options: [{ value: 12, label: '12h' }, { value: 24, label: '24h' }] },
      { key: 'theme', label: 'Theme', type: 'select', options: [{ value: 'default', label: 'Default' }, { value: 'colors', label: 'Colors' }, { value: 'colorblindfriendly', label: 'Color Blind Friendly' }] },
      { key: 'language', label: 'Language', type: 'text' },
      { key: 'customTitle', label: 'Custom Title', type: 'text' },
      { key: 'nightMode', label: 'Night Mode', type: 'checkbox' },
      { key: 'scaleY', label: 'Y-axis Scale', type: 'select', options: [{ value: 'log', label: 'Logarithmic' }, { value: 'linear', label: 'Linear' }] }
    ];
    dispFields.forEach(function (field) {
      var val = data.display && data.display[field.key] !== undefined ? data.display[field.key] : '';
      dispDiv.append(renderField('display_' + field.key, field, val, t));
    });
    container.append(dispDiv);

    // Units change handler — update threshold sliders
    $('#display_units').on('change', function () {
      updateThresholdSliders();
    });

    // --- BG Thresholds with sliders ---
    var thresholds = data.thresholds || {};
    container.append('<h3 id="ss_thresh_title">' + t('BG Thresholds') + '</h3>');
    var threshDiv = $('<div>').addClass('ss-group');

    var threshDefs = [
      { key: 'bgHigh', label: 'Urgent High', color: '#c62828', mgMin: 120, mgMax: 400, mgDefault: 260 },
      { key: 'bgTargetTop', label: 'High', color: '#ef5350', mgMin: 100, mgMax: 300, mgDefault: 180 },
      { key: 'bgTargetBottom', label: 'Low', color: '#42a5f5', mgMin: 40, mgMax: 120, mgDefault: 80 },
      { key: 'bgLow', label: 'Urgent Low', color: '#c62828', mgMin: 30, mgMax: 100, mgDefault: 55 }
    ];

    threshDefs.forEach(function (def) {
      var mgVal = thresholds[def.key] || def.mgDefault;
      var row = $('<div>').addClass('ss-field');
      row.append($('<label>').text(t(def.label) + ':').css('color', def.color));

      var sliderWrap = $('<div>').addClass('ss-slider-wrap');
      var slider = $('<input>').attr({
        type: 'range',
        id: 'threshold_' + def.key,
        'data-mg-value': mgVal,
        min: def.mgMin, max: def.mgMax, step: 1,
        value: mgVal
      });
      var valSpan = $('<span>').addClass('ss-slider-val').attr('id', 'threshold_' + def.key + '_val');

      slider.on('input', function () {
        var mg = Number($(this).val());
        $(this).attr('data-mg-value', mg);
        valSpan.text(isMmol() ? mgToMmol(mg) + ' mmol/L' : mg + ' mg/dl');
      });

      sliderWrap.append(slider, valSpan);
      row.append(sliderWrap);
      threshDiv.append(row);
    });
    container.append(threshDiv);

    // Initialize slider displays
    function updateThresholdSliders () {
      threshDefs.forEach(function (def) {
        var slider = $('#threshold_' + def.key);
        var mg = Number(slider.attr('data-mg-value'));
        if (isMmol()) {
          slider.attr({ min: mgToMmol(def.mgMin), max: mgToMmol(def.mgMax), step: 0.1 });
          slider.val(mgToMmol(mg));
          $('#threshold_' + def.key + '_val').text(mgToMmol(mg) + ' mmol/L');
        } else {
          slider.attr({ min: def.mgMin, max: def.mgMax, step: 1 });
          slider.val(mg);
          $('#threshold_' + def.key + '_val').text(mg + ' mg/dl');
        }
        // Re-bind input for unit-aware updates
        slider.off('input').on('input', function () {
          var v = Number($(this).val());
          var mg2 = isMmol() ? mmolToMg(v) : v;
          $(this).attr('data-mg-value', mg2);
          $('#threshold_' + def.key + '_val').text(isMmol() ? v + ' mmol/L' : mg2 + ' mg/dl');
        });
      });
    }
    updateThresholdSliders();

    // --- Alarms ---
    container.append('<h3>' + t('Alarms') + '</h3>');
    var alarmDiv = $('<div>').addClass('ss-group');
    var alarmFields = [
      { key: 'urgentHigh', label: 'Urgent High Alarm', type: 'checkbox' },
      { key: 'high', label: 'High Alarm', type: 'checkbox' },
      { key: 'low', label: 'Low Alarm', type: 'checkbox' },
      { key: 'urgentLow', label: 'Urgent Low Alarm', type: 'checkbox' },
      { key: 'timeagoWarn', label: 'Stale Data Warning', type: 'checkbox' },
      { key: 'timeagoWarnMins', label: 'Stale Data Warn (min)', type: 'number' },
      { key: 'timeagoUrgent', label: 'Stale Data Urgent', type: 'checkbox' },
      { key: 'timeagoUrgentMins', label: 'Stale Data Urgent (min)', type: 'number' },
      { key: 'pumpBatteryLow', label: 'Pump Battery Low', type: 'checkbox' }
    ];
    alarmFields.forEach(function (field) {
      var val = data.alarms && data.alarms[field.key] !== undefined ? data.alarms[field.key] : '';
      alarmDiv.append(renderField('alarm_' + field.key, field, val, t));
    });

    // Alarm types
    var alarmTypesVal = (data.alarmTypes) || 'predict';
    alarmDiv.append(renderField('alarm_types', { key: 'types', label: 'Alarm Type', type: 'select', options: [
      { value: 'predict', label: 'Predictive' }, { value: 'simple', label: 'Simple' }
    ] }, alarmTypesVal, t));

    container.append(alarmDiv);

    // --- Plugins ---
    container.append('<h3>' + t('Plugins') + '</h3>');

    // Core
    var coreDiv = $('<div>').addClass('ss-group');
    coreDiv.append($('<small>').text(t('Core (always enabled)') + ': '));
    coreDiv.append($('<small>').css('color', '#999').text(ALWAYS_ENABLED.join(', ')));
    container.append(coreDiv);

    var enabledPlugins = (data.plugins && data.plugins.enable) || [];
    var showForecast = (data.plugins && data.plugins.showForecast) || [];

    Object.keys(PLUGIN_GROUPS).forEach(function (groupName) {
      container.append('<h4 class="ss-section">' + t(groupName) + '</h4>');
      var groupDiv = $('<div>').addClass('ss-group');

      PLUGIN_GROUPS[groupName].forEach(function (pluginDef) {
        var isEnabled = enabledPlugins.indexOf(pluginDef.name) > -1;
        var pluginRow = $('<div>');

        // Main enable checkbox
        var label = $('<label>').addClass('ss-cb');
        var cb = $('<input>').attr({
          type: 'checkbox', 'data-plugin': pluginDef.name,
          checked: isEnabled ? true : undefined
        }).addClass('plugin-enable-cb');
        label.append(cb, ' <strong>' + t(pluginDef.label) + '</strong>');
        pluginRow.append(label);

        // Forecast sub-checkbox
        if (pluginDef.forecast) {
          var fcLabel = $('<label>').addClass('ss-cb');
          var fcCb = $('<input>').attr({
            type: 'checkbox', 'data-forecast': pluginDef.name,
            checked: showForecast.indexOf(pluginDef.name) > -1 ? true : undefined
          }).addClass('forecast-cb');
          fcLabel.append(fcCb, ' ' + t('Show forecast'));
          pluginRow.append(fcLabel);
        }

        // Plugin-specific settings (collapsible)
        var pSettings = PLUGIN_SETTINGS[pluginDef.name];
        if (pSettings) {
          var optsDiv = $('<div>').addClass('ss-plugin-opts').attr('id', 'plugin_opts_' + pluginDef.name);
          var pData = integrations[pluginDef.name] || {};

          pSettings.fields.forEach(function (field) {
            var val = pData[field.key] !== undefined ? pData[field.key] : field.default;
            optsDiv.append(renderPluginField(pluginDef.name, field, val, t));
          });

          // Show/hide based on enabled state
          if (!isEnabled) optsDiv.hide();
          cb.on('change', function () {
            if ($(this).is(':checked')) optsDiv.slideDown(200);
            else optsDiv.slideUp(200);
          });

          pluginRow.append(optsDiv);
        }

        groupDiv.append(pluginRow);
      });
      container.append(groupDiv);
    });

    // Always-on plugins with settings (devicestatus, upbat)
    container.append('<h4 class="ss-section">' + t('Core Plugin Settings') + '</h4>');
    var coreOptsDiv = $('<div>').addClass('ss-group');
    ['devicestatus', 'upbat'].forEach(function (name) {
      var pDef = PLUGIN_SETTINGS[name];
      if (!pDef) return;
      coreOptsDiv.append('<strong>' + t(pDef.label) + '</strong>');
      var pData = integrations[name] || {};
      pDef.fields.forEach(function (field) {
        var val = pData[field.key] !== undefined ? pData[field.key] : field.default;
        coreOptsDiv.append(renderPluginField(name, field, val, t));
      });
      coreOptsDiv.append('<hr style="border-color:rgba(255,255,255,0.1)">');
    });
    container.append(coreOptsDiv);

    // Forecast: ar2
    container.append('<h4 class="ss-section">' + t('Forecast') + '</h4>');
    var fcDiv = $('<div>').addClass('ss-group');
    fcDiv.append($('<label>').addClass('ss-cb').append(
      $('<input>').attr({ type: 'checkbox', 'data-forecast': 'ar2', checked: showForecast.indexOf('ar2') > -1 ? true : undefined }).addClass('forecast-cb'),
      ' AR2 ' + t('Forecast')
    ));
    container.append(fcDiv);

    // Auto-dependency
    container.find('.plugin-enable-cb').on('change', function () {
      var pluginName = $(this).attr('data-plugin');
      var forecastCb = container.find('.forecast-cb[data-forecast="' + pluginName + '"]');
      if ($(this).is(':checked') && forecastCb.length) {
        forecastCb.prop('checked', true);
      }
    });
  }

  function renderField (id, field, value, t) {
    var wrapper = $('<div>').addClass('ss-field');
    if (field.type === 'checkbox') {
      wrapper.append($('<label>').append(
        $('<input>').attr({ type: 'checkbox', id: id, checked: value ? true : undefined }), ' ' + t(field.label)
      ));
    } else if (field.type === 'select') {
      wrapper.append($('<label>').attr('for', id).text(t(field.label) + ':'));
      var sel = $('<select>').attr('id', id);
      field.options.forEach(function (opt) {
        var optVal = typeof opt === 'object' ? opt.value : opt;
        var optLabel = typeof opt === 'object' ? opt.label : opt;
        var option = $('<option>').attr('value', optVal).text(t(optLabel));
        if (String(value) === String(optVal)) option.attr('selected', true);
        sel.append(option);
      });
      wrapper.append(sel);
    } else {
      wrapper.append(
        $('<label>').attr('for', id).text(t(field.label) + ':'),
        $('<input>').attr({ type: field.type === 'number' ? 'number' : 'text', id: id, value: value || '' })
      );
    }
    return wrapper;
  }

  function renderPluginField (pluginName, field, value, t) {
    var id = 'ext_' + pluginName + '_' + field.key;
    var wrapper = $('<div>').addClass('ss-field');
    wrapper.append($('<label>').attr('for', id).text(t(field.label) + ':'));

    if (field.type === 'checkbox') {
      wrapper.empty();
      wrapper.append($('<label>').append(
        $('<input>').attr({ type: 'checkbox', id: id, checked: value ? true : undefined }), ' ' + t(field.label)
      ));
    } else if (field.type === 'select') {
      var sel = $('<select>').attr('id', id);
      (field.options || []).forEach(function (opt) {
        var optVal = typeof opt === 'object' ? opt.value : opt;
        var optLabel = typeof opt === 'object' ? opt.label : opt;
        var option = $('<option>').attr('value', optVal).text(optLabel);
        if (String(value) === String(optVal)) option.attr('selected', true);
        sel.append(option);
      });
      wrapper.append(sel);
    } else if (field.type === 'password') {
      wrapper.append($('<input>').attr({ type: 'password', id: id, value: value || '', autocomplete: 'off' }));
    } else {
      var attrs = { type: field.type === 'number' ? 'number' : 'text', id: id, value: value !== undefined ? value : '' };
      if (field.step) attrs.step = field.step;
      wrapper.append($('<input>').attr(attrs));
    }

    if (field.hint) {
      wrapper.append($('<span>').addClass('ss-hint').text(field.hint));
    }
    return wrapper;
  }

  function applyPreset (container, preset, client) {
    // Display
    if (preset.display) {
      Object.keys(preset.display).forEach(function (k) {
        var el = $('#display_' + k);
        if (!el.length) return;
        if (el.is(':checkbox')) el.prop('checked', !!preset.display[k]);
        else el.val(preset.display[k]);
      });
      $('#display_units').trigger('change');
    }
    // Thresholds
    if (preset.thresholds) {
      Object.keys(preset.thresholds).forEach(function (k) {
        var slider = $('#threshold_' + k);
        if (!slider.length) return;
        slider.attr('data-mg-value', preset.thresholds[k]);
        slider.val(isMmol() ? mgToMmol(preset.thresholds[k]) : preset.thresholds[k]);
        slider.trigger('input');
      });
    }
    // Alarms
    if (preset.alarms) {
      Object.keys(preset.alarms).forEach(function (k) {
        var el = $('#alarm_' + k);
        if (!el.length) return;
        if (el.is(':checkbox')) el.prop('checked', !!preset.alarms[k]);
        else el.val(preset.alarms[k]);
      });
    }
    if (preset.alarmTypes) {
      $('#alarm_types').val(preset.alarmTypes);
    }
    // Plugins
    if (preset.plugins && preset.plugins.enable) {
      var en = preset.plugins.enable;
      $('.plugin-enable-cb').each(function () {
        var name = $(this).attr('data-plugin');
        $(this).prop('checked', en.indexOf(name) > -1).trigger('change');
      });
    }
    if (preset.showForecast) {
      $('.forecast-cb').each(function () {
        var name = $(this).attr('data-forecast');
        $(this).prop('checked', preset.showForecast.indexOf(name) > -1);
      });
    }
    // Integrations
    if (preset.integrations) {
      Object.keys(preset.integrations).forEach(function (pluginName) {
        var pData = preset.integrations[pluginName];
        Object.keys(pData).forEach(function (k) {
          var el = $('#ext_' + pluginName + '_' + k);
          if (!el.length) return;
          if (el.is(':checkbox')) el.prop('checked', !!pData[k]);
          else el.val(pData[k]);
        });
      });
    }
  }

  function collectSettingsFromForm () {
    var settings = { display: {}, alarms: {}, thresholds: {}, plugins: {}, integrations: {} };

    // Display
    [{ key: 'units' }, { key: 'timeFormat', num: true }, { key: 'theme' }, { key: 'language' }, { key: 'customTitle' }, { key: 'nightMode', cb: true }, { key: 'scaleY' }].forEach(function (f) {
      var el = $('#display_' + f.key);
      if (!el.length) return;
      if (f.cb) settings.display[f.key] = el.is(':checked');
      else if (f.num) settings.display[f.key] = Number(el.val());
      else settings.display[f.key] = el.val();
    });

    // Thresholds — always save in mg/dl
    ['bgHigh', 'bgTargetTop', 'bgTargetBottom', 'bgLow'].forEach(function (key) {
      var slider = $('#threshold_' + key);
      if (slider.length) {
        settings.thresholds[key] = Number(slider.attr('data-mg-value'));
      }
    });

    // Alarms
    [{ key: 'urgentHigh', cb: true }, { key: 'high', cb: true }, { key: 'low', cb: true }, { key: 'urgentLow', cb: true },
     { key: 'timeagoWarn', cb: true }, { key: 'timeagoWarnMins' }, { key: 'timeagoUrgent', cb: true }, { key: 'timeagoUrgentMins' },
     { key: 'pumpBatteryLow', cb: true }].forEach(function (f) {
      var el = $('#alarm_' + f.key);
      if (!el.length) return;
      settings.alarms[f.key] = f.cb ? el.is(':checked') : Number(el.val());
    });

    // Alarm types
    var alarmTypes = $('#alarm_types').val();
    if (alarmTypes) settings.alarmTypes = alarmTypes;

    // Plugins
    var enabledPlugins = ALWAYS_ENABLED.slice();
    $('.plugin-enable-cb:checked').each(function () {
      var name = $(this).attr('data-plugin');
      if (name && enabledPlugins.indexOf(name) === -1) enabledPlugins.push(name);
    });

    if (enabledPlugins.indexOf('pushover') > -1 || enabledPlugins.indexOf('maker') > -1 || enabledPlugins.indexOf('careportal') > -1) {
      if (enabledPlugins.indexOf('treatmentnotify') === -1) enabledPlugins.push('treatmentnotify');
    }
    if (enabledPlugins.indexOf('ar2') === -1) enabledPlugins.push('ar2');
    if (enabledPlugins.indexOf('simplealarms') === -1) enabledPlugins.push('simplealarms');

    settings.plugins.enable = enabledPlugins;

    var internalPlugins = ['ar2', 'simplealarms', 'treatmentnotify'];
    settings.plugins.showPlugins = enabledPlugins.filter(function (name) {
      return internalPlugins.indexOf(name) === -1;
    });

    var showForecast = [];
    $('.forecast-cb:checked').each(function () {
      var name = $(this).attr('data-forecast');
      if (name) showForecast.push(name);
    });
    settings.plugins.showForecast = showForecast;

    // Integrations (extended plugin settings)
    Object.keys(PLUGIN_SETTINGS).forEach(function (pluginName) {
      var pDef = PLUGIN_SETTINGS[pluginName];
      var pData = {};
      var hasAny = false;

      pDef.fields.forEach(function (field) {
        var el = $('#ext_' + pluginName + '_' + field.key);
        if (!el.length) return;

        if (field.type === 'checkbox') {
          pData[field.key] = el.is(':checked');
        } else if (field.type === 'number') {
          pData[field.key] = Number(el.val());
        } else {
          pData[field.key] = el.val();
        }
        hasAny = true;
      });

      if (hasAny) settings.integrations[pluginName] = pData;
    });

    return settings;
  }

  return plugin;
}

module.exports = init;
