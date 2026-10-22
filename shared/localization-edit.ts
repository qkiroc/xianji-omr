import type { Measure } from "./localization";
export function translateMeasure(
  m: Measure,
  dx: number,
  dy: number,
  width: number,
  height: number,
): void {
  if (!m.bbox) return;
  const xs = [m.bbox[0], m.bbox[2]],
    ys = [m.bbox[1], m.bbox[3], ...(m.staffLines || [])];
  for (const e of m.events) {
    if (e.centerX !== null) xs.push(e.centerX);
    for (const b of [e.bbox, e.contextBBox])
      if (b) {
        xs.push(b[0], b[2]);
        ys.push(b[1], b[3]);
      }
  }
  const x = Math.max(
      Math.ceil(-Math.min(...xs)),
      Math.min(Math.floor(width - Math.max(...xs)), dx),
    ),
    y = Math.max(
      Math.ceil(-Math.min(...ys)),
      Math.min(Math.floor(height - Math.max(...ys)), dy),
    );
  m.bbox = [m.bbox[0] + x, m.bbox[1] + y, m.bbox[2] + x, m.bbox[3] + y];
  if (m.staffLines) m.staffLines = m.staffLines.map((v) => v + y);
  for (const e of m.events) {
    if (e.centerX !== null) e.centerX += x;
    if (e.bbox)
      e.bbox = [e.bbox[0] + x, e.bbox[1] + y, e.bbox[2] + x, e.bbox[3] + y];
    if (e.contextBBox)
      e.contextBBox = [
        e.contextBBox[0] + x,
        e.contextBBox[1] + y,
        e.contextBBox[2] + x,
        e.contextBBox[3] + y,
      ];
  }
}
// Inverse of the existing pixel-v1 EXIF working-image transform.
export function originalBounds(
  b: { x: number; y: number; width: number; height: number },
  orientation: number,
  w: number,
  h: number,
): [number, number, number, number] {
  const inverse = (x: number, y: number): [number, number] => {
    switch (orientation) {
      case 1:
        return [x, y];
      case 2:
        return [w - x, y];
      case 3:
        return [w - x, h - y];
      case 4:
        return [x, h - y];
      case 5:
        return [y, x];
      case 6:
        return [y, h - x];
      case 7:
        return [w - y, h - x];
      case 8:
        return [w - y, x];
      default:
        throw Error("未知坐标方向");
    }
  };
  const points = [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x, b.y + b.height],
    [b.x + b.width, b.y + b.height],
  ].map(([x, y]) => inverse(x, y));
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
}
