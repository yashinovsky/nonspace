/** Corporations with heraldry/motifs (plan §5.4, §7.2). Heraldry data is M2.2's. */
export const CORP_IDS = [
  'tessierAshpool',
  'mitsubishi',
  'esfa',
  'senseNet',
  'hosaka',
  'turing',
  'military',
  'minor',
] as const;

export type CorpId = (typeof CORP_IDS)[number];
