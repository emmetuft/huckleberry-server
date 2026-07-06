import { isBlockedIpv4, isBlockedIpv6 } from './ssrf-safe-fetch.js';

describe('isBlockedIpv4', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.255.255', 'loopback edge'],
    ['169.254.169.254', 'AWS metadata'],
    ['169.254.0.1', 'link-local'],
    ['10.0.0.1', 'RFC 1918 /8'],
    ['10.255.255.255', 'RFC 1918 /8 edge'],
    ['172.16.0.1', 'RFC 1918 /12 start'],
    ['172.31.255.255', 'RFC 1918 /12 end'],
    ['192.168.0.1', 'RFC 1918 /16'],
    ['192.168.255.255', 'RFC 1918 /16 edge'],
    ['100.64.0.1', 'CGN start'],
    ['100.127.255.255', 'CGN end'],
    ['0.0.0.1', 'unspecified'],
    ['224.0.0.1', 'multicast start'],
    ['239.255.255.255', 'multicast end'],
    ['255.255.255.255', 'broadcast'],
    ['192.0.2.1', 'TEST-NET-1'],
    ['198.51.100.1', 'TEST-NET-2'],
    ['203.0.113.1', 'TEST-NET-3'],
    ['198.18.0.1', 'benchmarking start'],
    ['198.19.255.255', 'benchmarking end'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedIpv4(ip)).toBe(true);
  });

  it.each([
    ['8.8.8.8', 'Google DNS'],
    ['1.1.1.1', 'Cloudflare DNS'],
    ['93.184.216.34', 'example.com'],
    ['172.15.255.255', 'just below RFC 1918 /12'],
    ['172.32.0.0', 'just above RFC 1918 /12'],
    ['100.63.255.255', 'just below CGN'],
    ['100.128.0.0', 'just above CGN'],
  ])('allows %s (%s)', (ip) => {
    expect(isBlockedIpv4(ip)).toBe(false);
  });
});

describe('isBlockedIpv6', () => {
  it.each([
    ['::1', 'loopback'],
    ['::', 'unspecified'],
    ['fe80::1', 'link-local'],
    ['fe80::dead:beef', 'link-local'],
    ['fc00::1', 'unique local fc'],
    ['fd00::1', 'unique local fd'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:192.168.1.1', 'IPv4-mapped RFC 1918'],
    ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedIpv6(ip)).toBe(true);
  });

  it.each([
    ['2001:4860:4860::8888', 'Google DNS'],
    ['2606:4700:4700::1111', 'Cloudflare DNS'],
    ['2001:db8::1', 'documentation prefix'],
  ])('allows %s (%s)', (ip) => {
    expect(isBlockedIpv6(ip)).toBe(false);
  });
});
