import { noiseWorkletKernel } from '../dsp/noise';

export const NOISE_WORKLET_NAME = 'ns-noise';

export function noiseWorkletSource(): string {
  return `const noiseApi = (${noiseWorkletKernel.toString()})();
class NsNoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.state = noiseApi.createNoiseState(0x9e3779b9, 0);
    this.port.onmessage = (e) => noiseApi.applyNoiseMessage(this.state, e.data);
  }
  process(_inputs, outputs) {
    const ch = outputs[0];
    if (!ch || !ch[0]) return true;
    noiseApi.mixNoise(this.state, ch[0], ch[1] || ch[0]);
    return true;
  }
}
registerProcessor('${NOISE_WORKLET_NAME}', NsNoiseProcessor);
`;
}
