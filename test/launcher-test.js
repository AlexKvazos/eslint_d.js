/*eslint-env mocha*/
'use strict';

const net = require('net');
const crypto = require('crypto');
const EventEmitter = require('events');
const child_process = require('child_process');
const { assert, refute, sinon } = require('@sinonjs/referee-sinon');
const out = require('../lib/out');
const launcher = require('../lib/launcher');
const portfile = require('../lib/portfile');

const daemon = require.resolve('../lib/daemon');
const token = crypto.randomBytes(8).toString('hex');

describe('launcher', () => {
  let clock;
  let child;
  let socket;
  let callback;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    child = { unref: sinon.fake() };
    sinon.replace(child_process, 'spawn', sinon.fake.returns(child));
    socket = new EventEmitter();
    socket.end = sinon.fake();
    callback = sinon.spy();
  });

  afterEach(() => {
    sinon.restore();
    delete process.exitCode;
  });

  it('launches child process', () => {
    sinon.replace(portfile, 'read', sinon.fake.yields(null));
    const callback = sinon.spy();

    launcher.launch(callback);

    assert.calledOnceWith(child_process.spawn, 'node', [daemon], {
      detached: true,
      env: sinon.match({
        FORCE_COLOR: 1
      }),
      stdio: ['ignore', 'ignore', 'ignore']
    });
    assert.calledOnce(child.unref);
    assert.calledOnce(portfile.read);
    refute.called(callback);
  });

  function launch() {
    sinon.stub(portfile, 'read').yields(null);

    launcher.launch(callback);

    portfile.read.yields({ port: 7654, token });
    return sinon.replace(net, 'connect', sinon.fake.returns(socket));
  }

  it('checks if portfile exists after delay and attempts to connect', () => {
    const connect = launch();
    clock.tick(100);

    assert.calledTwice(portfile.read);
    assert.calledOnceWith(connect, 7654, '127.0.0.1', sinon.match.func);
    refute.called(callback);
  });

  it('yields (null, socket, token) once connected', () => {
    const connect = launch();
    clock.tick(100);

    connect.firstCall.callback();

    assert.calledOnceWith(callback, null, socket, token);
  });

  it('retries every 100 milliseconds if port file is still missing', () => {
    sinon.replace(portfile, 'read', sinon.fake.yields(null));

    launcher.launch(callback);
    clock.tick(100);
    clock.tick(100);

    assert.calledThrice(portfile.read);
    refute.called(callback);
  });

  it('retries every 100 milliseconds if connection fails', () => {
    launch();
    clock.tick(100); // initial check

    socket.emit('error', new Error());
    clock.tick(100); // retry timeout

    assert.calledThrice(portfile.read);
    refute.called(callback);

    socket.emit('error', new Error());
    clock.tick(100); // retry timeout

    assert.callCount(portfile.read, 4);
    refute.called(callback);
  });

  it('prints message and does not invoke callback if already running', () => {
    sinon.replace(portfile, 'read', sinon.fake.yields({ port: 7654, token }));
    sinon.replace(out, 'write', sinon.fake());
    const connect = sinon.replace(net, 'connect', sinon.fake.returns(socket));

    launcher.launch(callback);
    connect.firstCall.callback();

    assert.calledOnceWith(out.write, 'Already running\n');
    refute.called(callback);
  });

});
