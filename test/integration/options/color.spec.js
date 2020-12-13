'use strict';

var path = require('path').posix;
var helpers = require('../helpers');
var runMochaJSON = helpers.runMochaJSON;

describe('--color', function() {
  it('should print color output', function(done) {
    var args = ['--color'];
    var fixture = path.join('options', 'color');
    runMochaJSON(fixture, args, function(err, res) {
      if (err) {
        return done(err);
      }

      done();
    });
  });
});
