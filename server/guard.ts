import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Optional SSRF guard. Many people run IPTV middleware on their LAN, so private
 * targets are allowed unless CHILLY_BLOCK_PRIVATE=1.
 */
const BLOCK_PRIVATE = process.env.CHILLY_BLOCK_PRIVATE === '1';

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80') || v6.startsWith('::ffff:127.') || v6.startsWith('::ffff:10.') || v6.startsWith('::ffff:192.168.');
}

export async function assertAllowedTarget(url: string): Promise<void> {
  if (!BLOCK_PRIVATE) return;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);
  if (addresses.some(isPrivateAddress)) throw new Error('Target address is not allowed');
}
