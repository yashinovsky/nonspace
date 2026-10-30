import { hasWebGL2, showUnsupported } from './app/unsupported';

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app root element missing');

  if (!hasWebGL2()) {
    showUnsupported(root);
    return;
  }

  const debug = new URLSearchParams(window.location.search).has('debug');
  try {
    const { startApp } = await import('./app/App');
    await startApp({ root, debug });
  } catch (err) {
    console.error(err);
    showUnsupported(root);
  }
}

void main();
