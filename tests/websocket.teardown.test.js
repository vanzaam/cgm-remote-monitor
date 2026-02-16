'use strict';

var should = require('should');

describe('WebSocket teardown', function () {
  var env = require('../lib/server/env')();
  
  it('should disconnect all sockets on teardown event (Socket.IO v4 compatibility)', function (done) {
    this.timeout(10000);
    
    var ctx = {
      bus: require('../lib/bus')(env.settings, {}),
      authorization: {
        resolve: function mockResolve(opts, callback) {
          callback(null, { shiros: [] });
        },
        checkMultiple: function mockCheck() {
          return true;
        }
      },
      ddata: {
        lastUpdated: Date.now(),
        lastProfileFromSwitch: null,
        clone: function() {
          return {
            lastUpdated: this.lastUpdated,
            lastProfileFromSwitch: this.lastProfileFromSwitch
          };
        }
      },
      plugins: {
        extendedClientSettings: function() { return {}; }
      },
      notifications: {
        findHighestAlarm: function() { return null; }
      }
    };
    
    var http = require('http');
    var server = http.createServer();
    
    // Initialize websocket - it automatically calls start() internally
    require('../lib/server/websocket')(env, ctx, server);
    
    server.listen(0, function() {
      var port = server.address().port;
      
      // Create Socket.IO client connections
      var io = require('socket.io-client');
      var socket1 = io('http://localhost:' + port, {
        transports: ['websocket'],
        reconnection: false
      });
      var socket2 = io('http://localhost:' + port, {
        transports: ['websocket'],
        reconnection: false
      });
      
      var connectedCount = 0;
      var disconnectedCount = 0;
      
      function checkConnected() {
        connectedCount++;
        if (connectedCount === 2) {
          // Both clients connected, now trigger teardown
          setTimeout(function() {
            ctx.bus.emit('teardown');
          }, 100);
        }
      }
      
      function checkDisconnected() {
        disconnectedCount++;
        if (disconnectedCount === 2) {
          // Both clients disconnected successfully
          server.close(function() {
            done();
          });
        }
      }
      
      socket1.on('connect', checkConnected);
      socket2.on('connect', checkConnected);
      
      socket1.on('disconnect', checkDisconnected);
      socket2.on('disconnect', checkDisconnected);
      
      socket1.on('connect_error', function(err) {
        done(new Error('Socket 1 connection error: ' + err));
      });
      
      socket2.on('connect_error', function(err) {
        done(new Error('Socket 2 connection error: ' + err));
      });
    });
  });
  
  it('should handle teardown with no connected sockets', function (done) {
    var ctx = {
      bus: require('../lib/bus')(env.settings, {}),
      authorization: {
        resolve: function mockResolve(opts, callback) {
          callback(null, { shiros: [] });
        },
        checkMultiple: function mockCheck() {
          return true;
        }
      },
      ddata: {
        lastUpdated: Date.now(),
        lastProfileFromSwitch: null,
        clone: function() {
          return {
            lastUpdated: this.lastUpdated,
            lastProfileFromSwitch: this.lastProfileFromSwitch
          };
        }
      },
      plugins: {
        extendedClientSettings: function() { return {}; }
      },
      notifications: {
        findHighestAlarm: function() { return null; }
      }
    };
    
    var http = require('http');
    var server = http.createServer();
    
    // Initialize websocket - it automatically calls start() internally
    require('../lib/server/websocket')(env, ctx, server);
    
    server.listen(0, function() {
      // Trigger teardown immediately without any connected clients
      setTimeout(function() {
        ctx.bus.emit('teardown');
        
        // Give it time to process
        setTimeout(function() {
          server.close(function() {
            done();
          });
        }, 100);
      }, 100);
    });
  });
});
