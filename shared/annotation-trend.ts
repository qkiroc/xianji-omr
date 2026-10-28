export const ANNOTATION_TREND_DAYS = [7, 14, 30, 90] as const;
export interface AnnotationTrend {
  days: number; timeZone: "Asia/Shanghai"; start: string; end: string;
  total: number; today: number; estimated: number;
  points: { date: string; count: number; estimated: number }[];
}
export function annotationWindow(days: number, now = new Date()) {
  if (!(ANNOTATION_TREND_DAYS as readonly number[]).includes(days)) throw Error("INVALID_TREND_DAYS");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  const end = part("year") + "-" + part("month") + "-" + part("day");
  const dates = Array.from({ length: days }, (_, i) => {
    const date = new Date(end + "T00:00:00Z");
    date.setUTCDate(date.getUTCDate() - days + i + 1);
    return date.toISOString().slice(0, 10);
  });
  return { start: dates[0], end, dates };
}
export function annotationTrend(days: number, rows: { date: string; count: number | string; estimated: number | string }[], now = new Date()): AnnotationTrend {
  const window = annotationWindow(days, now), values = new Map(rows.map((r) => [r.date, r]));
  const points = window.dates.map((date) => ({ date, count: Number(values.get(date)?.count || 0), estimated: Number(values.get(date)?.estimated || 0) }));
  return { days, timeZone: "Asia/Shanghai", start: window.start, end: window.end, points,
    total: points.reduce((sum, p) => sum + p.count, 0), today: points.at(-1)!.count,
    estimated: points.reduce((sum, p) => sum + p.estimated, 0) };
}