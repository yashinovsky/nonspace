/** Ambient shader modules for the node/e2e tsconfig, which does not include `src/`. */
declare module '*.frag?raw' {
  const shader: string;
  export default shader;
}
