/** Keep visual, keyboard and assistive-technology state in agreement. */
export function setDrawerHidden(drawer, toggle, hidden) {
  if (hidden && drawer.contains(document.activeElement)) toggle.focus({ preventScroll: true });
  drawer.inert = hidden;
  drawer.setAttribute('aria-hidden', String(hidden));
  drawer.classList.toggle('is-hidden', hidden);
  toggle.classList.toggle('is-on', !hidden);
  toggle.setAttribute('aria-expanded', String(!hidden));
  toggle.setAttribute('aria-controls', drawer.id);
}
