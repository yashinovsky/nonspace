import { isQualitySetting } from './render/quality';
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
  if (params.get('lab') === 'sfx') {
    const { startSfxLab } = await import('./audio/sfx/lab');
    await startSfxLab(root);
    return;
  }

  if (!hasWebGL2()) {
    showUnsupported(root);
    return;
  }

  const debug = params.has('debug');
  const lab = params.get('lab');
  const qualityParam = params.get('quality');
  const qualityOverride = isQualitySetting(qualityParam) ? qualityParam : undefined;
  const missionId = params.get('mission') ?? undefined;
  const checkpoint = params.get('checkpoint') ?? undefined;

  try {
    if (lab === 'beam') {
      const { isBeamScene, startBeamLab } = await import('./debug/BeamLab');
      const sceneParam = params.get('scene');
      await startBeamLab(root, {
        debug,
        qualityOverride,
        scene: isBeamScene(sceneParam) ? sceneParam : undefined,
      });
      return;
    }
    const { startApp } = await import('./app/App');
    await startApp({ root, debug, lab, qualityOverride, missionId, checkpoint });
  } catch (err) {
    console.error(err);
    showUnsupported(root);
  }
}

void main();
