import { FM_VOICE_COUNT, fmWorkletKernel } from '../dsp/fm';

export const FM_WORKLET_NAME = 'ns-fm';

/**
 * Classic-script source for audioWorklet.addModule (no ES imports; Safari
 * worklets are not modules). The kernel is one function so minify cannot
 * break inner DSP calls.
 */
export function fmWorkletSource(): string {
  return `const fmApi = (${fmWorkletKernel.toString()})();
class NsFmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.voices = [];
    for (let i = 0; i < ${FM_VOICE_COUNT}; i++) this.voices.push(fmApi.createFmVoiceState());
    this.port.onmessage = (e) => fmApi.applyFmMessage(this.voices, e.data);
  }
  process(_inputs, outputs) {
    const ch = outputs[0];
    if (!ch || !ch[0]) return true;
    fmApi.mixFmVoices(this.voices, ch[0], ch[1] || ch[0], sampleRate);
    return true;
  }
}
registerProcessor('${FM_WORKLET_NAME}', NsFmProcessor);
`;
}
