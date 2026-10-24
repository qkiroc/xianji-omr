export function songEditorTarget(
  datasetId: string,
  song: { id: string; first_page_id: string | null },
  query: string,
) {
  const q = new URLSearchParams(query);
  q.delete("box");
  const base = `/datasets/${encodeURIComponent(datasetId)}/songs/${encodeURIComponent(song.id)}`;
  return (
    base +
    (song.first_page_id
      ? `/pages/${encodeURIComponent(song.first_page_id)}`
      : "") +
    (q.size ? "?" + q : "")
  );
}

export interface PageTarget {
  id: string;
  songId: string;
}
export interface PageNeighbors {
  previousPage: PageTarget | null;
  nextPage: PageTarget | null;
}
const reviewStates = new Set(["draft", "ai_reviewed", "confirmed", "legacy"]);
export const reviewLabels: Record<string, string> = {
  draft: "草稿",
  ai_reviewed: "AI 已复核",
  confirmed: "已确认",
  legacy: "历史未归类",
};
export function reviewQueue(
  query: URLSearchParams,
  image: { status: string; annotationFormat: string },
) {
  const explicit = query.get("queue") || query.get("status");
  return explicit && reviewStates.has(explicit)
    ? explicit
    : image.annotationFormat === "legacy" ? "legacy" : image.status;
}
export function reviewQueueQuery(query: URLSearchParams, queue: string) {
  const result = new URLSearchParams();
  for (const key of ["search", "split", "songId"])
    if (query.get(key)) result.set(key, query.get(key)!);
  if (reviewStates.has(queue)) result.set("status", queue);
  return result;
}
export function pageEditorTarget(
  datasetId: string,
  target: PageTarget,
  query: URLSearchParams,
  queue: string,
) {
  const next = new URLSearchParams(query);
  next.delete("box");
  next.set("queue", queue);
  return `/datasets/${encodeURIComponent(datasetId)}/songs/${encodeURIComponent(target.songId)}/pages/${encodeURIComponent(target.id)}?${next}`;
}
export function pageTrailKey(datasetId: string, query: URLSearchParams, queue: string) {
  return "omr-review:" + datasetId + "?" + reviewQueueQuery(query, queue);
}
export function readPageTrail(storage: Pick<Storage, "getItem">, key: string): PageTarget[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(value)
      ? value.filter((p): p is PageTarget =>
          p !== null && typeof p === "object" &&
          typeof p.id === "string" && typeof p.songId === "string",
        ).slice(-100)
      : [];
  } catch {
    return [];
  }
}
export function writePageTrail(
  storage: Pick<Storage, "setItem">, key: string, trail: PageTarget[],
) {
  try { storage.setItem(key, JSON.stringify(trail.slice(-100))); } catch {}
}
