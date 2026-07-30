/**
 * Uses the global WebCrypto UUID generator rather than `node:crypto` so these
 * modules stay loadable from Next.js's instrumentation bundle, where webpack
 * refuses to resolve `node:` scheme imports.
 */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}
