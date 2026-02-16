'use strict;'

function clearRequireCache () {
  Object.keys(require.cache).forEach(function(key) {
    delete require.cache[key];
  });
}

function clearAllTimers () {
  // Clear all intervals and timeouts to prevent timer leaks between tests
  // This prevents "window is not defined" errors when client timers
  // fire after benv tests end
  var maxId = setTimeout(function(){}, 0);
  console.log('Clearing timers up to ID:', maxId);
  for (var i = 1; i <= maxId; i++) {
    clearTimeout(i);
    clearInterval(i);
  }
}

exports.mochaHooks = {
  afterEach (done) {
    clearAllTimers();
    clearRequireCache();
    done();
  }
};
