import { ASCII_PLASMA_SOURCE } from '../../starter/ascii-plasma.js';

export async function loadAsciiProject(page) {
  await page.evaluate((source) => {
    localStorage.clear();
    window.p5jsLive.editor.value = source;
    window.p5jsLive.projectStore.save(source);
  }, ASCII_PLASMA_SOURCE);
  await page.reload();
}
