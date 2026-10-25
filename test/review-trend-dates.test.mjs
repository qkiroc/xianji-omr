import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewWindow, formatUpdatedAt } from "../shared/review-trend.ts";
test("Review days and updated timestamps use Beijing midnight across year boundaries", () => {
  assert.deepEqual(reviewWindow(7, new Date("2025-12-31T15:59:59Z")), { start: "2025-12-25", end: "2025-12-31" });
  assert.deepEqual(reviewWindow(7, new Date("2025-12-31T16:00:00Z")), { start: "2025-12-26", end: "2026-01-01" });
  assert.match(formatUpdatedAt("2025-12-31T16:01:00Z"), /2026\/01\/01 00:01/);
  assert.equal(formatUpdatedAt("invalid"), "—");
  assert.equal(formatUpdatedAt(), "—");
});

