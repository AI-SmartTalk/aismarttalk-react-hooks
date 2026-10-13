/** Cryptographic identifiers for browser capabilities and event nonces.
 * No predictable fallback: callers must handle unavailable Web Crypto.
 */
export function secureRandomId(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
