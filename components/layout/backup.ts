import { api, json, LayoutDocument, Box } from "../../shared/client";
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((yes, no) => {
    const reader = new FileReader();
    reader.onload = () => yes(String(reader.result));
    reader.onerror = () => no(Error("图片备份读取失败"));
    reader.readAsDataURL(blob);
  });
}
export async function downloadBackup(doc: LayoutDocument): Promise<void> {
  const r = await fetch("/api/v2/pages/" + doc.image.id + "/content", {
    cache: "no-store",
  });
  if (!r.ok) throw Error("工作图读取失败，未生成备份");
  const backup = {
      schemaVersion: 2,
      taxonomyVersion: "layout-v2",
      ...doc,
      dataUrl: await dataUrl(await r.blob()),
    },
    url = URL.createObjectURL(
      new Blob([JSON.stringify(backup)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = doc.image.name + ".layout.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function legacyBoxes(
  boxes: Box[],
  orientation: number,
  w: number,
  h: number,
): Box[] {
  const point = (x: number, y: number): number[] => {
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
        return [h - y, x];
      case 7:
        return [h - y, w - x];
      case 8:
        return [y, w - x];
      default:
        throw Error("图片坐标方向无效");
    }
  };
  return boxes.map((b, i) => {
    const p = [point(b.x, b.y), point(b.x + b.width, b.y + b.height)],
      xs = p.map((p) => p[0]),
      ys = p.map((p) => p[1]);
    return {
      ...b,
      classKey: null,
      parentSystemId: null,
      readingOrder: i,
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.abs(xs[1] - xs[0]),
      height: Math.abs(ys[1] - ys[0]),
      reviewStatus: "draft",
    };
  });
}
export async function importBackup(
  raw: Record<string, unknown>,
  songId: string,
): Promise<LayoutDocument> {
  const image =
      raw.image && typeof raw.image === "object"
        ? (raw.image as Record<string, unknown>)
        : {},
    encoded = raw.dataUrl || image.dataUrl;
  if (
    typeof encoded !== "string" ||
    encoded.length > 29000000 ||
    !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(encoded)
  )
    throw Error("JSON须包含有效图片dataUrl，或选择当前原图的标注JSON");
  if (
    !Array.isArray(raw.boxes) ||
    raw.boxes.length > 5000 ||
    !raw.boxes.every(
      (b) =>
        b &&
        typeof b === "object" &&
        typeof b.id === "string" &&
        ["x", "y", "width", "height"].every((k) => Number.isSafeInteger(b[k])),
    )
  )
    throw Error("标注数组无效");
  const [head, base64] = encoded.split(","),
    blob = new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], {
      type: head.slice(5, head.indexOf(";")),
    });
  if (blob.size > 20 * 1024 * 1024) throw Error("图片超过20MiB");
  const page = await api<LayoutDocument>("/v2/songs/" + songId + "/pages", {
    method: "POST",
    headers: {
      "Content-Type": blob.type,
      "X-File-Name": encodeURIComponent(
        typeof image.name === "string" ? image.name : "imported.png",
      ),
    },
    body: blob,
  });
  try {
    const c = page.image.coordinate as {
        orientation: number;
        original: { width: number; height: number };
      },
      boxes =
        raw.schemaVersion === 2
          ? (raw.boxes as Box[]).map((b) => ({
              ...b,
              reviewStatus: "draft" as const,
            }))
          : legacyBoxes(
              raw.boxes as Box[],
              c.orientation,
              c.original.width,
              c.original.height,
            );
    return await api<LayoutDocument>(
      "/v2/pages/" + page.image.id,
      json(
        {
          version: page.image.version,
          annotationFormat: "layout-v2",
          boxes,
          pageType: image.pageType === "negative" ? "negative" : "music",
        },
        "PUT",
      ),
    );
  } catch (e) {
    throw Error(
      `已创建原图页${page.image.id}，但标注未保存；原记录未覆盖。${e instanceof Error ? e.message : "请重试"}`,
    );
  }
}
