type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const SESSION_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, CacheEntry<unknown>>();

function sweepExpiredEntries() {
  const now = Date.now();

  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

export function getSessionCache<T>(key: string) {
  const entry = cache.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value as T;
}

export function setSessionCache<T>(key: string, value: T) {
  sweepExpiredEntries();
  cache.set(key, {
    expiresAt: Date.now() + SESSION_TTL_MS,
    value,
  });
}

