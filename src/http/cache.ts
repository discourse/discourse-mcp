type CacheEntry<T> = { value: T; expiresAt: number };

export class TTLCache<K, V> {
  private map = new Map<K, CacheEntry<V>>();
  constructor(private maxEntries = 100) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number) {
    if (this.map.size >= this.maxEntries) {
      // simple LRU-ish: delete first key
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

