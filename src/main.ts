import { hasWebGL2, showUnsupported } from './app/unsupported';

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app root element missing');

  const params = new URLSearchParams(window.location.search);
  if (params.get('lab') === 'audio') {
    const { startAudioLab } = await import('./audio/lab');
    await startAudioLab(root);
    return;
  }

  if (!hasWebGL2()) {
    showUnsupported(root);
    return;
  }

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
