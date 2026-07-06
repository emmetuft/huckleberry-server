import { lookup } from 'node:dns/promises';
import { BadRequestException } from '@nestjs/common';

const MAX_RESPONSE_BYTES = 1_048_576; // 1 MB

/**
 * Fetch wrapper that guards against SSRF in production.
 *
 * - Resolves the target hostname via DNS before connecting. If the resolved
 *   address falls in a private/reserved range the request is rejected.
 * - Always disables redirect following (redirect: 'error').
 * - Caps the response body at 1 MB.
 *
 * In non-production environments the IP blocklist is skipped so that local
 * MCP servers (e.g. http://localhost:9000) work during development.
 */
export async function ssrfSafeFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    const hostname = new URL(url).hostname;
    const { address, family } = await lookup(hostname);
    const blocked =
      family === 4 ? isBlockedIpv4(address) : isBlockedIpv6(address);
    if (blocked) {
      throw new BadRequestException('ssrf_blocked');
    }
  }

  const response = await fetch(url, { ...init, redirect: 'error' });

  // Stream the body and abort early if it exceeds MAX_RESPONSE_BYTES.
  // This prevents a malicious server from exhausting process memory.
  const reader = response.body?.getReader();
  if (!reader) {
    return new Response(null, {
      status: response.status,
      headers: response.headers,
    });
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new BadRequestException('response_too_large');
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Response(body, {
    status: response.status,
    headers: response.headers,
  });
}

export function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return true;
  const [a, b, c] = parts;
  return (
    a === 0 || // 0.0.0.0/8          unspecified
    a === 10 || // 10.0.0.0/8         RFC 1918
    a === 127 || // 127.0.0.0/8        loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10      CGN
    (a === 169 && b === 254) || // 169.254.0.0/16     link-local / metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12      RFC 1918
    (a === 192 && b === 0 && c === 2) || // 192.0.2.0/24       TEST-NET-1
    (a === 192 && b === 168) || // 192.168.0.0/16     RFC 1918
    (a === 198 && b >= 18 && b <= 19) || // 198.18.0.0/15      benchmarking
    (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24    TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // 203.0.113.0/24     TEST-NET-3
    a >= 224 // 224.0.0.0/4+       multicast / reserved
  );
}

export function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local fc00::/7
  if (lower.startsWith('fe80:')) return true; // link-local fe80::/10
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped: extract and check the embedded IPv4 address
    const embedded = lower.slice('::ffff:'.length);
    if (embedded.includes('.')) return isBlockedIpv4(embedded);
  }
  return false;
}
