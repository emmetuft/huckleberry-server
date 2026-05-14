/**
 * UUID ↔ BINARY(16) helpers.
 *
 * Aurora's planned schema (per docs/authentication.md) stores UUID primary keys
 * as `BINARY(16)` for index compactness. The application code carries UUIDs as
 * canonical 36-char strings (`randomUUID()` output). These helpers cross that
 * boundary at the repository layer; nothing else should call them.
 */

const HEX = /^[0-9a-f]{32}$/i;

/** Strip hyphens and hex-decode a UUID into a 16-byte Buffer. */
export function uuidToBinary(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (!HEX.test(hex)) {
    throw new Error(`not a UUID: ${uuid}`);
  }
  return Buffer.from(hex, 'hex');
}

/** Hex-encode a 16-byte buffer and re-insert the canonical 8-4-4-4-12 hyphens. */
export function binaryToUuid(buf: Buffer | Uint8Array): string {
  const hex = Buffer.from(buf).toString('hex');
  if (hex.length !== 32) {
    throw new Error(`expected 16-byte buffer, got ${hex.length / 2}`);
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
