declare module 'bwip-js' {
  const bwipjs: {
    toBuffer(opts: Record<string, unknown>): Promise<Uint8Array | Buffer>;
    toSVG(opts: Record<string, unknown>): Promise<string>;
    toCanvas?: (opts: Record<string, unknown>) => unknown;
  };
  export default bwipjs;
}
