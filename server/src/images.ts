import sharp from "sharp";
import { digest, need } from "./annotation.ts";
sharp.cache({ memory: 16, files: 0, items: 16 });
sharp.concurrency(1);
export const IMAGE_LIMIT = 50000000;
export async function inspectImage(data: any, mime: any) {
  need(
    Buffer.isBuffer(data) && data.length > 0 && data.length <= 20 * 1024 * 1024,
    "图片大小必须在20MB以内",
  );
  const m = await sharp(data, { limitInputPixels: IMAGE_LIMIT }).metadata();
  need(
    (
      { png: "image/png", jpeg: "image/jpeg", webp: "image/webp" } as Record<
        string,
        string
      >
    )[m.format] === mime &&
      m.width <= 20000 &&
      m.height <= 20000 &&
      m.width * m.height <= IMAGE_LIMIT &&
      !((m.pages || 1) > 1),
    "仅支持静态PNG/JPG/WebP，边长20000/5000万像素",
  );
  await sharp(data, { limitInputPixels: IMAGE_LIMIT }).stats();
  return m;
}
export function transformBox(b: any, w: any, h: any, o: any) {
  const transform = (x: any, y: any) =>
    (
      ({
        1: [x, y],
        2: [w - x, y],
        3: [w - x, h - y],
        4: [x, h - y],
        5: [y, x],
        6: [h - y, x],
        7: [h - y, w - x],
        8: [y, w - x],
      }) as Record<number, number[]>
    )[o];
  const points = [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x, b.y + b.height],
    [b.x + b.width, b.y + b.height],
  ].map(([x, y]: any) => transform(x, y));
  const xs = points.map((p: any) => p[0]),
    ys = points.map((p: any) => p[1]);
  return {
    ...b,
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}
export async function coordinateImage(data: any, mime: any, key: any) {
  const m = await inspectImage(data, mime),
    orientation = m.orientation || 1;
  const work =
    orientation === 1
      ? data
      : await sharp(data, { limitInputPixels: IMAGE_LIMIT })
          .autoOrient()
          .png()
          .toBuffer();
  need(work.length <= 96 * 1024 * 1024, "方向修正后图片超过96MB");
  const wm = orientation === 1 ? m : await sharp(work).metadata();
  return {
    work,
    coordinate: {
      version: "pixel-v1",
      orientation,
      transform: orientation === 1 ? "identity" : `exif-${orientation}`,
      original: {
        key,
        mime,
        width: m.width,
        height: m.height,
        checksum: digest(data),
        bytes: data.length,
      },
      working: {
        key: orientation === 1 ? key : key + "-working",
        mime: orientation === 1 ? mime : "image/png",
        width: wm.width,
        height: wm.height,
        checksum: digest(work),
        bytes: work.length,
      },
    },
  };
}
