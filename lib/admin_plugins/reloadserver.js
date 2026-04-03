'use strict';

function init (ctx) {

  var plugin = {
    name: 'reloadserver',
    label: 'Reload Server',
    actions: [
      {
        description: 'Reload this site to apply settings changes (plugins, thresholds, etc). Connected clients will briefly disconnect and automatically reconnect.',
        buttonLabel: 'Reload Server',
        confirmText: 'Reload the server? Connected clients will briefly disconnect.',
        preventClose: true,
        code: function reloadServer (client) {
          var statusEl = $('#admin_reloadserver_0_status');
          statusEl.text(' Reloading...');

          $.ajax({
            url: '/api/v1/tenant/reload',
            method: 'POST',
            headers: client.headers(),
            contentType: 'application/json',
            success: function onSuccess () {
              statusEl.text(' Reloaded! Refreshing page...');
              setTimeout(function () {
                window.location.reload();
              }, 3000);
            },
            error: function onError (xhr) {
              if (xhr.status === 403) {
                statusEl.text(' Error: Admin authorization required.');
              } else {
                statusEl.text(' Error: ' + (xhr.responseJSON ? xhr.responseJSON.message : 'reload failed'));
              }
              // Show button again
              $('[plugin=reloadserver][action=0]').css('display', '');
            }
          });
        }
      }
    ]
  };

  return plugin;
}

module.exports = init;
