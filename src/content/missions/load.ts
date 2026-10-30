import type { MissionDef } from '../../narrative/schema';

/** Lazy campaign missions (M7.4 / M7.5 / M7.6). Default boot never imports these modules. */
export async function loadCampaignMission(id: string): Promise<MissionDef | null> {
  if (id === 'p0') {
    const { p0Mission } = await import('./p0');
    return p0Mission();
  }
  if (id === 'm1') {
    const { m1Mission } = await import('./m1');
    return m1Mission();
  }
  if (id === 'm2') {
    const { m2Mission } = await import('./m2');
    return m2Mission();
  }
  if (id === 'm3') {
    const { m3Mission } = await import('./m3');
    return m3Mission();
  }
  return null;
}

export function isCampaignMissionId(
  id: string | null | undefined,
): id is 'p0' | 'm1' | 'm2' | 'm3' {
  return id === 'p0' || id === 'm1' || id === 'm2' || id === 'm3';
}
