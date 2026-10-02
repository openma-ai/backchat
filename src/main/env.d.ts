declare module "*?raw" {
  const source: string;
  export default source;
}

interface ImportMeta {
  readonly env: {
    readonly DEV: boolean;
    readonly PROD: boolean;
  };
}
