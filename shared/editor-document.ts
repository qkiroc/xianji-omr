import type { LayoutDocument } from "./client";
import { regionShape } from "../server/src/crop-rules";

export function annotationChanged(saved: LayoutDocument | null, current: LayoutDocument) {
  return !saved || saved.image.id !== current.image.id ||
    saved.image.pageType !== current.image.pageType ||
    saved.boxes.length !== current.boxes.length ||
    saved.boxes.some((box, i) => regionShape(box) !== regionShape(current.boxes[i]));
}
