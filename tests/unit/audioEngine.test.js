import { describe, expect, it, vi } from 'vitest';
import { createAudioEngine } from '../../src/audio/audioEngine.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function mockSoundFile(duration = 10) {
  let playing = false;
  return {
    speed: 1,
    paused: false,
    playing: false,
    duration: () => duration,
    isPlaying: () => playing,
    play: vi.fn(function play() {
      playing = true;
      this.playing = true;
    }),
    pause: vi.fn(function pause() {
      playing = false;
      this.playing = false;
      this.paused = true;
    }),
    stop: vi.fn(function stop() {
      playing = false;
      this.playing = false;
    }),
    rate: vi.fn(),
    loop: vi.fn(),
    onended: vi.fn(),
    dispose: vi.fn(),
  };
}

function response(bytes = new Uint8Array([1, 2, 3, 4])) {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-length': String(bytes.byteLength) },
  });
}

function testPlatform(overrides = {}) {
  const context = overrides.context ?? {
    state: 'running',
    currentTime: 0,
    sampleRate: 48_000,
    resume: vi.fn(async function resume() {
      this.state = 'running';
    }),
    decodeAudioData: vi.fn(async () => ({ decoded: true })),
  };
  const loaded = overrides.loaded ?? mockSoundFile();
  return {
    context,
    loaded,
    platform: {
      audioContext: () => context,
      createSoundFile: vi.fn(() => loaded),
      fetch: vi.fn(async () => response()),
      createObjectURL: vi.fn(() => 'blob:test-audio'),
      revokeObjectURL: vi.fn(),
      startAudio: vi.fn(async () => {}),
      createAmplitude: vi.fn(() => ({ setInput: vi.fn(), getLevel: () => 0 })),
      createFFT: vi.fn(() => ({
        analyzer: { smoothing: 0 },
        setInput: vi.fn(),
        analyze: () => new Float32Array(1024),
        waveform: () => new Float32Array(1024),
      })),
      createAudioIn: vi.fn(),
      ...overrides.platform,
    },
  };
}

function namedFile(name, contents = 'not real audio') {
  const file = new Blob([contents]);
  Object.defineProperty(file, 'name', { value: name });
  return file;
}

describe('p5.sound 0.4 audio integration', () => {
  it('constructs the rewritten FFT with its new one-argument API', () => {
    const { platform } = testPlatform();
    const engine = createAudioEngine({ platform });

    const { fft } = engine.init();

    expect(platform.createFFT).toHaveBeenCalledWith(1024);
    expect(fft.analyzer.smoothing).toBe(0.8);
  });

  it('preserves the patch-facing 0..255 spectrum and named FFT bands', async () => {
    const { platform } = testPlatform({
      platform: {
        createAmplitude: vi.fn(() => ({ setInput: vi.fn(), getLevel: () => 0.25 })),
        createFFT: vi.fn(() => ({
          analyzer: { smoothing: 0 },
          setInput: vi.fn(),
          analyze: () => new Float32Array(1024).fill(0.5),
          waveform: () => new Float32Array([-1, 0, 1]),
        })),
      },
    });
    const engine = createAudioEngine({ platform });
    engine.init();
    await engine.loadUrl('/assets/sounds/intro.mp3');

    const snapshot = engine.readFrame();

    expect(snapshot.spectrum).toHaveLength(1024);
    expect(snapshot.spectrum[0]).toBeCloseTo(127.5);
    expect(snapshot.raw).toMatchObject({
      level: 0.25,
      bass: 127.5,
      mid: 127.5,
      treble: 127.5,
      sampleRate: 48_000,
      nyquist: 24_000,
    });
    expect(snapshot.raw.centroid).toBeCloseTo(12_000, 0);
    expect(snapshot.waveform).toEqual([-1, 0, 1]);
  });

  it('routes p5.sound 0.4 sources through native analyzer inputs', async () => {
    const sourceOutput = { connect: vi.fn() };
    const amplitudeInput = {};
    const fftInput = {};
    const { platform } = testPlatform({
      loaded: { ...mockSoundFile(), output: sourceOutput },
      platform: {
        createAmplitude: vi.fn(() => ({
          input: amplitudeInput,
          setInput: vi.fn(),
          getLevel: () => 0,
        })),
        createFFT: vi.fn(() => ({
          input: fftInput,
          analyzer: { smoothing: 0 },
          setInput: vi.fn(),
          analyze: () => new Float32Array(1024),
          waveform: () => new Float32Array(1024),
        })),
      },
    });
    const engine = createAudioEngine({ platform });

    engine.init();
    await engine.loadUrl('/audio.wav');

    expect(sourceOutput.connect).toHaveBeenNthCalledWith(1, amplitudeInput);
    expect(sourceOutput.connect).toHaveBeenNthCalledWith(2, fftInput);
  });
});

describe('audio file loading status', () => {
  it('reports reading, decoding, and completion', async () => {
    const { platform, loaded } = testPlatform({ loaded: mockSoundFile(125) });
    const updates = [];
    const engine = createAudioEngine({ platform });

    const pending = engine.loadFile(namedFile('set.mp3'), {
      onProgress: (status) => updates.push(status),
    });
    expect(engine.status()).toMatchObject({
      source: 'set.mp3',
      loading: true,
      loadPhase: 'loading',
      loadProgress: null,
      loaded: false,
    });

    await expect(pending).resolves.toBe(loaded);
    expect(engine.status()).toMatchObject({
      source: 'set.mp3',
      loading: false,
      loadPhase: null,
      loadProgress: null,
      loaded: true,
      looping: false,
    });
    expect(loaded.loop).toHaveBeenCalledWith(false);
    expect(updates.map((update) => update.loadPhase)).toEqual([
      'loading',
      'loading',
      'decoding',
      null,
    ]);
    expect(platform.revokeObjectURL).toHaveBeenCalledWith('blob:test-audio');
  });

  it('remembers loop mode before a file exists and applies it when the file loads', async () => {
    const { platform, loaded } = testPlatform();
    const engine = createAudioEngine({ platform });

    expect(engine.setLoop(true)).toBe(true);
    await engine.loadFile(namedFile('loop.mp3'));

    expect(loaded.loop).toHaveBeenCalledWith(true);
    expect(engine.status().looping).toBe(true);
  });

  it('clears loading state and exposes a useful error when decoding fails', async () => {
    const { platform, context } = testPlatform();
    context.decodeAudioData = vi.fn(async () => {
      throw new Error('decode failed');
    });
    const engine = createAudioEngine({ platform });

    await expect(engine.loadFile(namedFile('broken.mp3'))).rejects.toThrow('decode failed');
    expect(engine.status()).toMatchObject({
      source: 'none',
      loading: false,
      loaded: false,
      failed: true,
      error: 'Could not decode broken.mp3',
    });
  });
});

describe('built-in audio sources', () => {
  it('loads a looping preview without changing the performer loop preference', async () => {
    const { platform, loaded } = testPlatform({ loaded: mockSoundFile(8) });
    const engine = createAudioEngine({ platform });

    await expect(engine.loadUrl('/assets/sounds/intro.mp3', {
      label: 'intro loop',
      loop: true,
    })).resolves.toBe(loaded);

    expect(platform.fetch).toHaveBeenCalledWith('/assets/sounds/intro.mp3');
    expect(loaded.loop).toHaveBeenCalledWith(true);
    expect(engine.status()).toMatchObject({
      source: 'intro loop',
      loaded: true,
      looping: false,
    });

    engine.useSilence();
    expect(loaded.stop).not.toHaveBeenCalled();
    expect(loaded.dispose).toHaveBeenCalledOnce();
    expect(engine.status()).toMatchObject({ source: 'none', loaded: false, playing: false });
  });

  it('cannot overwrite a later source when decoding finishes late', async () => {
    const decoding = deferred();
    const { platform, context } = testPlatform();
    context.decodeAudioData = vi.fn(() => decoding.promise);
    const engine = createAudioEngine({ platform });

    const pending = engine.loadUrl('/assets/sounds/intro.mp3');
    await vi.waitFor(() => expect(context.decodeAudioData).toHaveBeenCalledOnce());
    engine.useSilence();
    decoding.resolve({ decoded: true });

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(platform.createSoundFile).not.toHaveBeenCalled();
    expect(engine.status()).toMatchObject({ source: 'none', loaded: false });
  });
});

describe('Chrome audio unlocking', () => {
  it('uses p5 userStartAudio while handling the trusted user gesture', async () => {
    const { platform, context } = testPlatform();
    context.state = 'suspended';
    platform.startAudio = vi.fn(async () => {
      context.state = 'running';
    });

    await expect(createAudioEngine({ platform }).unlock()).resolves.toBe('running');
    expect(platform.startAudio).toHaveBeenCalledOnce();
    expect(context.resume).not.toHaveBeenCalled();
  });

  it('falls back to AudioContext.resume when the p5 helper leaves it suspended', async () => {
    const { platform, context } = testPlatform();
    context.state = 'suspended';

    await expect(createAudioEngine({ platform }).unlock()).resolves.toBe('running');
    expect(platform.startAudio).toHaveBeenCalledOnce();
    expect(context.resume).toHaveBeenCalledOnce();
  });
});
