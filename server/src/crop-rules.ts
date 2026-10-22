// Shared by canvas previews and the exporter: exact integer bounds, no padding.
export function cropRectangle(b: any, width: any, height: any) {
  if (
    !b ||
    !["x", "y", "width", "height"].every((k: any) =>
      Number.isSafeInteger(b[k]),
    ) ||
    b.x < 0 ||
    b.y < 0 ||
    b.width < 1 ||
    b.height < 1 ||
    b.x + b.width > width ||
    b.y + b.height > height
  )
    throw Error("选区越界、尺寸为零或不是整数像素");
  return { left: b.x, top: b.y, width: b.width, height: b.height };
}
const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .filter((k: any) => v[k] !== undefined)
            .map((k: any) => [k, canonical(v[k])]),
        )
      : v;
export const regionShape = (b: any) =>
  JSON.stringify(
    canonical(
      Object.fromEntries(
        [
          "id",
          "classKey",
          "parentSystemId",
          "readingOrder",
          "x",
          "y",
          "width",
          "height",
          "metadata",
        ].map((k: any) => [k, b[k]]),
      ),
    ),
  );
export const regionReview = (box: any, pageStatus: any) =>
  box.reviewStatus || (pageStatus === "confirmed" ? "confirmed" : "draft");
export const sortCrops = (boxes: any) =>
  [...boxes].sort(
    (a: any, b: any) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id),
  );
export function mergeRegionReviews(before: any, after: any, pageStatus: any) {
  const old = new Map<string, any>(before.map((b: any) => [b.id, b]));
  return after.map((b: any) => {
    const prior = old.get(b.id);
    const same = prior && regionShape(prior) === regionShape(b);
    const review = same ? regionReview(prior, pageStatus) : "draft";
    const { reviewStatus, ...value } = b;
    return review !== "draft" || prior?.reviewStatus || b.reviewStatus
      ? { ...value, reviewStatus: review }
      : value;
  });
}
