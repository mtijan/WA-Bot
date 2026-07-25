import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

const UNSAFE_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal'
]);
const pinnedDispatchers = new Map();

function unsafeUrlError(message = 'URL tujuan tidak diizinkan oleh kebijakan keamanan.') {
  const error = new Error(message);
  error.code = 'UNSAFE_OUTBOUND_URL';
  error.statusCode = 400;
  return error;
}

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b, c] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

export function isPrivateOrReservedIp(address) {
  const normalized = String(address || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  const version = isIP(normalized);

  if (version === 4) return isPrivateIpv4(normalized);
  if (version !== 6) return true;

  return normalized === '::'
    || normalized === '::1'
    || normalized.startsWith('::ffff:')
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('ff');
}

async function resolveSafeOutboundUrl(value, options = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw unsafeUrlError('Base URL AI tidak valid.');
  }

  if (parsed.protocol !== 'https:') {
    throw unsafeUrlError('Base URL AI wajib menggunakan HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw unsafeUrlError('Base URL AI tidak boleh memuat kredensial URL.');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!hostname
    || UNSAFE_HOSTNAMES.has(hostname)
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')) {
    throw unsafeUrlError();
  }

  const literalVersion = isIP(hostname);
  if (literalVersion) {
    if (isPrivateOrReservedIp(hostname)) throw unsafeUrlError();
    return {
      url: parsed.toString().replace(/\/$/, ''),
      address: hostname,
      family: literalVersion
    };
  }

  const lookup = options.lookup || dnsLookup;
  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw unsafeUrlError('Hostname Base URL AI tidak dapat diresolusi.');
  }

  if (!Array.isArray(addresses)
    || addresses.length === 0
    || addresses.some(({ address }) => isPrivateOrReservedIp(address))) {
    throw unsafeUrlError();
  }

  return {
    url: parsed.toString().replace(/\/$/, ''),
    address: addresses[0].address,
    family: addresses[0].family
  };
}

export async function assertSafeOutboundUrl(value, options = {}) {
  const resolved = await resolveSafeOutboundUrl(value, options);
  return resolved.url;
}

export function createSafeOutboundFetch(options = {}) {
  return async (input, init = {}) => {
    const targetUrl = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const resolved = await resolveSafeOutboundUrl(targetUrl, options);
    const dispatcherKey = `${new URL(resolved.url).origin}|${resolved.address}|${resolved.family}`;
    let dispatcher = pinnedDispatchers.get(dispatcherKey);
    if (!dispatcher) {
      dispatcher = new Agent({
        connect: {
          lookup: (_hostname, lookupOptions, callback) => {
            if (lookupOptions?.all) {
              callback(null, [{ address: resolved.address, family: resolved.family }]);
              return;
            }
            callback(null, resolved.address, resolved.family);
          }
        }
      });
      pinnedDispatchers.set(dispatcherKey, dispatcher);
    }

    return undiciFetch(input, {
      ...init,
      redirect: 'error',
      dispatcher
    });
  };
}
