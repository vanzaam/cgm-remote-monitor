'use strict';

function init (ctx) {
  var refreshTimer = null;
  var lastTimestamp = 0;
  var autoScroll = true;

  var plugin = {
    name: 'serverlogs',
    label: 'Server Logs',
    css: [
      '#log_container { max-height: 400px; overflow-y: auto; background: #111; color: #ddd; font-family: monospace; font-size: 12px; padding: 8px; border-radius: 4px; white-space: pre-wrap; word-break: break-all; }',
      '.log-line { padding: 1px 0; border-bottom: 1px solid rgba(255,255,255,0.03); }',
      '.log-time { color: #888; margin-right: 8px; }',
      '.log-level-error { color: #ef5350; }',
      '.log-level-warn { color: #ffa726; }',
      '.log-level-info { color: #ccc; }',
      '#log_controls { margin-bottom: 8px; display: flex; gap: 8px; align-items: center; }',
      '#log_controls button { padding: 4px 12px; border: 1px solid rgba(255,255,255,0.3); border-radius: 4px; background: rgba(255,255,255,0.08); color: #eee; cursor: pointer; }',
      '#log_controls button:hover { background: rgba(255,255,255,0.15); }',
      '#log_controls label { color: #aaa; font-size: 12px; cursor: pointer; }',
      '#log_status { color: #888; font-size: 11px; }'
    ].join('\n'),
    actions: [
      {
        description: 'View real-time server logs for this site. Logs auto-refresh every 3 seconds.',
        buttonLabel: 'Start Logs',
        preventClose: true,
        init: function initLogs (client) {
          var html = $('#admin_serverlogs_0_html');
          html.empty();

          html.append(
            '<div id="log_controls">' +
              '<button id="log_start">Start</button>' +
              '<button id="log_stop" style="display:none">Stop</button>' +
              '<button id="log_clear_view">Clear View</button>' +
              '<label><input type="checkbox" id="log_autoscroll" checked> Auto-scroll</label>' +
              '<span id="log_status"></span>' +
            '</div>' +
            '<div id="log_container"></div>'
          );

          $('#log_autoscroll').on('change', function () {
            autoScroll = $(this).is(':checked');
          });

          $('#log_start').on('click', function () {
            startPolling(client);
            $(this).hide();
            $('#log_stop').show();
          });

          $('#log_stop').on('click', function () {
            stopPolling();
            $(this).hide();
            $('#log_start').show();
          });

          $('#log_clear_view').on('click', function () {
            $('#log_container').empty();
            lastTimestamp = Date.now();
          });
        },
        code: function toggleLogs (client) {
          if (refreshTimer) {
            stopPolling();
            $('#log_stop').hide();
            $('#log_start').show();
          } else {
            startPolling(client);
            $('#log_start').hide();
            $('#log_stop').show();
          }
        }
      }
    ]
  };

  function fetchLogs (client) {
    $.ajax({
      url: '/api/v1/tenant/logs?since=' + lastTimestamp + '&limit=100',
      headers: client.headers(),
      success: function (data) {
        if (!data.lines || data.lines.length === 0) return;

        var container = $('#log_container');
        data.lines.forEach(function (line) {
          var time = new Date(line.t);
          var timeStr = time.toLocaleTimeString();
          var levelClass = 'log-level-' + (line.l || 'info');

          container.append(
            '<div class="log-line">' +
              '<span class="log-time">' + timeStr + '</span>' +
              '<span class="' + levelClass + '">' + escapeHtml(line.m) + '</span>' +
            '</div>'
          );

          if (line.t > lastTimestamp) lastTimestamp = line.t;
        });

        // Trim old lines from DOM (keep last 500)
        var lines = container.children();
        if (lines.length > 500) {
          lines.slice(0, lines.length - 500).remove();
        }

        if (autoScroll) {
          container.scrollTop(container[0].scrollHeight);
        }

        $('#log_status').text(data.lines.length + ' new lines');
      },
      error: function (xhr) {
        $('#log_status').text('Error: ' + xhr.status);
      }
    });
  }

  function startPolling (client) {
    fetchLogs(client);
    refreshTimer = setInterval(function () { fetchLogs(client); }, 3000);
    $('#log_status').text('Polling...');
  }

  function stopPolling () {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    $('#log_status').text('Stopped');
  }

  function escapeHtml (str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return plugin;
}

module.exports = init;
