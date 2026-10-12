// The client is prebuilt into client/dist (source: client/entry.tsx) so its class syntax is
// lowered for Hermes before Paseo compiles it. Run `npm run build:client` after client changes.
export { default } from "./client/dist/index.js";
