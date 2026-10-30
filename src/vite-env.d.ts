declare const __NONSPACE_VERSION__: string;
declare const __NONSPACE_SHA__: string;

interface ImportMetaEnv {
  readonly VITE_REPORT_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.frag?raw' {
  const shader: string;
  export default shader;
}
