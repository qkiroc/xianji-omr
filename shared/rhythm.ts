import type { RhythmDuration, RhythmLabel, Measure, LocEvent, XYXY } from "./localization";
export const RHYTHM_VALUES = [1, 2, 4, 8, 16, 32] as const;
export const RHYTHM_NAMES = ["全音符", "二分音符", "四分音符", "八分音符", "十六分音符", "三十二分音符"];
export const TRACK_NAMES = { guitar: "六线谱", melody: "简谱", lyrics: "歌词" };
export function newRhythm(track: Measure["track"], duration: RhythmDuration = 4): RhythmLabel {
  return { duration: track === "lyrics" ? null : duration };
}
export function eventName(event: LocEvent): string {
  const r = event.rhythm;
  if (!r) return "未标时值";
  if (r.duration === null) return "歌词区域";
  const index = RHYTHM_VALUES.indexOf(r.duration as RhythmDuration);
  return RHYTHM_NAMES[index] || "待选区域类别";
}
export function orderedEvents(measure: Measure): LocEvent[] {
  return measure.events.filter(e => e.status !== "rejected").slice().sort((a,b) => (a.centerX ?? Infinity)-(b.centerX ?? Infinity) || a.id.localeCompare(b.id));
}
export function within(inner: XYXY, outer: XYXY): boolean {
  return inner[0]>=outer[0] && inner[1]>=outer[1] && inner[2]<=outer[2] && inner[3]<=outer[3];
}
