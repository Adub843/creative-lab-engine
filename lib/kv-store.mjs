// Turns a Workers KV namespace (the IMAGES binding) into the small blob store lib/images.mjs uses.
// Each image is one KV value: the file's bytes, with its name, type, size, tags and date as the
// key's KV metadata, so listing the library is a single list call with no extra reads.
// Keys are stored as "image:<key>" so the namespace can hold other things later without mixing.
//
// Workers KV limits this relies on: values up to 25 MiB (uploads are capped at 20 MB in
// lib/images.mjs), metadata up to 1024 bytes (name and tags are capped there too), and list
// pages of up to 1000 keys (followed here by cursor). KV is eventually consistent: a new or
// deleted image can take up to a minute to show in the list from other locations.
export const PREFIX = "image:";

// prefix: "image:" for the Elevated Designs image library; the Charleston 3D file library uses its own.
// The shirt apps' public list is kept as one saved copy (a single KV read) so their visits don't use KV list
// calls: the free plan allows 1,000 lists a day for the whole account, and when they run out the list fails.
// Any change to the library through this store drops the copy (once until a new copy is saved), so the next read lists again.
export const SNAPSHOT_KEY = "snapshot:public-images";

export function kvBlobStore(kv, prefix = PREFIX) {
  let dropped = false;
  const changed = async () => {
    if (dropped || prefix !== PREFIX) return;
    dropped = true;
    try { await kv.delete(SNAPSHOT_KEY); } catch { /* the copy also expires by age */ }
  };
  return {
    async readSnapshot() {
      if (prefix !== PREFIX) return null;
      try { return await kv.get(SNAPSHOT_KEY, "json"); } catch { return null; }
    },
    async writeSnapshot(snap) {
      if (prefix !== PREFIX) return;
      try { await kv.put(SNAPSHOT_KEY, JSON.stringify(snap)); dropped = false; } catch { /* the next read lists again */ }
    },
    async list() {
      const blobs = [];
      let cursor;
      do {
        const page = await kv.list({ prefix, cursor });
        for (const k of page.keys) blobs.push({ key: k.name.slice(prefix.length), metadata: k.metadata ?? null });
        cursor = page.list_complete ? undefined : page.cursor;
      } while (cursor);
      return { blobs };
    },
    async getWithMetadata(key, { type = "arrayBuffer" } = {}) {
      const { value, metadata } = await kv.getWithMetadata(prefix + key, { type });
      return value === null ? null : { data: value, metadata: metadata ?? {} };
    },
    async set(key, data, { metadata } = {}) {
      await kv.put(prefix + key, data, { metadata });
      await changed();
    },
    async delete(key) {
      await kv.delete(prefix + key);
      await changed();
    },
  };
}
