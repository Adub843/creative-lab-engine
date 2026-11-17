// Charleston 3D's print files in Cloudflare R2 (the FILES bucket), with the same small blob store
// interface as lib/kv-store.mjs, so lib/files.mjs doesn't care where a file lives. R2 has room for the
// whole print library (the free tier is 10 GB); KV holds about 1 GB in all and is shared with the
// Elevated Designs images.
// Each file's name, type, size, tags and date are kept as JSON in the object's custom metadata, so
// listing the library is one list call per 1000 files with no extra reads.
export function r2BlobStore(bucket, prefix) {
  const meta = (o) => { try { return JSON.parse(o?.customMetadata?.meta ?? "null"); } catch { return null; } };
  return {
    async list() {
      const blobs = [];
      let cursor;
      do {
        const page = await bucket.list({ prefix, cursor, include: ["customMetadata"] });
        for (const o of page.objects) blobs.push({ key: o.key.slice(prefix.length), metadata: meta(o) });
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      return { blobs };
    },
    async getWithMetadata(key) {
      const o = await bucket.get(prefix + key);
      return o ? { data: await o.arrayBuffer(), metadata: meta(o) ?? {} } : null;
    },
    async set(key, data, { metadata } = {}) {
      await bucket.put(prefix + key, data, { customMetadata: { meta: JSON.stringify(metadata ?? {}) } });
    },
    async delete(key) {
      await bucket.delete(prefix + key);
    },
  };
}

// New files go to R2; files saved to KV before the move still list, open and delete as before, so
// nothing has to be copied across.
export function combinedStore(primary, older) {
  return {
    async list() {
      const [a, b] = await Promise.all([primary.list(), older.list()]);
      const seen = new Set(a.blobs.map((x) => x.key));
      return { blobs: [...a.blobs, ...b.blobs.filter((x) => !seen.has(x.key))] };
    },
    async getWithMetadata(key, opts) {
      return (await primary.getWithMetadata(key, opts)) ?? (await older.getWithMetadata(key, opts));
    },
    set: (key, data, opts) => primary.set(key, data, opts),
    async delete(key) {
      await Promise.all([primary.delete(key), older.delete(key)]);
    },
  };
}
