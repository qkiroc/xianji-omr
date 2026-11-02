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
  const name=RHYTHM_NAMES[index] || "待选区域类别";
  return (r.dots?(["","附点","双附点","三附点"][r.dots]||""):"")+
    (r.kind==="rest"?name.replace("音符","休止符"):name)+
    (r.tuplet?` · ${r.tuplet.actual}:${r.tuplet.normal} 连音`:"")+
    (r.tie?` · 延音${{start:"起点",continue:"中间",stop:"终点"}[r.tie]}`:"");
}
export const TUPLET_OPTIONS=[{value:"",label:"普通时值"},{value:"3:2",label:"三连音（3:2）"},{value:"5:4",label:"五连音（5:4）"},
  {value:"6:4",label:"六连音（6:4）"},{value:"7:4",label:"七连音（7:4）"},{value:"9:8",label:"九连音（9:8）"},{value:"2:3",label:"二连音（2:3）"}];
export function rhythmBeats(label:RhythmLabel):{numerator:number;denominator:number}|null {
  if(label.duration===null)return null;
  const dots=label.dots||0,t=label.tuplet;
  const numerator=4*(2**(dots+1)-1)*(t?.normal||1),denominator=label.duration*2**dots*(t?.actual||1);
  const gcd=(a:number,b:number):number=>b?gcd(b,a%b):a,divisor=gcd(numerator,denominator);
  return {numerator:numerator/divisor,denominator:denominator/divisor};
}
export function orderedEvents(measure: Measure): LocEvent[] {
  return measure.events.filter(e => e.status !== "rejected").slice().sort((a,b) => (a.centerX ?? Infinity)-(b.centerX ?? Infinity) || a.id.localeCompare(b.id));
}
export function within(inner: XYXY, outer: XYXY): boolean {
  return inner[0]>=outer[0] && inner[1]>=outer[1] && inner[2]<=outer[2] && inner[3]<=outer[3];
}
