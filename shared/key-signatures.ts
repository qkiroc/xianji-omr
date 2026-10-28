export const KEY_NOTES = ["C", "D", "E", "F", "G", "A", "B"] as const;
export const KEY_ACCIDENTALS = ["", "b", "#"] as const;
export const KEY_TONICS = KEY_ACCIDENTALS.flatMap((accidental) => KEY_NOTES.map((note) => note + accidental));
export type KeyKind = "original" | "play";
export interface KeyLabel { tonic: string | null; kind: KeyKind | null }
export interface KeyDataset {
  id: string; name: string; description: string; source_dataset_id: string | null;
  source_name: string | null; sample_count: number; confirmed_count: number; updated_at: string;
}
export interface KeyRecord extends KeyLabel {
  id: string; version: number; status: "draft" | "confirmed"; source_page_id: string; source_box_id: string;
  source: { songId: string; songName: string; pageOrder: number; pageName: string; metadata?: unknown };
  rectangle: { left: number; top: number; width: number; height: number };
  song_group_key: string; split: "train" | "val" | "test";
}
export interface KeyWorkspace {
  dataset: KeyDataset; record: KeyRecord | null; position: number; previousId: string | null; nextId: string | null;
}
export const keyLabelComplete = (label: KeyLabel | null | undefined): boolean =>
  !!label && KEY_TONICS.includes(label.tonic ?? "") && (label.kind === "original" || label.kind === "play");
export function keyShortcut(
  event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; isComposing?: boolean },
  label: KeyLabel, accidental: string,
): { label: KeyLabel; accidental: string } | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null;
  const key = event.key.toLowerCase();
  if (key === "q" || key === "w")
    return { label: { ...label, kind: key === "q" ? "original" : "play" }, accidental };
  if (/^[1-7]$/.test(key))
    return { label: { ...label, tonic: KEY_NOTES[Number(key) - 1] + accidental }, accidental };
  const next = key === "arrowdown" ? "b" : key === "arrowup" ? "#" : key === "0" ? "" : null;
  if (next === null) return null;
  return { label: { ...label, tonic: label.tonic ? label.tonic[0] + next : null }, accidental: next };
}