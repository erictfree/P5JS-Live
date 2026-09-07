// Optional browser pipeline. Source/clock generations reject late worker replies.
export function createTempoAnalysis({ rhythm, getSource, now = () => performance.now() / 1000 }) {
  let session = null, pending = null, revision = 0, lastPosition = 0, lastContextTime = null;
  let lastKey = null;
  const modules = new WeakMap();
  function stop() {
    revision++;
    if (session) {
      try { session.source.disconnect(session.node); } catch { /* source may already be disposed */ }
      session.node.disconnect(); session.worker.terminate();
    }
    session = null; pending = null;
  }
  async function start(info, key) {
    const request = ++revision;
    pending = key;
    try {
      if (!info.context.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('Automatic timing needs AudioWorklet support');
      let module = modules.get(info.context);
      if (!module) {
        module = info.context.audioWorklet.addModule(new URL('./tempoWorklet.js', import.meta.url))
          .catch(error => { modules.delete(info.context); throw error; });
        modules.set(info.context, module);
      }
      await module;
      if (request !== revision) return;
      const node = new AudioWorkletNode(info.context, 'astra-tempo-analysis');
      const worker = new Worker(new URL('./tempoWorker.js', import.meta.url), { type: 'module' });
      const generation = rhythm.generation();
      session = { node, worker, source: info.source, key };
      worker.onmessage = ({ data }) => {
        worker.postMessage({ ack: true });
        if (request !== revision || info.context.state !== 'running') return;
        // Both timestamps are sampled now; only their offset is used. A worker's
        // scheduling delay is not mistaken for the timestamp of a musical beat.
        const offset = now() - info.context.currentTime;
        rhythm.receiveEstimate({ ...data, at: data.at + offset, beatAt: data.beatAt + offset }, generation);
      };
      worker.onerror = () => { stop(); rhythm.fail('Automatic timing stopped. Choose Manual or retry Auto.'); };
      worker.postMessage({ port: node.port, algorithm: rhythm.settings().algorithm }, [node.port]);
      node.connect(info.context.destination);
      info.source.connect(node);
      pending = null;
    } catch (error) {
      if (request !== revision) return;
      stop(); rhythm.fail(error.message);
    }
  }
  return {
    update() {
      const info = getSource();
      const enabled = rhythm.settings().source === 'auto';
      const discontinuity = info.position + 0.05 < lastPosition ||
        (lastContextTime !== null && info.context.currentTime < lastContextTime);
      lastPosition = info.position; lastContextTime = info.context.currentTime;
      const key = `${info.generation}:${info.context.state}:${rhythm.generation()}`;
      if (discontinuity || (lastKey !== null && key !== lastKey && session)) { stop(); rhythm.invalidate(); }
      lastKey = `${info.generation}:${info.context.state}:${rhythm.generation()}`;
      if (!enabled || !info.source || info.context.state !== 'running') { if (session || pending) stop(); return; }
      if (rhythm.error()) return;
      if (session?.key !== lastKey && pending !== lastKey) { stop(); start(info, lastKey); }
    },
    dispose: stop,
  };
}
