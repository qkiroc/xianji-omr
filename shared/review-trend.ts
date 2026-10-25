export const REVIEW_TIME_ZONE = "Asia/Shanghai";
export interface ReviewTrendPoint { date: string; count: number; estimated: number }
export interface ReviewTrend {
  days: number;
  timeZone: string;
  points: ReviewTrendPoint[];
  total: number;
  estimated: number;
}
export function reviewWindow(days: number, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: REVIEW_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (key: string) => parts.find((p) => p.type === key)!.value;
  const end = part("year") + "-" + part("month") + "-" + part("day");
  const start = new Date(end + "T00:00:00Z");
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { start: start.toISOString().slice(0, 10), end };
}
const updatedFormat = new Intl.DateTimeFormat("zh-CN", {
  timeZone: REVIEW_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
export function formatUpdatedAt(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? updatedFormat.format(date) : "—";
}
