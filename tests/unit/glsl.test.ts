import { describe, expect, it } from 'vitest';
import shader from './fixtures/shaders/main.frag';

describe('vite-plugin-glsl', () => {
  it('resolves #include chunks', () => {
    expect(shader).toContain('float fixtureChunk()');
    expect(shader).toContain('void main()');
    expect(shader).not.toContain('#include');
  });
});
