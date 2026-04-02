'use strict';

/**
 * Admin plugin for site settings management.
 *
 * Loads settings from /api/v1/settings, displays them as a form
 * with grouped checkboxes for plugins and fields for display/alarm/threshold settings.
 * Saves via PUT /api/v1/settings.
 */
function init (ctx) {

  // Plugin groups for the UI
  var PLUGIN_GROUPS = {
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
    'Closed Loop Systems': [
      { name: 'loop', label: 'Loop', forecast: true },
      { name: 'openaps', label: 'OpenAPS', forecast: true },
      { name: 'override', label: 'Override' },
      { name: 'pump', label: 'Pump Status' },
      { name: 'xdripjs', label: 'xDrip.js' }
    ],
    'Notifications': [
      { name: 'speech', label: 'Speech' },
      { name: 'pushover', label: 'Pushover', needsTreatmentNotify: true },
      { name: 'maker', label: 'IFTTT Maker', needsTreatmentNotify: true }
    ],
    'Other': [
      { name: 'rawbg', label: 'Raw BG' }
    ]
  };

  // Always-enabled plugins (shown as disabled checkboxes)
  var ALWAYS_ENABLED = ['bgnow', 'delta', 'direction', 'timeago', 'devicestatus', 'upbat', 'errorcodes', 'profile', 'bolus', 'dbsize', 'runtimestate', 'basal', 'careportal'];

  var FORECAST_PLUGINS = ['ar2', 'loop', 'openaps'];

  var DISPLAY_FIELDS = [
    { key: 'units', label: 'Display Units', type: 'select', options: [{ value: 'mg/dl', label: 'mg/dl' }, { value: 'mmol', label: 'mmol/L' }] },
    { key: 'timeFormat', label: 'Time Format', type: 'select', options: [{ value: 12, label: '12 hour' }, { value: 24, label: '24 hour' }] },
    { key: 'theme', label: 'Theme', type: 'select', options: [{ value: 'default', label: 'Default' }, { value: 'colors', label: 'Colors' }, { value: 'colorblindfriendly', label: 'Color Blind Friendly' }] },
    { key: 'language', label: 'Language', type: 'text' },
    { key: 'customTitle', label: 'Custom Title', type: 'text' },
    { key: 'nightMode', label: 'Night Mode', type: 'checkbox' },
    { key: 'scaleY', label: 'Y-axis Scale', type: 'select', options: [{ value: 'log', label: 'Logarithmic' }, { value: 'linear', label: 'Linear' }] }
  ];

  var THRESHOLD_FIELDS = [
    { key: 'bgHigh', label: 'BG High', type: 'number' },
    { key: 'bgTargetTop', label: 'BG Target Top', type: 'number' },
    { key: 'bgTargetBottom', label: 'BG Target Bottom', type: 'number' },
    { key: 'bgLow', label: 'BG Low', type: 'number' }
  ];

  var ALARM_FIELDS = [
    { key: 'urgentHigh', label: 'Urgent High', type: 'checkbox' },
    { key: 'high', label: 'High', type: 'checkbox' },
    { key: 'low', label: 'Low', type: 'checkbox' },
    { key: 'urgentLow', label: 'Urgent Low', type: 'checkbox' },
    { key: 'timeagoWarn', label: 'Stale Data Warning', type: 'checkbox' },
    { key: 'timeagoWarnMins', label: 'Stale Data Warning (mins)', type: 'number' },
    { key: 'timeagoUrgent', label: 'Stale Data Urgent', type: 'checkbox' },
    { key: 'timeagoUrgentMins', label: 'Stale Data Urgent (mins)', type: 'number' },
    { key: 'pumpBatteryLow', label: 'Pump Battery Low', type: 'checkbox' }
  ];

  var plugin = {
    name: 'sitesettings',
    label: 'Site Settings',
    actions: [
      {
        name: 'Server Settings (stored in MongoDB)',
        description: 'Configure display, plugins, alarms and thresholds. Changes are saved to MongoDB and take effect without restart.',
        buttonLabel: 'Save Settings',
        preventClose: true,
        init: function initSettingsUI (client) {
          var container = $('#admin_sitesettings_0_html');
          container.empty();

          // Load current settings
          $.ajax({
            url: '/api/v1/settings?token=' + client.authorized.token,
            headers: client.headers(),
            success: function onSuccess (data) {
              renderSettingsForm(container, data, client);
            },
            error: function onError (xhr) {
              if (xhr.status === 403) {
                container.append('<p style="color:red">Admin authentication required to view settings.</p>');
              } else if (xhr.status === 503) {
                container.append('<p style="color:orange">Settings store not configured. Settings are managed via environment variables.</p>');
              } else {
                container.append('<p>No saved settings found. You can configure and save settings below.</p>');
                renderSettingsForm(container, {}, client);
              }
            }
          });
        },
        code: function saveSettings (client) {
          var settings = collectSettingsFromForm();
          var statusEl = $('#admin_sitesettings_0_status');
          statusEl.text(' Saving...');

          $.ajax({
            url: '/api/v1/settings?token=' + client.authorized.token,
            method: 'PUT',
            headers: client.headers(),
            contentType: 'application/json',
            data: JSON.stringify(settings),
            success: function onSuccess () {
              statusEl.text(' Saved!').css('color', 'green');
              setTimeout(function () { statusEl.text(''); }, 3000);
            },
            error: function onError (xhr) {
              statusEl.text(' Error: ' + (xhr.responseJSON && xhr.responseJSON.message || xhr.statusText)).css('color', 'red');
            }
          });
        }
      }
    ]
  };

  function renderSettingsForm (container, data, client) {
    var translate = client.translate;

    // Display Settings
    container.append('<h3>' + translate('Display') + '</h3>');
    var displayDiv = $('<div>').addClass('settings-group');
    DISPLAY_FIELDS.forEach(function (field) {
      var val = data.display && data.display[field.key] !== undefined ? data.display[field.key] : '';
      displayDiv.append(renderField('display_' + field.key, field, val, translate));
    });
    container.append(displayDiv);

    // Thresholds
    container.append('<h3>' + translate('BG Thresholds') + ' (mg/dl)</h3>');
    var threshDiv = $('<div>').addClass('settings-group');
    THRESHOLD_FIELDS.forEach(function (field) {
      var val = data.thresholds && data.thresholds[field.key] !== undefined ? data.thresholds[field.key] : '';
      threshDiv.append(renderField('threshold_' + field.key, field, val, translate));
    });
    container.append(threshDiv);

    // Alarms
    container.append('<h3>' + translate('Alarms') + '</h3>');
    var alarmsDiv = $('<div>').addClass('settings-group');
    ALARM_FIELDS.forEach(function (field) {
      var val = data.alarms && data.alarms[field.key] !== undefined ? data.alarms[field.key] : '';
      alarmsDiv.append(renderField('alarm_' + field.key, field, val, translate));
    });
    container.append(alarmsDiv);

    // Plugins
    var enabledPlugins = (data.plugins && data.plugins.enable) || [];
    var showForecast = (data.plugins && data.plugins.showForecast) || [];

    // Always-enabled (disabled checkboxes)
    container.append('<h3>' + translate('Core Plugins') + ' (' + translate('always enabled') + ')</h3>');
    var coreDiv = $('<div>').addClass('settings-group');
    ALWAYS_ENABLED.forEach(function (name) {
      coreDiv.append(
        $('<label>').addClass('plugin-checkbox').append(
          $('<input>').attr({ type: 'checkbox', checked: true, disabled: true }),
          ' ' + name
        )
      );
    });
    container.append(coreDiv);

    // Plugin groups
    Object.keys(PLUGIN_GROUPS).forEach(function (groupName) {
      container.append('<h3>' + translate(groupName) + '</h3>');
      var groupDiv = $('<div>').addClass('settings-group');

      PLUGIN_GROUPS[groupName].forEach(function (pluginDef) {
        var isEnabled = enabledPlugins.indexOf(pluginDef.name) > -1;
        var label = $('<label>').addClass('plugin-checkbox');
        var cb = $('<input>').attr({
          type: 'checkbox',
          'data-plugin': pluginDef.name,
          checked: isEnabled ? true : undefined
        }).addClass('plugin-enable-cb');

        label.append(cb, ' ' + translate(pluginDef.label));

        // Forecast sub-checkbox for loop/openaps
        if (pluginDef.forecast) {
          var forecastEnabled = showForecast.indexOf(pluginDef.name) > -1;
          var fcLabel = $('<label>').addClass('plugin-checkbox sub-option').css('margin-left', '20px');
          var fcCb = $('<input>').attr({
            type: 'checkbox',
            'data-forecast': pluginDef.name,
            checked: forecastEnabled ? true : undefined
          }).addClass('forecast-cb');
          fcLabel.append(fcCb, ' ' + translate('Show forecast'));
          label = $('<div>').append(label, fcLabel);
        }

        groupDiv.append(label);
      });

      container.append(groupDiv);
    });

    // Forecast: ar2
    container.append('<h3>' + translate('Forecast') + '</h3>');
    var fcDiv = $('<div>').addClass('settings-group');
    var ar2Enabled = showForecast.indexOf('ar2') > -1;
    fcDiv.append(
      $('<label>').addClass('plugin-checkbox').append(
        $('<input>').attr({ type: 'checkbox', 'data-forecast': 'ar2', checked: ar2Enabled ? true : undefined }).addClass('forecast-cb'),
        ' AR2 ' + translate('Forecast')
      )
    );
    container.append(fcDiv);

    // Auto-dependency: enable plugin checkbox auto-enables forecast
    container.find('.plugin-enable-cb').on('change', function () {
      var pluginName = $(this).attr('data-plugin');
      var forecastCb = container.find('.forecast-cb[data-forecast="' + pluginName + '"]');
      if ($(this).is(':checked') && forecastCb.length) {
        forecastCb.prop('checked', true);
      }
    });

    // Add some CSS
    container.prepend('<style>.settings-group { margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 4px; } ' +
      '.settings-group label { display: block; margin: 4px 0; } ' +
      '.plugin-checkbox { display: inline-block !important; margin: 4px 12px 4px 0 !important; } ' +
      '.settings-field { margin: 6px 0; } ' +
      '.settings-field label { display: inline-block; width: 200px; } ' +
      '.settings-field input, .settings-field select { min-width: 150px; }</style>');
  }

  function renderField (id, field, value, translate) {
    var wrapper = $('<div>').addClass('settings-field');

    if (field.type === 'checkbox') {
      wrapper.append(
        $('<label>').append(
          $('<input>').attr({ type: 'checkbox', id: id, checked: value ? true : undefined }),
          ' ' + translate(field.label)
        )
      );
    } else if (field.type === 'select') {
      var label = $('<label>').attr('for', id).text(translate(field.label) + ': ');
      var select = $('<select>').attr('id', id);
      field.options.forEach(function (opt) {
        var option = $('<option>').attr('value', opt.value).text(translate(opt.label));
        if (String(value) === String(opt.value)) option.attr('selected', true);
        select.append(option);
      });
      wrapper.append(label, select);
    } else {
      var inputType = field.type === 'number' ? 'number' : 'text';
      wrapper.append(
        $('<label>').attr('for', id).text(translate(field.label) + ': '),
        $('<input>').attr({ type: inputType, id: id, value: value || '' })
      );
    }

    return wrapper;
  }

  function collectSettingsFromForm () {
    var settings = { display: {}, alarms: {}, thresholds: {}, plugins: {} };

    // Display
    DISPLAY_FIELDS.forEach(function (field) {
      var el = $('#display_' + field.key);
      if (el.length) {
        if (field.type === 'checkbox') {
          settings.display[field.key] = el.is(':checked');
        } else if (field.type === 'number') {
          settings.display[field.key] = Number(el.val());
        } else {
          settings.display[field.key] = el.val();
        }
      }
    });

    // Thresholds
    THRESHOLD_FIELDS.forEach(function (field) {
      var el = $('#threshold_' + field.key);
      if (el.length) {
        settings.thresholds[field.key] = Number(el.val());
      }
    });

    // Alarms
    ALARM_FIELDS.forEach(function (field) {
      var el = $('#alarm_' + field.key);
      if (el.length) {
        if (field.type === 'checkbox') {
          settings.alarms[field.key] = el.is(':checked');
        } else {
          settings.alarms[field.key] = Number(el.val());
        }
      }
    });

    // Plugins
    var enabledPlugins = ALWAYS_ENABLED.slice();
    $('.plugin-enable-cb:checked').each(function () {
      var name = $(this).attr('data-plugin');
      if (name && enabledPlugins.indexOf(name) === -1) {
        enabledPlugins.push(name);
      }
    });

    // Auto-add treatmentnotify if pushover or maker enabled
    if (enabledPlugins.indexOf('pushover') > -1 || enabledPlugins.indexOf('maker') > -1 || enabledPlugins.indexOf('careportal') > -1) {
      if (enabledPlugins.indexOf('treatmentnotify') === -1) enabledPlugins.push('treatmentnotify');
    }

    // Auto-add ar2 for predict alarms
    if (enabledPlugins.indexOf('ar2') === -1) enabledPlugins.push('ar2');
    // Auto-add simplealarms
    if (enabledPlugins.indexOf('simplealarms') === -1) enabledPlugins.push('simplealarms');

    settings.plugins.enable = enabledPlugins;

    // Forecast
    var showForecast = [];
    $('.forecast-cb:checked').each(function () {
      var name = $(this).attr('data-forecast');
      if (name) showForecast.push(name);
    });
    settings.plugins.showForecast = showForecast;

    return settings;
  }

  return plugin;
}

module.exports = init;
