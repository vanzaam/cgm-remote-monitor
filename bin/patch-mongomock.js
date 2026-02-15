#!/usr/bin/env node
'use strict';

// Patch mongomock to work with bson 6.x where ObjectID was renamed to ObjectId
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_modules', 'mongomock', 'util', 'index.js');

try {
  if (!fs.existsSync(filePath)) {
    // mongomock not installed, skip
    process.exit(0);
  }

  let content = fs.readFileSync(filePath, 'utf8');

  if (content.includes('var ObjectID = bson.ObjectID;')) {
    content = content.replace(
      'var ObjectID = bson.ObjectID;',
      'var ObjectID = bson.ObjectId || bson.ObjectID;'
    );
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Patched mongomock for bson 6.x compatibility');
  }
} catch (err) {
  console.warn('Warning: Could not patch mongomock:', err.message);
}
