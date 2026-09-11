// Effects pads: optional parts of the scene a performer can switch on and off. They bind
// to the scene's boolean toggle controls — `control('glow', false, { mode: 'toggle' })` —
// in declaration order, so a patch author adds a switch by declaring a control and
// gating the optional drawing on it. Flipping one is a plain parameter change: no
// re-evaluation, and MIDI Learn or the Controls tab see the same value.

export const EFFECT_PAD_COUNT = 32;

export function isEffectControl(param) {
  return typeof param?.value === 'boolean' && param.mode === 'toggle';
}

export function createEffectsBoard({ registry, size = EFFECT_PAD_COUNT } = {}) {
  function list() {
    return registry.listParams().filter(isEffectControl).slice(0, size)
      .map(param => ({ name: param.name, value: param.value }));
  }
  function entry(index) {
    if (!Number.isInteger(index) || index < 0 || index >= size) return null;
    return list()[index] ?? null;
  }
  function set(index, value) {
    const target = entry(index);
    if (!target || typeof value !== 'boolean') return null;
    registry.setParam(target.name, value);
    return { name: target.name, value };
  }
  function toggle(index) {
    const target = entry(index);
    return target ? set(index, !target.value) : null;
  }
  return { size, list, entry, set, toggle };
}
