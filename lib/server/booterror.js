'use strict';

const express = require('express');
const path = require('path');
var _ = require('lodash');

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function bootError(env, ctx) {

  const app = new express();
  let locals = {};

  app.set('view engine', 'ejs');
  app.engine('html', require('ejs').renderFile);
  app.set("views", path.join(__dirname, "../../views/"));

  app.get('*', (req, res, next) => {

    if (req.url.includes('images')) return next();

    var errors = _.map(ctx.bootErrors, function (obj) {

      let message;

      if (typeof obj.err === 'string' || obj.err instanceof String) {
        message = obj.err;
      } else {
        message = JSON.stringify(_.pick(obj.err, Object.getOwnPropertyNames(obj.err)));
      }
      return '<dt><b>' + escapeHtml(obj.desc) + '</b></dt><dd>' + escapeHtml(message).replace(/\\n/g, '<br/>') + '</dd>';
    }).join(' ');

    // Add retry notice and auto-refresh so page recovers when MongoDB reconnects
    errors += '<dt><b>Retrying...</b></dt><dd>Nightscout is still trying to connect to MongoDB in the background. This page will auto-refresh in 30 seconds.</dd>';

    res.set('Refresh', '30');
    res.status(500).render('error.html', {
      errors,
      locals
    });

  });

  app.setLocals = function (_locals) {
    locals = _locals;
  }

  return app;
}

module.exports = bootError;