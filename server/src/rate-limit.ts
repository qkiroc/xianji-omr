// Fixed-capacity per-process limiter. Rejected new keys are never retained.
export function createLimiter({
  capacity = 2000,
  windowMs = 600000,
  now = Date.now,
}: any = {}) {
  const buckets = new Map();
  return {
    get size() {
      return buckets.size;
    },
    allow(key: any, max: any) {
      const time = now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.until <= time) {
        if (!bucket && buckets.size >= capacity) {
          for (const [k, v] of buckets) if (v.until <= time) buckets.delete(k);
          if (buckets.size >= capacity) return false;
        }
        bucket = { until: time + windowMs, n: 0 };
        buckets.set(key, bucket);
      }
      return ++bucket.n <= max;
    },
  };
}
