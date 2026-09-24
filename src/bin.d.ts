// Index files are bundled as Data modules (see the rules in wrangler.toml).
declare module "*.bin" {
  const data: ArrayBuffer;
  export default data;
}
