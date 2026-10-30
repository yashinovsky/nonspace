import { isQualitySetting } from './render/quality';
import { resolveReportEndpoint } from './app/reportEndpoint';
import type { Reporter } from './app/reporter';
import { probeSupport, showUnsupported } from './app/unsupported';
import { mountVersionStamp } from './app/version';

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app root element missing');

  mountVersionStamp(document.getElementById('version-stamp'));

  const params = new URLSearchParams(window.location.search);
  let reporter: Reporter | undefined;
  const reportUrl = resolveReportEndpoint(window.location.search);
  if (reportUrl) {
    const { installReporter } = await import('./app/reporter');
    reporter = installReporter({
      endpoint: reportUrl,
      search: window.location.search,
      host: window,
      fetch,
      sendBeacon: navigator.sendBeacon?.bind(navigator),
    });
  }

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

  const support = probeSupport();
  if (!support.ok) {
    showUnsupported(root, support);
    return;
  }

  const debug = params.has('debug');
  const lab = params.get('lab');
  const qualityParam = params.get('quality');
  const qualityOverride = isQualitySetting(qualityParam) ? qualityParam : undefined;
  const forceRgba8 = params.get('hdr') === '0';
  const skipAnimationLoop = params.has('noloop');
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
    if (lab === 'text') {
      const { isTextScene, startTextLab } = await import('./debug/TextLab');
      const sceneParam = params.get('scene');
      await startTextLab(root, {
        debug,
        qualityOverride,
        scene: isTextScene(sceneParam) ? sceneParam : undefined,
      });
      return;
    }
    const { startApp } = await import('./app/App');
    await startApp({
      root,
      debug,
      lab,
      qualityOverride,
      forceRgba8,
      skipAnimationLoop,
      missionId,
      checkpoint,
    });
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    reporter?.capture('unhandled', text, stack);
    reporter?.flush();
    console.error(err);
    showUnsupported(root);
  }
}

void main();
