import type { MissionDef } from '../../narrative/schema';

/** Campaign ids (P0 + M1–M7). Lazy modules — default boot never imports them. */
export const CAMPAIGN_MISSION_IDS = ['p0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'] as const;
export type CampaignMissionId = (typeof CAMPAIGN_MISSION_IDS)[number];

/** Lazy campaign missions (M7.4–M7.11). Default boot never imports these modules. */
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
  if (id === 'm4') {
    const { m4Mission } = await import('./m4');
    return m4Mission();
  }
  if (id === 'm5') {
    const { m5Mission } = await import('./m5');
    return m5Mission();
  }
  if (id === 'm6') {
    const { m6Mission } = await import('./m6');
    return m6Mission();
  }
  if (id === 'm7') {
    const { m7Mission } = await import('./m7');
    return m7Mission();
  }
  return null;
}

export function isCampaignMissionId(id: string | null | undefined): id is CampaignMissionId {
  return (CAMPAIGN_MISSION_IDS as readonly string[]).includes(id ?? '');
}
