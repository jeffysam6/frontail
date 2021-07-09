'use strict';

const cookie = require('cookie');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const SocketIO = require('socket.io');
const fs = require('fs');
const untildify = require('untildify');
const tail = require('./lib/tail');
const connectBuilder = require('./lib/connect_builder');
const program = require('./lib/options_parser');
const serverBuilder = require('./lib/server_builder');
const daemonize = require('./lib/daemonize');
const usageStats = require('./lib/stats');


const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const url = require('url');


var cors = require('cors');


program.parse(process.argv);

/**
 * Init usage statistics
 */
 const stats = usageStats(!program.disableUsageStats, program);
 stats.track('runtime', 'init');
 stats.time('runtime', 'runtime');

const doAuthorization = !!(program.user && program.password);
const doSecure = !!(program.key && program.certificate);
const sessionSecret = String(+new Date()) + Math.random();
var files = program.args.join(' ');
var filesNamespace = crypto.createHash('md5').update(files).digest('hex');
const urlPath = program.urlPath.replace(/\/$/, ''); // remove trailing slash

const appBuilder = connectBuilder(urlPath);

const builder = serverBuilder();

const io = new SocketIO({ path: `${urlPath}/socket.io` });

var tailerObj = {}
var tailerListener = {}


io.on('connection', (socket) => {

          console.info('connected to global socket')

          var ns = url.parse(socket.handshake.url, true).query.ns;

          console.log('connected ns: '+ns)

          if(!(ns in tailerObj)){
            tailerObj[ns] = tail([ns], {
              buffer: program.number,
            });

            tailerObj[ns].on('line', (line) => {
              io.of(`/${ns}`).emit('line', line);
              });
          }

          console.log('current registered namespace',Object.keys(io.nsps))

          io.of(`/${ns}`).on('connection', function (socket) {

            console.info('connected to socket', ns)
            
            socket.emit('welcome',ns)

            socket.emit('options:lines', program.lines);

            if (program.uiHideTopbar) {
              socket.emit('options:hide-topbar');
            }

            if (!program.uiIndent) {
              socket.emit('options:no-indent');
            }

            if (program.uiHighlight) {
              socket.emit('options:highlightConfig', highlightConfig);
            }


            tailerObj[ns].getBuffer().forEach((line) => {
              socket.emit('line', line);
            });

            
          });
  });


if (doSecure) {
  builder.secure(program.key, program.certificate);
}

const corsOpts = {
  origin: '*',

  methods: [
    'GET',
    'POST',
  ],

  allowedHeaders: [
    'Content-Type',
  ],
};

/**
 * Validate params
 */

if (program.daemonize) {
  daemonize(__filename, program, {
    doAuthorization,
    doSecure,
  });
} else {
  /**
   * HTTP(s) server setup
   */
  
  if (doAuthorization) {
    appBuilder.session(sessionSecret);
    appBuilder.authorize(program.user, program.password);
  }
  appBuilder
    .static(path.join(__dirname, 'web', 'assets'))
    .index(
      path.join(__dirname, 'web', 'index.html'),
      files,
      filesNamespace,
      program.theme
    );


  const server = builder
    .use(appBuilder.build())
    .port(program.port)
    .host(program.host)
    .build();

  /**
   * socket.io setup
   */
  io.attach(server);

  if (doAuthorization) {
    io.use((socket, next) => {
      const handshakeData = socket.request;
      if (handshakeData.headers.cookie) {
        const cookies = cookie.parse(handshakeData.headers.cookie);
        const sessionIdEncoded = cookies['connect.sid'];
        if (!sessionIdEncoded) {
          return next(new Error('Session cookie not provided'), false);
        }
        const sessionId = cookieParser.signedCookie(
          sessionIdEncoded,
          sessionSecret
        );
        if (sessionId) {
          return next(null);
        }
        return next(new Error('Invalid cookie'), false);
      }

      return next(new Error('No cookie in header'), false);
    });
  }

  /**
   * Setup UI highlights
   */
  let highlightConfig;
  if (program.uiHighlight) {
    let presetPath;

    if (!program.uiHighlightPreset) {
      presetPath = path.join(__dirname, 'preset', 'default.json');
    } else {
      presetPath = path.resolve(untildify(program.uiHighlightPreset));
    }

    if (fs.existsSync(presetPath)) {
      highlightConfig = JSON.parse(fs.readFileSync(presetPath));
    } else {
      throw new Error(`Preset file ${presetPath} doesn't exists`);
    }
  }

  /**
   * When connected send starting data
   */



  /**
   * Send incoming data
   */


  stats.track('runtime', 'started');

  /**
   * Handle signals
   */
  const cleanExit = () => {
    stats.timeEnd('runtime', 'runtime', () => {
      process.exit();
    });
  };
  process.on('SIGINT', cleanExit);
  process.on('SIGTERM', cleanExit);
}
