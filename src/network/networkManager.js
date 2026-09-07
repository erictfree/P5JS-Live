// Persistent browser networking for rendered visual streams.
//
// Scene objects are deliberately thin handles. This manager owns the one signaling
// socket, room membership, canvas capture streams, RTCPeerConnections, and remote
// media elements so live-replacing an object does not rebuild plumbing every frame.

const DEFAULT_PATH = '/network';
const RECONNECT_MAX_MS = 10_000;

const randomId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

function defaultServiceUrl(location_ = globalThis.location) {
  if (!location_) return `ws://localhost:5173${DEFAULT_PATH}`;
  const protocol = location_.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location_.host}${DEFAULT_PATH}`;
}

function publicStream(entry) {
  return {
    id: entry.id,
    name: entry.name,
    performer: entry.performer,
    label: entry.label,
    local: Boolean(entry.local),
  };
}

function asCanvas(value) {
  return value?.elt ?? value?.canvas ?? value;
}

function fitRect(sourceWidth, sourceHeight, targetWidth, targetHeight, fit) {
  if (fit === 'stretch') return [0, 0, targetWidth, targetHeight];
  if (!(sourceWidth > 0 && sourceHeight > 0)) return [0, 0, targetWidth, targetHeight];
  const scale = fit === 'contain'
    ? Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight)
    : Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return [(targetWidth - width) / 2, (targetHeight - height) / 2, width, height];
}

function createRemoteMedia(document_ = globalThis.document) {
  // A p5.MediaElement can be passed straight to p5 shader uniforms. Fall back to a
  // raw video element for tests and hosts that use the network module without p5.
  if (typeof globalThis.createVideo === 'function') {
    const media = globalThis.createVideo([]);
    media.hide();
    media.elt.autoplay = true;
    media.elt.muted = true;
    media.elt.playsInline = true;
    return { media, video: media.elt };
  }
  const video = document_?.createElement?.('video') ?? null;
  if (video) {
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
  }
  return { media: video, video };
}

function stopStream(stream) {
  for (const track of stream?.getTracks?.() ?? []) track.stop();
}

function closePeer(peer) {
  try {
    peer?.close?.();
  } catch {
    // Closing is best-effort during replacement, disconnect, and page teardown.
  }
}

export function createNetworkManager({
  service = defaultServiceUrl(),
  WebSocketClass = globalThis.WebSocket,
  RTCPeerConnectionClass = globalThis.RTCPeerConnection,
  document: document_ = globalThis.document,
  setTimeout: setTimeout_ = globalThis.setTimeout,
  clearTimeout: clearTimeout_ = globalThis.clearTimeout,
} = {}) {
  const listeners = new Set();
  const rooms = new Map();
  const publications = new Map();
  const remotes = new Map();
  const watchedRooms = new Map();
  const publisherPeers = new Map();
  const pendingMessages = [];
  let socket = null;
  let socketState = 'offline';
  let clientId = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let intentionallyClosed = false;

  const notify = () => {
    for (const listener of listeners) listener(snapshot());
  };

  const publicationKey = (room, id) => `${room.name}\u0000${id}`;
  const publisherPeerKey = (room, client, request) =>
    `${room.name}\u0000${client}\u0000${request}`;

  function roomKey(config) {
    return config.name.trim();
  }

  function ensureRoom(config) {
    const name = roomKey(config);
    if (!name) throw new TypeError('StreamRoom needs a non-empty name');
    const performer = String(config.performer ?? '').trim();
    if (!performer) throw new TypeError('StreamRoom needs a non-empty performer name');
    const existing = rooms.get(name);
    if (existing) {
      existing.performer = performer;
      existing.token = config.token ?? existing.token;
      existing.iceServers = config.iceServers ?? existing.iceServers;
      return existing;
    }
    const room = {
      name,
      performer,
      token: config.token ?? null,
      iceServers: config.iceServers ?? null,
      joined: false,
      refs: 0,
      streams: new Map(),
    };
    rooms.set(name, room);
    return room;
  }

  function retainRoom(config) {
    const room = ensureRoom(config);
    room.refs += 1;
    connect();
    if (socketState === 'online') join(room);
    return room;
  }

  function releaseRoom(room) {
    room.refs = Math.max(0, room.refs - 1);
    if (room.refs > 0) return;
    send({ type: 'leave', room: room.name });
    rooms.delete(room.name);
    notify();
    if (rooms.size === 0) disconnect();
  }

  function watchRoom(config) {
    const name = roomKey(config);
    const existing = watchedRooms.get(name);
    if (existing) {
      ensureRoom(config);
      if (socketState === 'online') join(existing);
      notify();
      return existing;
    }
    const room = retainRoom(config);
    watchedRooms.set(name, room);
    notify();
    return room;
  }

  function unwatchRoom(name) {
    const room = watchedRooms.get(name);
    if (!room) return false;
    watchedRooms.delete(name);
    releaseRoom(room);
    notify();
    return true;
  }

  function connect() {
    if (socket || intentionallyClosed || typeof WebSocketClass !== 'function') {
      if (typeof WebSocketClass !== 'function' && rooms.size) {
        socketState = 'unsupported';
        notify();
      }
      return;
    }
    socketState = reconnectAttempt ? 'reconnecting' : 'connecting';
    notify();
    try {
      socket = new WebSocketClass(service);
    } catch {
      socket = null;
      scheduleReconnect();
      return;
    }
    socket.addEventListener('open', () => {
      socketState = 'online';
      reconnectAttempt = 0;
      for (const room of rooms.values()) join(room);
      while (pendingMessages.length) send(pendingMessages.shift());
      notify();
    });
    socket.addEventListener('message', (event) => {
      try {
        handleMessage(JSON.parse(String(event.data)));
      } catch {
        // Invalid signaling input is ignored; the media loop must remain alive.
      }
    });
    socket.addEventListener('close', () => {
      socket = null;
      clientId = null;
      for (const room of rooms.values()) room.joined = false;
      for (const publication of publications.values()) publication.status = 'connecting';
      if (!intentionallyClosed && rooms.size) scheduleReconnect();
      else socketState = 'offline';
      notify();
    });
    socket.addEventListener('error', () => {
      // close drives reconnect and exposes one stable status to the UI.
    });
  }

  function disconnect() {
    intentionallyClosed = true;
    if (reconnectTimer !== null) clearTimeout_?.(reconnectTimer);
    reconnectTimer = null;
    socket?.close?.();
    socket = null;
    socketState = 'offline';
    intentionallyClosed = false;
  }

  function scheduleReconnect() {
    if (reconnectTimer !== null || intentionallyClosed || !rooms.size) return;
    socketState = 'reconnecting';
    const delay = Math.min(500 * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout_?.(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function send(message, { queue = false } = {}) {
    if (socket?.readyState === WebSocketClass?.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    if (queue) pendingMessages.push(message);
    return false;
  }

  function join(room) {
    send({
      type: 'join',
      room: room.name,
      performer: room.performer,
      token: room.token,
    });
  }

  function advertise(publication) {
    if (!publication.room.joined) return;
    send({
      type: 'publish',
      room: publication.room.name,
      publicationId: publication.id,
      name: publication.name,
    });
  }

  function handleMessage(message) {
    if (message.type === 'hello') {
      clientId = message.clientId;
      notify();
      return;
    }
    const room = rooms.get(message.room);
    if (!room) return;
    if (message.type === 'joined') {
      room.joined = true;
      room.error = null;
      if (Array.isArray(message.iceServers) && room.iceServers === null) {
        room.iceServers = message.iceServers;
      }
      for (const publication of publications.values()) {
        if (publication.room !== room) continue;
        publication.status = 'publishing';
        advertise(publication);
      }
      notify();
      return;
    }
    if (message.type === 'streams') {
      room.streams = new Map((message.streams ?? []).map((entry) => [entry.id, entry]));
      for (const remote of remotes.values()) {
        if (remote.room !== room) continue;
        const available = findStream(room, remote.wanted);
        remote.streamInfo = available ?? null;
        if (
          available &&
          (
            !remote.peer ||
            remote.connectedStreamId !== available.id ||
            remote.status === 'stalled' ||
            remote.status === 'waiting'
          )
        ) {
          subscribeRemote(remote, available);
        } else if (!available && remote.status !== 'connecting') {
          remote.status = 'waiting';
        }
      }
      notify();
      return;
    }
    if (message.type === 'subscriber') {
      const publication = publications.get(publicationKey(room, message.publicationId));
      if (publication?.room === room) createPublisherPeer(publication, message);
      return;
    }
    if (message.type === 'signal') {
      routeSignal(room, message);
      return;
    }
    if (message.type === 'error') {
      room.error = message.message;
      notify();
    }
  }

  function findStream(room, wanted) {
    for (const entry of room.streams.values()) {
      if (entry.id === wanted || entry.label === wanted) return entry;
    }
    return null;
  }

  function peerConfiguration(room) {
    return { iceServers: room.iceServers ?? [] };
  }

  function makePeer(room) {
    if (typeof RTCPeerConnectionClass !== 'function') {
      throw new Error('WebRTC is not available in this browser');
    }
    return new RTCPeerConnectionClass(peerConfiguration(room));
  }

  async function createPublisherPeer(publication, request) {
    const key = publisherPeerKey(publication.room, request.fromClientId, request.requestId);
    closePeer(publisherPeers.get(key)?.peer);
    let peer;
    try {
      peer = makePeer(publication.room);
      for (const track of publication.stream.getTracks()) peer.addTrack(track, publication.stream);
      const state = {
        role: 'publisher',
        peer,
        room: publication.room,
        remoteClientId: request.fromClientId,
        requestId: request.requestId,
        publication,
        candidates: [],
      };
      publisherPeers.set(key, state);
      peer.onicecandidate = ({ candidate }) => {
        if (candidate) signal(state, { candidate });
      };
      peer.onconnectionstatechange = () => {
        if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
          publisherPeers.delete(key);
          closePeer(peer);
          notify();
        }
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      signal(state, { description: peer.localDescription });
      notify();
    } catch {
      closePeer(peer);
    }
  }

  function subscribeRemote(remote, streamInfo) {
    closePeer(remote.peer);
    remote.peer = null;
    remote.connectedStreamId = streamInfo.id;
    remote.requestId = randomId();
    remote.status = 'connecting';
    remote.candidates = [];
    try {
      const peer = makePeer(remote.room);
      remote.peer = peer;
      peer.onicecandidate = ({ candidate }) => {
        if (candidate && remote.ownerClientId) signal(remote, { candidate });
      };
      peer.ontrack = (event) => {
        const stream = event.streams?.[0] ?? new MediaStream([event.track]);
        remote.stream = stream;
        if (remote.video) {
          remote.video.srcObject = stream;
          remote.video.play?.().catch?.(() => {});
        }
        remote.status = 'live';
        notify();
      };
      peer.onconnectionstatechange = () => {
        const state = peer.connectionState;
        if (state === 'connected') remote.status = 'live';
        else if (['failed', 'closed', 'disconnected'].includes(state)) remote.status = 'stalled';
        notify();
      };
      send({
        type: 'subscribe',
        room: remote.room.name,
        stream: streamInfo.id,
        requestId: remote.requestId,
      });
    } catch (error) {
      remote.status = 'unsupported';
      remote.error = error.message;
      notify();
    }
  }

  function routeSignal(room, message) {
    const publisher = publisherPeers.get(
      publisherPeerKey(room, message.fromClientId, message.requestId),
    );
    if (publisher?.room === room) {
      acceptSignal(publisher, message.data);
      return;
    }
    for (const remote of remotes.values()) {
      if (remote.room !== room || remote.requestId !== message.requestId) continue;
      remote.ownerClientId = message.fromClientId;
      acceptSignal(remote, message.data);
      return;
    }
  }

  async function acceptSignal(state, data) {
    const peer = state.peer;
    if (!peer) return;
    try {
      if (data.description) {
        await peer.setRemoteDescription(data.description);
        for (const candidate of state.candidates.splice(0)) await peer.addIceCandidate(candidate);
        if (data.description.type === 'offer') {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          signal(state, { description: peer.localDescription });
        }
      } else if (data.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(data.candidate);
        else state.candidates.push(data.candidate);
      }
    } catch (error) {
      state.status = 'stalled';
      state.error = error.message;
      notify();
    }
  }

  function signal(state, data) {
    send({
      type: 'signal',
      room: state.room.name,
      toClientId: state.remoteClientId ?? state.ownerClientId,
      requestId: state.requestId,
      data,
    });
  }

  function acquirePublisher(config, inputs) {
    const room = retainRoom(config.room);
    const id = config.id;
    const key = publicationKey(room, id);
    const previous = publications.get(key);
    let source;
    let stream;
    try {
      source = asCanvas(typeof config.source === 'function' ? config.source(inputs) : config.source)
        ?? asCanvas(inputs.canvas);
      if (typeof source?.captureStream !== 'function') {
        throw new Error('The selected source cannot be captured as a canvas stream');
      }
      // Normal live replacement creates a new scene object around the same final
      // canvas. Transfer ownership of the existing capture/peers instead of making
      // every receiver renegotiate because source text changed.
      if (previous?.source === source && previous.fps === config.fps) {
        previous.owner = config.owner;
        previous.name = config.name;
        previous.status = room.joined ? 'publishing' : 'connecting';
        advertise(previous);
        releaseRoom(room);
        notify();
        return previous;
      }
      stream = source.captureStream(config.fps);
    } catch (error) {
      releaseRoom(room);
      throw error;
    }
    const publication = {
      id,
      name: config.name,
      owner: config.owner,
      room,
      source,
      stream,
      fps: config.fps,
      status: room.joined ? 'publishing' : 'connecting',
    };
    if (previous) {
      send({ type: 'unpublish', room: previous.room.name, publicationId: previous.id });
      for (const [peerKey, state] of publisherPeers) {
        if (state.publication !== previous) continue;
        closePeer(state.peer);
        publisherPeers.delete(peerKey);
      }
      stopStream(previous.stream);
      releaseRoom(previous.room);
    }
    publications.set(key, publication);
    advertise(publication);
    notify();
    return publication;
  }

  function releasePublisher(handle, owner) {
    if (!handle || publications.get(publicationKey(handle.room, handle.id))?.owner !== owner) return;
    publications.delete(publicationKey(handle.room, handle.id));
    send({ type: 'unpublish', room: handle.room.name, publicationId: handle.id });
    stopStream(handle.stream);
    for (const [key, state] of publisherPeers) {
      if (state.publication !== handle) continue;
      closePeer(state.peer);
      publisherPeers.delete(key);
    }
    releaseRoom(handle.room);
    notify();
  }

  function acquireReceiver(config) {
    const room = retainRoom(config.room);
    const key = `${room.name}\u0000${config.stream}`;
    let remote = remotes.get(key);
    if (!remote) {
      const { media, video } = createRemoteMedia(document_);
      remote = {
        key,
        room,
        wanted: config.stream,
        media,
        video,
        stream: null,
        streamInfo: null,
        peer: null,
        requestId: null,
        connectedStreamId: null,
        ownerClientId: null,
        owners: new Set(),
        candidates: [],
        status: 'waiting',
        error: null,
      };
      remotes.set(key, remote);
      const available = findStream(room, remote.wanted);
      if (available) {
        remote.streamInfo = available;
        subscribeRemote(remote, available);
      }
    } else {
      // The remote already retains this room; balance the temporary retain above.
      releaseRoom(room);
    }
    remote.owners.add(config.owner);
    notify();
    return remote;
  }

  function releaseReceiver(remote, owner) {
    if (!remote) return;
    remote.owners.delete(owner);
    if (remote.owners.size) return;
    remotes.delete(remote.key);
    closePeer(remote.peer);
    stopStream(remote.stream);
    if (remote.video) remote.video.srcObject = null;
    remote.media?.remove?.();
    releaseRoom(remote.room);
    notify();
  }

  function drawReceiver(remote, inputs, { fit = 'cover', opacity = 1 } = {}) {
    const video = remote?.video;
    const canvas = asCanvas(inputs.canvas);
    if (!video || !canvas || remote.status !== 'live' || video.readyState < 2) return false;
    const context = canvas.getContext?.('2d');
    if (!context) return false;
    const [x, y, width, height] = fitRect(
      video.videoWidth,
      video.videoHeight,
      canvas.width,
      canvas.height,
      fit,
    );
    context.save();
    context.globalAlpha = Math.max(0, Math.min(1, opacity));
    context.drawImage(video, x, y, width, height);
    context.restore();
    return true;
  }

  function snapshot() {
    return Object.freeze({
      service,
      status: socketState,
      clientId,
      rooms: [...rooms.values()].map((room) => ({
        name: room.name,
        performer: room.performer,
        status: room.error ? 'error' : room.joined ? 'joined' : socketState,
        watched: watchedRooms.get(room.name) === room,
        error: room.error ?? null,
        streams: [...room.streams.values()].map((entry) => publicStream({
          ...entry,
          local: entry.clientId === clientId,
        })),
        publishing: [...publications.values()]
          .filter((entry) => entry.room === room)
          .map((entry) => ({ name: entry.name, fps: entry.fps, status: entry.status })),
        receiving: [...remotes.values()]
          .filter((entry) => entry.room === room)
          .map((entry) => ({
            stream: entry.wanted,
            status: entry.status,
            error: entry.error,
          })),
      })),
    });
  }

  function dispose() {
    for (const publication of [...publications.values()]) {
      releasePublisher(publication, publication.owner);
    }
    for (const remote of [...remotes.values()]) {
      for (const owner of [...remote.owners]) releaseReceiver(remote, owner);
    }
    for (const name of [...watchedRooms.keys()]) unwatchRoom(name);
    disconnect();
    listeners.clear();
  }

  return {
    acquirePublisher,
    releasePublisher,
    acquireReceiver,
    releaseReceiver,
    drawReceiver,
    watchRoom,
    unwatchRoom,
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose,
  };
}

let defaultManager = null;

export function getDefaultNetworkManager() {
  if (!defaultManager) defaultManager = createNetworkManager();
  return defaultManager;
}
