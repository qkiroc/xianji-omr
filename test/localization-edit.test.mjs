import { test } from "node:test";
import assert from "node:assert/strict";
import {
  translateMeasure,
  originalBounds,
} from "../shared/localization-edit.ts";
import { transformBox } from "../server/src/images.ts";
test("八种EXIF工作图→原图谱行上下文边界往返；微调保留小数和整数bbox", () => {
  const b = { x: 13, y: 17, width: 51, height: 37 };
  for (let orientation = 1; orientation <= 8; orientation++) {
    const work = transformBox(b, 200, 160, orientation);
    assert.deepEqual(
      originalBounds(work, orientation, 200, 160),
      [13, 17, 64, 54],
    );
  }
  const m = {
    bbox: [0, 10, 200, 150],
    staffLines: [20.125, 40, 60, 80, 100, 120],
    events: [
      {
        centerX: 50.125,
        bbox: [40, 10, 70, 150],
        contextBBox: [0, 10, 200, 150],
      },
    ],
  };
  translateMeasure(m, 4, 3, 200, 160);
  assert.deepEqual(m.bbox, [0, 13, 200, 153]);
  assert.equal(m.staffLines[0], 23.125);
  assert.equal(m.events[0].centerX, 50.125);
  assert.deepEqual(m.events[0].contextBBox, [0, 13, 200, 153]);
  translateMeasure(m, 0, 1000, 200, 160);
  assert.equal(m.bbox[3], 160);
  assert.ok(m.bbox.every(Number.isSafeInteger));
});
