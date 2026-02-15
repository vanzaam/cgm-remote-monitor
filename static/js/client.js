'use strict';

// Wait for jQuery (may load in async chunk after bundle.app.js)
function initClient() {
	if (typeof window.$ === 'undefined' && typeof window.jQuery === 'undefined') {
		setTimeout(initClient, 50);
		return;
	}
	var $ = window.jQuery || window.$;
	$(document).on('online', function() {
		console.log('Application got online event, reloading');
		window.location.reload();
	});
	$(document).ready(function() {
		console.log('Application got ready event');
		window.Nightscout.client.init();
	});
}
initClient();