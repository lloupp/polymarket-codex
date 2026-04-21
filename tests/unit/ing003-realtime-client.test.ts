import test from 'node:test';
import assert from 'node:assert/strict';

import { RealtimeClient } from '../../src/ingestion/realtime-client';

class FakeSocket {
  static instances: FakeSocket[] = [];
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onclose: ((event: { code: number }) => void) | null = null;
  public onerror: (() => void) | null = null;
  public sent: string[] = [];
  public closed = false;

  constructor(public readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.closed = true;
  }

  emitOpen() {
    this.onopen?.();
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  emitClose(code = 1006) {
    this.onclose?.({ code });
  }
}

test('ING-003: deve conectar e notificar status connected', async () => {
  FakeSocket.instances = [];
  const statuses: string[] = [];

  const client = new RealtimeClient({
    wsUrl: 'wss://ws.example',
    socketFactory: (url) => new FakeSocket(url),
    reconnectDelaysMs: [0],
    onStatusChange: (status) => statuses.push(status)
  });

  client.connect();
  const socket = FakeSocket.instances[0]!;
  socket.emitOpen();

  assert.equal(statuses.includes('connected'), true);
  assert.equal(socket.url, 'wss://ws.example');

  client.disconnect();
});

test('ING-003: deve reconectar após close inesperado', async () => {
  FakeSocket.instances = [];

  const client = new RealtimeClient({
    wsUrl: 'wss://ws.example',
    socketFactory: (url) => new FakeSocket(url),
    reconnectDelaysMs: [0]
  });

  client.connect();
  const first = FakeSocket.instances[0]!;
  first.emitOpen();
  first.emitClose(1006);

  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(FakeSocket.instances.length, 2);

  client.disconnect();
});

test('ING-003: deve reenviar subscriptions após reconnect', async () => {
  FakeSocket.instances = [];

  const client = new RealtimeClient({
    wsUrl: 'wss://ws.example',
    socketFactory: (url) => new FakeSocket(url),
    reconnectDelaysMs: [0]
  });

  client.connect();
  const first = FakeSocket.instances[0]!;
  first.emitOpen();

  client.subscribe({ type: 'market', market: 'btc-updown' });
  assert.equal(first.sent.length, 1);

  first.emitClose(1006);
  await new Promise((resolve) => setTimeout(resolve, 5));

  const second = FakeSocket.instances[1]!;
  second.emitOpen();

  assert.equal(second.sent.length, 1);
  assert.match(second.sent[0]!, /btc-updown/);

  client.disconnect();
});

test('ING-003: deve encaminhar mensagens recebidas para callback', async () => {
  FakeSocket.instances = [];
  const messages: unknown[] = [];

  const client = new RealtimeClient({
    wsUrl: 'wss://ws.example',
    socketFactory: (url) => new FakeSocket(url),
    reconnectDelaysMs: [0],
    onMessage: (message) => messages.push(message)
  });

  client.connect();
  const socket = FakeSocket.instances[0]!;
  socket.emitOpen();
  socket.emitMessage({ event: 'trade', price: 0.51 });

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], { event: 'trade', price: 0.51 });

  client.disconnect();
});
