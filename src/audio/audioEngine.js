// Audio engine — shared infrastructure, created once.
//
// Exactly one p5.Amplitude and one p5.FFT exist for the whole session, no matter how
// many strategies are drawing, and no matter how many times the input source changes.
// Strategies never construct their own analyzers; they read the snapshot this module
// produces.
//
// Nothing in the evaluation path calls into this file:
// evaluating code cannot restart playback or recreate an analyzer, because evaluating
// code has no way to reach either one.

import { createFeatureExtractor } from './features.js';

/** @typedef {'none'|'file'|'mic'} SourceKind */

const FFT_SIZE = 1024;
const SPECTRUM_SCALE = 255;

function abortError() {
  const error = new Error('Audio source was replaced');
  error.name = 'AbortError';
  return error;
}

function finiteUnit(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** Preserve the legacy 0..255 FFT contract exposed to patches. */
function scaledSpectrum(values) {
  return Array.from(values ?? [], (value) => finiteUnit(value) * SPECTRUM_SCALE);
}

function averageBand(spectrum, sampleRate, lowHz, highHz) {
  if (!spectrum.length || !Number.isFinite(sampleRate)) return 0;
  const nyquist = sampleRate / 2;
  const first = Math.max(0, Math.floor((lowHz / nyquist) * spectrum.length));
  const last = Math.min(
    spectrum.length - 1,
    Math.ceil((Math.min(highHz, nyquist) / nyquist) * spectrum.length),
  );
  if (last < first) return 0;
  let total = 0;
  for (let index = first; index <= last; index += 1) total += spectrum[index];
  return total / (last - first + 1);
}

function spectralCentroid(spectrum, sampleRate) {
  if (!spectrum.length || !Number.isFinite(sampleRate)) return 0;
  const binWidth = (sampleRate / 2) / spectrum.length;
  let weighted = 0;
  let total = 0;
  for (let index = 0; index < spectrum.length; index += 1) {
    const magnitude = spectrum[index];
    total += magnitude;
    weighted += magnitude * (index + 0.5) * binWidth;
  }
  return total > 0 ? weighted / total : 0;
}

export function createAudioEngine({ diagnostics, platform = {} } = {}) {
  const features = createFeatureExtractor();
  const runtime = {
    // p5.sound 0.4 installs these helpers on p5.prototype. Unlike the legacy
    // bundle, p5 2 global mode does not also publish them as window globals.
    audioContext: platform.audioContext ?? (() => p5.prototype.getAudioContext()),
    createAmplitude: platform.createAmplitude ?? (() => new p5.Amplitude()),
    createFFT: platform.createFFT ?? ((size) => new p5.FFT(size)),
    createSoundFile: platform.createSoundFile ?? ((buffer) => new p5.SoundFile(buffer)),
    createAudioIn: platform.createAudioIn ?? (() => new p5.AudioIn()),
    fetch: platform.fetch ?? ((url) => fetch(url)),
    createObjectURL: platform.createObjectURL ?? ((file) => URL.createObjectURL(file)),
    revokeObjectURL: platform.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url)),
    startAudio: platform.startAudio ?? (() => p5.prototype.userStartAudio()),
  };

  let amplitude = null;
  let fft = null;
  let soundFile = null;
  let mic = null;
  let playbackStartedAt = null;
  let playbackOffset = 0;

  /** @type {SourceKind} */
  let sourceKind = 'none';
  let sourceLabel = 'none';
  let sourceError = null;
  let loadPhase = null;
  let loadProgress = null;
  let lastReadAt = null;
  let looping = false;
  let sourceRequest = 0;

  function disposeNode(node) {
    if (!node) return;
    if (typeof node.dispose === 'function') {
      node.dispose();
      return;
    }
    // p5.sound 0.4 sources do not yet expose dispose() on their wrapper, but
    // their Tone node and native routing gains do. Release all three when an
    // input is replaced so repeated file/mic changes do not accumulate graphs.
    node.node?.dispose?.();
    node.input?.disconnect?.();
    node.output?.disconnect?.();
  }

  /** Called once from the host's setup(). */
  function init() {
    amplitude = runtime.createAmplitude();
    fft = runtime.createFFT(FFT_SIZE);
    if (fft.analyzer) fft.analyzer.smoothing = 0.8;
    return { amplitude, fft };
  }

  /**
   * Point the one Amplitude and the one FFT at whatever is currently the source.
   *
   * This is the only place input routing changes. A mic is deliberately NOT connected
   * to the master output — doing so on a laptop with open speakers is a feedback loop
   * — so the analyzers have to be told about it explicitly rather than listening to
   * master as they do for a file.
   */
  function route(node) {
    if (!amplitude || !fft) return;
    // p5.sound 0.4's analyzer setInput() currently connects a native AudioNode
    // directly to a Tone.js object, which Chrome rejects. Every p5 sound source
    // and analyzer also exposes native output/input GainNodes, so use those as
    // the stable interop boundary. Keep setInput for injected/legacy adapters.
    if (node?.output?.connect && amplitude.input && fft.input) {
      node.output.connect(amplitude.input);
      node.output.connect(fft.input);
      return;
    }
    amplitude.setInput(node);
    fft.setInput(node);
  }

  function discardSoundFile() {
    if (!soundFile) return;
    if (soundFile.isPlaying?.()) soundFile.stop();
    disposeNode(soundFile);
    soundFile = null;
    playbackStartedAt = null;
    playbackOffset = 0;
  }

  function audioClock() {
    return runtime.audioContext().currentTime;
  }

  function currentPosition() {
    if (!soundFile) return 0;
    const duration = soundFile.duration?.() ?? 0;
    const elapsed = playbackStartedAt === null ? 0 : Math.max(0, audioClock() - playbackStartedAt);
    const position = playbackOffset + elapsed;
    if (looping && duration > 0) return position % duration;
    return duration > 0 ? Math.min(position, duration) : position;
  }

  function applyLoop(file, value) {
    file.loop(Boolean(value));
  }

  function markPlaying() {
    playbackStartedAt = audioClock();
  }

  function playFile() {
    if (!soundFile || soundFile.isPlaying()) return;
    if (soundFile.paused) {
      // p5.sound 0.4 pauses by setting playbackRate to zero. Restoring the rate
      // resumes the same source; its public play() intentionally does not restart it.
      soundFile.rate(soundFile.speed || 1);
      soundFile.paused = false;
      soundFile.playing = true;
    } else {
      soundFile.play();
    }
    markPlaying();
  }

  async function readResponse(response, reportProgress) {
    if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
    const total = Number(response.headers.get('content-length'));
    if (!response.body || !Number.isFinite(total) || total <= 0) {
      return response.arrayBuffer();
    }

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      reportProgress(Math.min(0.98, received / total));
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  }

  async function decodeSound(url, request, reportProgress) {
    const response = await runtime.fetch(url);
    const bytes = await readResponse(response, reportProgress);
    if (request !== sourceRequest) throw abortError();
    reportProgress(0.99);
    const decoded = await runtime.audioContext().decodeAudioData(bytes);
    if (request !== sourceRequest) throw abortError();
    return runtime.createSoundFile(decoded);
  }

  // --- file input -----------------------------------------------------------------

  /**
   * Load a browser-readable audio file. This is a user action, not an evaluation, so
   * it is allowed to replace the source.
   * The streaming fetch reports byte progress while the browser reads the file. Decoding happens
   * afterward and has no measurable progress, so it is exposed as its own phase.
   * @param {File} file
   * @param {{ onProgress?: (status: ReturnType<typeof status>) => void }} [options]
   */
  async function loadFile(file, { onProgress } = {}) {
    const url = runtime.createObjectURL(file);
    try {
      return await loadSource(url, file.name, { onProgress, performerLoop: true });
    } finally {
      runtime.revokeObjectURL(url);
    }
  }

  /**
   * Load an audio asset shipped with the app. It uses the same analyzer path as a
   * performer-selected file, so the welcome-loop can drive the visuals behind the
   * source picker. The loop option belongs only to this asset and does not change the
   * performer's transport preference for the next file they choose.
   *
   * @param {string} url
   * @param {{ label?: string, loop?: boolean }} [options]
   */
  function loadUrl(url, { label = url, loop = false } = {}) {
    return loadSource(url, label, { loop, performerLoop: false });
  }

  async function loadSource(url, label, { onProgress, loop = looping, performerLoop = false } = {}) {
    const request = ++sourceRequest;
    const report = () => onProgress?.(status());
    stopMic();
    discardSoundFile();
    sourceKind = 'none';
    sourceLabel = label;
    sourceError = null;
    loadPhase = 'loading';
    loadProgress = null;
    report();

    const updateProgress = (progress) => {
      if (request !== sourceRequest || !Number.isFinite(progress)) return;
      loadProgress = finiteUnit(progress);
      loadPhase = loadProgress >= 0.99 ? 'decoding' : 'loading';
      report();
    };

    try {
      const loaded = await decodeSound(url, request, updateProgress);
      if (request !== sourceRequest) {
        disposeNode(loaded);
        throw abortError();
      }
      soundFile = loaded;
      applyLoop(soundFile, loop);
      soundFile.onended?.(() => {
        if (soundFile !== loaded || loop) return;
        playbackOffset = 0;
        playbackStartedAt = null;
        loaded.playing = false;
      });
      sourceKind = 'file';
      sourceLabel = label;
      sourceError = null;
      loadPhase = null;
      loadProgress = null;
      playbackOffset = 0;
      playbackStartedAt = null;
      route(loaded);
      features.reset();
      if (performerLoop) {
        diagnostics?.info(`Loaded ${label}`, `${loaded.duration().toFixed(1)}s`);
      }
      report();
      return loaded;
    } catch (error) {
      if (request !== sourceRequest || error?.name === 'AbortError') throw error;
      sourceKind = 'none';
      sourceLabel = 'none';
      sourceError = performerLoop ? `Could not decode ${label}` : `Could not load ${label}`;
      loadPhase = null;
      loadProgress = null;
      diagnostics?.error(
        sourceError,
        `${error?.name ?? 'Error'}: ${error?.message ?? 'Audio decoding failed'}. `
          + 'Try a Chrome-supported .mp3, .wav, .ogg, .m4a, or .aac file. The sketch keeps running on silence.',
      );
      report();
      throw error;
    }
  }

  // --- microphone / line input ----------------------------------------------------

  /**
   * Switch to live input. The browser prompts for permission the first time; a denial
   * is reported and leaves the system running on silence rather than throwing.
   * @param {string} [deviceId] from listInputs()
   */
  async function useMicrophone(deviceId) {
    ++sourceRequest;
    if (soundFile?.isPlaying()) soundFile.pause();
    await unlock();

    stopMic();
    mic = runtime.createAudioIn();
    try {
      await mic.node.open(deviceId);
      sourceKind = 'mic';
      sourceLabel = deviceId ? 'line/mic input' : 'microphone';
      sourceError = null;
      route(mic);
      features.reset();
      diagnostics?.success('Live input running', 'Analyzing the microphone or line input.');
      return true;
    } catch (error) {
      disposeNode(mic);
      mic = null;
      sourceKind = 'none';
      sourceLabel = 'none';
      sourceError = error?.name === 'NotAllowedError'
        ? 'Microphone permission denied'
        : 'Microphone failed to start';
      diagnostics?.error(
        sourceError,
        `${error.name}: the sketch keeps running on silence. Check Chrome's site permissions, then try again.`,
      );
      return false;
    }
  }

  function stopMic() {
    if (!mic) return;
    mic.stop();
    disposeNode(mic);
    mic = null;
  }

  /** Stop every source and return stable silence snapshots. */
  function useSilence() {
    ++sourceRequest;
    stopMic();
    discardSoundFile();
    sourceKind = 'none';
    sourceLabel = 'none';
    sourceError = null;
    loadPhase = null;
    loadProgress = null;
    features.reset();
    return true;
  }

  /** Selectable input devices for the source picker. */
  async function listInputs() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Input ${i + 1}` }));
    } catch (error) {
      diagnostics?.warn('Could not list audio inputs', error.message);
      return [];
    }
  }

  // --- transport ------------------------------------------------------------------

  /**
   * Unlock p5.sound while execution still belongs to a trusted click/change/drop.
   *
   * Chrome requires this to run from a trusted user gesture. p5's helper resumes its
   * Tone.js graph; the direct context resume is a defensive fallback.
   */
  async function unlock() {
    const context = runtime.audioContext();
    await runtime.startAudio();
    if (context.state !== 'running') await context.resume();
    if (context.state !== 'running') {
      throw new Error(`Audio context stayed ${context.state}`);
    }
    return context.state;
  }

  /** The explicit user gesture browsers require before audio may start. */
  async function start() {
    const state = await unlock();
    if (sourceKind === 'file' && soundFile && !soundFile.isPlaying()) playFile();
    return state;
  }

  function pause() {
    if (!soundFile?.isPlaying()) return;
    playbackOffset = currentPosition();
    playbackStartedAt = null;
    soundFile.pause();
  }

  async function toggle() {
    if (sourceKind !== 'file' || !soundFile) return false;
    if (soundFile.isPlaying()) {
      pause();
      return false;
    }
    await unlock();
    playFile();
    return true;
  }

  function setLoop(value) {
    looping = Boolean(value);
    if (soundFile) applyLoop(soundFile, looping);
    return looping;
  }

  // --- analysis -------------------------------------------------------------------

  /**
   * One analysis pass per frame, shared by every strategy that frame.
   * Returns a frozen audio snapshot.
   */
  function readFrame() {
    const nowSeconds = performance.now() / 1000;
    const dt = lastReadAt === null ? 1 / 60 : Math.min(nowSeconds - lastReadAt, 0.25);
    lastReadAt = nowSeconds;

    // No source, a suspended context, or a failed input all produce a stable
    // silence snapshot. The draw loop never learns that anything went wrong.
    if (!fft || !amplitude || sourceKind === 'none' || runtime.audioContext().state !== 'running') {
      return features.silence();
    }

    const context = runtime.audioContext();
    const spectrum = scaledSpectrum(fft.analyze());
    return features.compute({
      dt,
      level: amplitude.getLevel(),
      bass: averageBand(spectrum, context.sampleRate, 20, 140),
      mid: averageBand(spectrum, context.sampleRate, 400, 2600),
      treble: averageBand(spectrum, context.sampleRate, 5200, 14000),
      centroid: spectralCentroid(spectrum, context.sampleRate),
      nyquist: context.sampleRate / 2,
      waveform: fft.waveform(),
      spectrum,
    });
  }

  function status() {
    return {
      kind: sourceKind,
      source: sourceLabel,
      error: sourceError,
      failed: sourceError !== null,
      loading: loadPhase !== null,
      loadPhase,
      loadProgress,
      loaded: sourceKind !== 'none',
      playing: sourceKind === 'mic' ? mic !== null : (soundFile?.isPlaying() ?? false),
      looping,
      position: currentPosition(),
      duration: soundFile?.duration() ?? 0,
      contextState: runtime.audioContext()?.state ?? 'unknown',
    };
  }

  return {
    init,
    loadFile,
    loadUrl,
    unlock,
    useMicrophone,
    useSilence,
    listInputs,
    stopMic,
    start,
    pause,
    toggle,
    setLoop,
    readFrame,
    status,
    /** Live smoothing and auto-gain controls. */
    configure: features.configure,
    featureOptions: features.options,
  };
}
