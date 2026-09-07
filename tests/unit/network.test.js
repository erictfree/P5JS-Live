import { describe, expect, it, vi } from 'vitest';
import { createNetworkManager } from '../../src/network/networkManager.js';
import { StreamRoom } from '../../src/network/streamRoom.js';
import { createTestHost } from './helpers.js';

class FakeSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    this.sent = [];
    FakeSocket.instances.push(this);
  }

  addEventListener(type, listener) {
    const values = this.listeners.get(type) ?? [];
    values.push(listener);
    this.listeners.set(type, values);
  }

  emit(type, value = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(value);
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.emit('open');
  }

  receive(message) {
    this.emit('message', { data: JSON.stringify(message) });
  }

  send(value) {
    this.sent.push(JSON.parse(value));
  }

  close() {
    this.readyState = 3;
    this.emit('close');
  }
}

class FakePeer {
  static instances = [];

  constructor(configuration) {
    this.configuration = configuration;
    this.connectionState = 'new';
    this.remoteDescription = null;
    this.localDescription = null;
    this.tracks = [];
    this.candidates = [];
    FakePeer.instances.push(this);
  }

  addTrack(track, stream) {
    this.tracks.push({ track, stream });
  }

  async createOffer() {
    return { type: 'offer', sdp: 'offer' };
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'answer' };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
  }

  async setRemoteDescription(description) {
    this.remoteDescription = description;
  }

  async addIceCandidate(candidate) {
    this.candidates.push(candidate);
  }

  close() {
    this.connectionState = 'closed';
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setupManager() {
  FakeSocket.instances = [];
  FakePeer.instances = [];
  const video = {
    readyState: 3,
    videoWidth: 640,
    videoHeight: 360,
    srcObject: null,
    play: vi.fn(() => Promise.resolve()),
  };
  const manager = createNetworkManager({
    service: 'ws://example.test/network',
    WebSocketClass: FakeSocket,
    RTCPeerConnectionClass: FakePeer,
    document: { createElement: () => video },
  });
  return { manager, video };
}

describe('network stream objects', () => {
  it('joins a room for discovery without publishing anything', () => {
    const { manager } = setupManager();
    manager.watchRoom({ name: 'Thursday', performer: 'Maya' });
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.receive({ type: 'joined', room: 'Thursday', iceServers: [] });
    expect(manager.snapshot().rooms[0]).toMatchObject({
      name: 'Thursday',
      performer: 'Maya',
      watched: true,
      publishing: [],
      receiving: [],
    });

    expect(manager.unwatchRoom('Thursday')).toBe(true);
    expect(socket.sent).toContainEqual({ type: 'leave', room: 'Thursday' });
    expect(manager.snapshot().rooms).toEqual([]);
  });

  it('exposes StreamRoom as a first-class live-coding API object', () => {
    const host = createTestHost();
    const result = host.evaluator.evaluate(`
      const manager = {
        acquirePublisher() { return { status: "connecting", room: { joined: false } }; },
        releasePublisher() {},
        snapshot() { return { rooms: [] }; },
      };
      const room = new StreamRoom({ name: "Thursday", performer: "Eric", manager });
      const publishMain = room.publish({ name: "main-output" });
      const scene = [publishMain];
      scene.draw();
    `);
    expect(result.ok).toBe(true);
    host.frame(2);
    expect(host.registry.activeOrder()).toEqual(['publishMain']);
    expect(host.registry.getStrategy('publishMain').definition.status).toBe('connecting');
  });

  it('publishes a canvas only while its scene object is active', () => {
    const { manager } = setupManager();
    const room = new StreamRoom({ name: 'Thursday', performer: 'Eric', manager });
    const publisher = room.publish({ name: 'main-output', fps: 24 });
    const track = { stop: vi.fn() };
    const canvas = { captureStream: vi.fn(() => ({ getTracks: () => [track] })) };

    publisher.enter({ canvas });
    const socket = FakeSocket.instances[0];
    expect(manager.snapshot()).toMatchObject({ status: 'connecting' });
    expect(canvas.captureStream).toHaveBeenCalledWith(24);

    socket.open();
    expect(socket.sent[0]).toMatchObject({ type: 'join', room: 'Thursday', performer: 'Eric' });
    socket.receive({ type: 'hello', clientId: 'publisher-client' });
    socket.receive({ type: 'joined', room: 'Thursday', iceServers: [] });
    expect(socket.sent).toContainEqual(expect.objectContaining({
      type: 'publish',
      room: 'Thursday',
      name: 'main-output',
    }));

    publisher.draw({ canvas });
    expect(publisher.status).toBe('publishing');
    publisher.exit();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(socket.sent).toContainEqual(expect.objectContaining({
      type: 'unpublish',
      room: 'Thursday',
    }));
  });

  it('discovers, negotiates, and draws a remote stream', async () => {
    const { manager, video } = setupManager();
    const room = new StreamRoom({ name: 'Thursday', performer: 'Maya', manager });
    const receiver = room.receive({ stream: 'Eric/main-output', fit: 'contain' });

    receiver.enter();
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.receive({ type: 'hello', clientId: 'receiver-client' });
    socket.receive({ type: 'joined', room: 'Thursday', iceServers: [{ urls: 'stun:test' }] });
    socket.receive({
      type: 'streams',
      room: 'Thursday',
      streams: [{
        id: 'publisher-client/main-output',
        name: 'main-output',
        performer: 'Eric',
        label: 'Eric/main-output',
        clientId: 'publisher-client',
      }],
    });

    const subscribe = socket.sent.find((entry) => entry.type === 'subscribe');
    expect(subscribe).toMatchObject({
      room: 'Thursday',
      stream: 'publisher-client/main-output',
    });
    expect(FakePeer.instances[0].configuration).toEqual({
      iceServers: [{ urls: 'stun:test' }],
    });

    socket.receive({
      type: 'signal',
      room: 'Thursday',
      fromClientId: 'publisher-client',
      requestId: subscribe.requestId,
      data: { description: { type: 'offer', sdp: 'remote-offer' } },
    });
    await flush();
    expect(socket.sent).toContainEqual(expect.objectContaining({
      type: 'signal',
      toClientId: 'publisher-client',
      data: { description: { type: 'answer', sdp: 'answer' } },
    }));

    const stream = { getTracks: () => [] };
    FakePeer.instances[0].ontrack({ streams: [stream], track: {} });
    await flush();
    expect(video.srcObject).toBe(stream);
    expect(receiver.status).toBe('waiting');

    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
      globalAlpha: 1,
    };
    receiver.draw({ canvas: { width: 1280, height: 720, getContext: () => context } });
    expect(receiver.status).toBe('live');
    expect(context.drawImage).toHaveBeenCalledWith(video, 0, 0, 1280, 720);
    expect(receiver.texture).toBe(video);

    receiver.exit();
    expect(video.srcObject).toBeNull();
  });

  it('allows a live-replaced publisher to acquire lazily from draw()', () => {
    const manager = {
      acquirePublisher: vi.fn(() => ({ status: 'connecting', room: { joined: false } })),
      releasePublisher: vi.fn(),
      snapshot: () => ({ rooms: [] }),
    };
    const publisher = new StreamRoom({ name: 'room', performer: 'name', manager })
      .publish({ name: 'main' });
    publisher.draw({ canvas: {} });
    expect(manager.acquirePublisher).toHaveBeenCalledOnce();
    publisher.dispose();
    expect(manager.releasePublisher).toHaveBeenCalledOnce();
  });

  it('transfers a compatible publication during live replacement', () => {
    const { manager } = setupManager();
    const room = new StreamRoom({ name: 'Thursday', performer: 'Eric', manager });
    const before = room.publish({ name: 'main-output' });
    const after = room.publish({ name: 'main-output' });
    const track = { stop: vi.fn() };
    const canvas = { captureStream: vi.fn(() => ({ getTracks: () => [track] })) };

    before.enter({ canvas });
    after.draw({ canvas });
    expect(canvas.captureStream).toHaveBeenCalledOnce();

    before.dispose();
    expect(track.stop).not.toHaveBeenCalled();
    after.dispose();
    expect(track.stop).toHaveBeenCalledOnce();
  });
});
