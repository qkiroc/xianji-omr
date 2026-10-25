import { reviewWindow, REVIEW_TIME_ZONE, type ReviewTrend } from "../../shared/review-trend.ts";

export async function humanReviewTrend(c: any, scope: { where: string; params: any[] }, days: number): Promise<ReviewTrend> {
  const { start, end } = reviewWindow(days);
  const n = scope.params.length + 1;
  const points = (await c.query(
    `WITH events AS (
       SELECT history.key AS date,
         COALESCE((history.value->>'estimated')::boolean,false) AS estimated
       FROM omr_images i JOIN omr_songs s ON s.id=i.song_id
       CROSS JOIN LATERAL jsonb_each(i.human_reviews) history
       WHERE ${scope.where} AND history.key BETWEEN $${n} AND $${n + 1}
     ), days AS (
       SELECT ($${n}::date + offset_day)::text AS date
       FROM generate_series(0, $${n + 1}::date - $${n}::date) offset_day
     )
     SELECT days.date, count(events.date)::int AS count,
       count(events.date) FILTER (WHERE events.estimated)::int AS estimated
     FROM days LEFT JOIN events ON events.date=days.date
     GROUP BY days.date ORDER BY days.date`,
    [...scope.params, start, end],
  )).rows;
  return {
    days, timeZone: REVIEW_TIME_ZONE, points,
    total: points.reduce((n: number, p: any) => n + p.count, 0),
    estimated: points.reduce((n: number, p: any) => n + p.estimated, 0),
  };
}
