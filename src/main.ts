import { hasWebGL2, showUnsupported } from './app/unsupported';

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app root element missing');

  if (!hasWebGL2()) {
    showUnsupported(root);
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const debug = params.has('debug');
  const missionId = params.get('mission') ?? undefined;
  const checkpoint = params.get('checkpoint') ?? undefined;
  try {
    const { startApp } = await import('./app/App');
    await startApp({ root, debug, missionId, checkpoint });
  } catch (err) {
    console.error(err);
    showUnsupported(root);
  }
}

void main();
