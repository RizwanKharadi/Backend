/**
 * Handlers must act on the socket that fired, not on whichever socket is
 * current.
 *
 * A reconnect replaces `this.ws` while the previous socket can still deliver
 * events. The ping handler used to answer with `this.ws.pong()`, so it pongued
 * the *new* socket — which is still CONNECTING — and ws threw "WebSocket is not
 * open: readyState 0 (CONNECTING)" from inside its receiver, nowhere near a
 * try/catch and not an 'error' event. It surfaced as an uncaught exception 281
 * times in a single day of reconnect churn.
 *
 * The same staleness made an abandoned socket's close handler schedule its own
 * reconnect and log its own "Disconnected from server", multiplying the churn
 * that caused it.
 */
const EventEmitter = require('events');
const WebSocket = require('ws');
const WebSocketClient = require('../WebSocketClient');

/** Mimics ws: pong() throws unless the socket is open. */
class FakeSocket extends EventEmitter {
  constructor(readyState = WebSocket.OPEN) {
    super();
    this.readyState = readyState;
    this.pongCount = 0;
  }

  pong() {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error(`WebSocket is not open: readyState ${this.readyState} (CONNECTING)`);
    }
    this.pongCount += 1;
  }

  ping() {}
  close() {}
  terminate() {}
}

const clientWith = (socket) => {
  const client = new WebSocketClient();
  client.ws = socket;
  client.setupEventHandlers();
  return client;
};

describe('events from a superseded socket', () => {
  test('a ping on the old socket does not throw once a new one has taken over', () => {
    const oldSocket = new FakeSocket(WebSocket.OPEN);
    const client = clientWith(oldSocket);

    // Reconnect: a new socket takes over while still connecting.
    client.ws = new FakeSocket(WebSocket.CONNECTING);

    expect(() => oldSocket.emit('ping')).not.toThrow();
  });

  test('the pong goes to the socket that was pinged', () => {
    const socket = new FakeSocket(WebSocket.OPEN);
    clientWith(socket);

    socket.emit('ping');

    expect(socket.pongCount).toBe(1);
  });

  test('a ping on a socket that has since closed is ignored, not thrown', () => {
    const socket = new FakeSocket(WebSocket.OPEN);
    clientWith(socket);
    socket.readyState = WebSocket.CLOSING;

    expect(() => socket.emit('ping')).not.toThrow();
    expect(socket.pongCount).toBe(0);
  });

  test('an abandoned socket closing does not schedule a competing reconnect', () => {
    const oldSocket = new FakeSocket(WebSocket.OPEN);
    const client = clientWith(oldSocket);
    client.scheduleReconnect = jest.fn();
    client.isConnected = true;

    client.ws = new FakeSocket(WebSocket.CONNECTING);
    oldSocket.emit('close', 1006, '');

    expect(client.scheduleReconnect).not.toHaveBeenCalled();
    // The live socket's state must not be trampled by the dead one.
    expect(client.isConnected).toBe(true);
  });

  test('the live socket closing still reconnects', () => {
    const socket = new FakeSocket(WebSocket.OPEN);
    const client = clientWith(socket);
    client.scheduleReconnect = jest.fn();
    client.isConnected = true;

    socket.emit('close', 1006, '');

    expect(client.scheduleReconnect).toHaveBeenCalled();
    expect(client.isConnected).toBe(false);
  });

  test('an error from an abandoned socket does not overwrite the live status', () => {
    const oldSocket = new FakeSocket(WebSocket.OPEN);
    const client = clientWith(oldSocket);
    client.lastConnectionError = null;

    client.ws = new FakeSocket(WebSocket.CONNECTING);
    oldSocket.emit('error', new Error('stale socket blew up'));

    expect(client.lastConnectionError).toBeNull();
  });
});
