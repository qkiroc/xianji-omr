/** Translate legacy fragment navigation without guessing source ownership. */
export function legacyTarget(
  fragment: string,
  resolved?: { datasetId: string; songId: string },
): string {
  const query = new URLSearchParams(fragment.replace(/^#/, ""));
  let dataset = query.get("datasetId"),
    song = query.get("editorSongId");
  const page = query.get("pageId");
  if (page && !dataset) {
    if (!resolved) throw Error("旧谱页链接需要先读取原图所属数据集");
    dataset = resolved.datasetId;
    song = resolved.songId;
  }
  let path = "/datasets";
  if (dataset) {
    path += "/" + encodeURIComponent(dataset);
    if (page)
      path +=
        "/songs/" +
        encodeURIComponent(song || "resolve") +
        "/pages/" +
        encodeURIComponent(page);
    else if (song) path += "/songs/" + encodeURIComponent(song);
  }
  for (const key of ["datasetId", "pageId", "editorSongId"]) query.delete(key);
  if (query.has("editorView")) {
    query.set("view", query.get("editorView")!);
    query.delete("editorView");
  }
  return path + (query.size ? "?" + query : "");
}
