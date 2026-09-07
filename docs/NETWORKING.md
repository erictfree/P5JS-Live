# Networked visual streams (beta)

Status: **disabled**. The beta implementation remains in the codebase for development
and local testing, but the Network panel is not currently available to users.

p5js live shares canvas video, not source code or local audio. Each performer keeps an
independent editor, scene, audio input, and patch state.

## Quick test on one computer

Start p5js live:

```sh
npm run dev
```

Open two independent browser origins so each gets separate local project storage:

- `http://localhost:5173/live/`
- `http://127.0.0.1:5173/live/`

Use the same room name and a different performer name in each window.

## Publish the canvas

Create a room and a publisher patch:

```js
// %% patch publishMain
const room = new StreamRoom({
  name: "AudioPixel-Thursday",
  performer: "Eric",
});

const publishMain = room.publish({
  name: "main-output",
  fps: 30,
});
```

Place the publisher after the output it should capture:

```js
const scene = [
  waveScope,
  laserFan,
  plasma,
  publishMain,
];

scene.draw();
```

With no `source` option, the publisher captures the final p5js live canvas. It starts
only while `publishMain` is active. The Network panel lists it as
`Eric/main-output`.

## Receive a stream

### From the Network panel

1. Open **Network**.
2. Enter the same room name and your own performer name.
3. Select **Join for discovery**.
4. Select **Add receiver** beside the remote stream.

p5js live inserts a configured receiver patch, adds it to the scene, and activates the
updated scene. A repeated click reuses the existing receiver source.

Joining for discovery does not publish your canvas.

### From editable source

Install `networkReceiver` from **Library → Utilities**, then edit its room, local
performer, and remote stream:

```js
// %% patch networkReceiver
const receiverRoom = new StreamRoom({
  name: "AudioPixel-Thursday",
  performer: "Maya",
});

const networkReceiver = receiverRoom.receive({
  stream: "Eric/main-output",
  fit: "cover",
  opacity: 1,
});
```

Add `networkReceiver` to the scene and evaluate its patch and scene cells.

## `StreamRoom` API

```js
const room = new StreamRoom({
  name,          // required room name
  performer,     // required local display name
  token,         // optional deployment credential
  iceServers,    // optional RTCPeerConnection override
});
```

Constructing `StreamRoom` does not connect. A socket is retained while one of its
publisher or receiver patches is active. The Network panel can also retain a room
for discovery until **Leave** is selected.

### `room.publish(options)`

```js
const output = room.publish({
  name: "main-output",       // required
  fps: 30,                   // 1–60; default 30
  source: ({ canvas }) => canvas,
});
```

`source` is optional. It may return the main p5 renderer, an `HTMLCanvasElement`, or
another surface with `captureStream()`. p5js live cannot isolate pixels from an
arbitrary global-mode patch unless that patch owns a render surface.

Publisher status is `idle`, `connecting`, `publishing`, or `error`.

### `room.receive(options)`

```js
const remote = room.receive({
  stream: "Eric/main-output", // discovered label or stable stream ID
  fit: "cover",               // cover, contain, or stretch
  opacity: 1,                 // 0–1
});
```

The receiver exposes:

- `status`: `idle`, `waiting`, `connecting`, `live`, `stalled`, or `unsupported`;
- `video`: the acquired `HTMLVideoElement`;
- `texture`: a stable p5 media source, or the video element when p5 is unavailable.

Use the texture in a custom WebGL patch without drawing the receiver itself:

```js
const remoteLens = {
  draw() {
    if (!networkReceiver.texture) return;
    myShader.setUniform("uRemote", networkReceiver.texture);
    shader(myShader);
    rect(-width / 2, -height / 2, width, height);
  },
};
```

`ShaderChain` currently has one input. Use a custom WebGL patch for multiple texture
sources.

## Runtime

`src/network/networkManager.js` owns:

- the signaling WebSocket;
- room membership and stream discovery;
- canvas capture tracks and remote media elements;
- one WebRTC peer connection per publisher/subscriber pair;
- reconnect and cleanup.

Publisher and receiver patches hold handles into this service. Network handles are
not stored in patch state, Safe State, or project JSON.

`scripts/signaling-server.mjs` handles only the control plane:

1. clients join a room;
2. publishers advertise streams;
3. subscribers select a stream;
4. the server forwards WebRTC offers, answers, and ICE candidates within that room;
5. disconnect removes the member's publications.

Video travels peer-to-peer when possible. A configured TURN server relays encrypted
media when a direct route fails. The signaling service does not receive video,
audio, source, project files, or diagnostics.

## Deployment

Local tabs or machines that can form a direct route need no extra configuration. A
production or campus deployment should provide STUN and TURN servers:

```sh
P5JS_LIVE_ICE_SERVERS='[
  {"urls":"stun:stun.example.edu:3478"},
  {
    "urls":"turn:turn.example.edu:3478",
    "username":"p5js-live",
    "credential":"replace-me"
  }
]' npm run dev
```

The value must be a JSON array accepted by `RTCPeerConnection` as `iceServers`. It is
sent to clients after they join. Use short-lived TURN credentials or deployment
secrets; do not commit durable credentials.

An optional shared room credential is available for private tests:

```sh
P5JS_LIVE_NETWORK_TOKEN='rehearsal-invite' npm run dev
```

Pass the same value as `token` to `StreamRoom`. This is not user authentication. The
token appears in editable source, browser storage, and exports, so use a disposable
invite. Public deployments need identity, per-room authorization, rate limiting,
logging, and secret rotation.

Serve remote deployments over HTTPS/WSS. The client uses `ws:` on HTTP and `wss:` on
HTTPS. Same-origin WebSocket connections are allowed by default. To separate the
editor and signaling origins, list the allowed editor origins:

```sh
P5JS_LIVE_ALLOWED_ORIGINS='https://one.example,https://two.example' npm run dev
```

## Privacy and browser restrictions

- Publishing requires an active publisher patch.
- Only canvas video is published; source and local audio remain local.
- Room and performer names are public discovery labels within the room.
- Cross-origin media drawn without suitable CORS headers may taint the canvas and
  prevent capture.
- A selected TURN relay carries encrypted WebRTC media.

## Failure behavior

- Signaling reconnects and rejoins retained rooms.
- Existing peers may continue during a signaling outage.
- A missing stream leaves its receiver waiting.
- A disconnected stream becomes stalled without stopping other patches.
- A returning stream label is subscribed again.
- Removing the last publisher stops capture and removes its advertisement.
- Removing the last receiver closes its peer and releases remote media.
- The signaling socket closes when no retained room remains.

## Limits

The current peer mesh is for small rooms. Each publisher uploads one encoded stream
per receiver. Larger audiences need an SFU, simulcast, congestion controls, and
operational monitoring.

The panel does not yet report bitrate, packet loss, round-trip time, subscriber
counts, or codec details. Network audio, recording, multi-source `ShaderChain`
operators, and hosted discovery/TURN are not included.
