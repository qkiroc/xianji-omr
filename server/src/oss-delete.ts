/** Remove an exact key including historical versions; never broaden to a prefix delete. */
export async function deleteOssKeyPermanently(
  client: any,
  bucket: string,
  key: string,
) {
  const state = (await client.getBucketVersioning(bucket)).versionStatus;
  if (state === undefined || state === null || state === "") {
    await client.delete(key);
    return;
  }
  if (!["Enabled", "Suspended"].includes(state))
    throw Error("OSS_VERSIONING_UNKNOWN");
  async function versions() {
    const found: string[] = [];
    let keyMarker: string | undefined, versionIdMarker: string | undefined;
    const cursors = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const r = await client.getBucketVersions({
        prefix: key,
        maxKeys: 1000,
        ...(keyMarker ? { keyMarker } : {}),
        ...(versionIdMarker ? { versionIdMarker } : {}),
      });
      for (const item of [...(r.objects || []), ...(r.deleteMarker || [])])
        if (item.name === key) {
          if (typeof item.versionId !== "string" || !item.versionId)
            throw Error("OSS_VERSION_ID_MISSING");
          found.push(item.versionId);
          if (found.length > 10000) throw Error("OSS_VERSION_LIMIT");
        }
      if (!r.isTruncated) return [...new Set(found)];
      const next = JSON.stringify([r.nextKeyMarker, r.nextVersionIdMarker]);
      if (!r.nextKeyMarker || cursors.has(next))
        throw Error("OSS_VERSION_PAGINATION_INVALID");
      cursors.add(next);
      keyMarker = r.nextKeyMarker;
      versionIdMarker = r.nextVersionIdMarker;
    }
    throw Error("OSS_VERSION_PAGE_LIMIT");
  }
  for (const versionId of await versions())
    await client.delete(key, { versionId });
  if ((await versions()).length) throw Error("OSS_VERSIONS_REMAIN");
}
/** Read-only deployment probe. Delete permissions cannot be tested without deleting data. */
export async function probeOssPermanentDeleteAccess(
  client: any,
  bucket: string,
  prefix: string,
) {
  const { versionStatus } = await client.getBucketVersioning(bucket);
  if (versionStatus === "Enabled" || versionStatus === "Suspended")
    await client.getBucketVersions({ prefix, maxKeys: 1 });
  else if (
    versionStatus !== undefined &&
    versionStatus !== null &&
    versionStatus !== ""
  )
    throw Error("OSS_VERSIONING_UNKNOWN");
}
