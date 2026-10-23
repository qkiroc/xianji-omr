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
