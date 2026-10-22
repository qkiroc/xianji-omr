import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { fixture } from "./fixture.mjs";
import { cookieFor, grantFor, request, json } from "./cli-helpers.mjs";
import { validateGeometry } from "../server/src/localization/geometry.ts";
const sha = (b) => createHash("sha256").update(b).digest("hex");
export async function localizationSetup(f) {
  const cookie = await cookieFor(f),
    grant = await grantFor(f, cookie);
  const api = async (path, opts = {}, status = 200, token = grant.token) => {
    const r = await request(f, "/api/v2" + path, {
      ...opts,
      headers: { Authorization: "Bearer " + token, ...opts.headers },
    });
    const value = await r.json();
    assert.equal(r.status, status, JSON.stringify(value));
    return value;
  };
  const dataset = await api("/datasets", json({ name: "来源数据" }), 201),
    song = await api(
      "/datasets/" + dataset.id + "/songs",
      json({
        name: "老男孩",
        songGroupKey: "real-score:老男孩",
        split: "train",
      }),
      201,
    ),
    bytes = await sharp({
      create: { width: 200, height: 160, channels: 3, background: "#c8d8ea" },
    })
      .png()
      .toBuffer(),
    page = await api(
      "/songs/" + song.id + "/pages",
      { method: "POST", headers: { "Content-Type": "image/png" }, body: bytes },
      201,
    ),
    loc = await api("/localization/datasets", json({ name: "几何定位" }), 201);
  const corpus = {
    version: "omr-event-corpus-v1",
    revision: 2,
    label_format: "omr-music-event-v1",
    source: {
      sample_id: "local-id",
      revision: 1,
      title: "老男孩",
      group_id: "real-score:老男孩",
      domain: "real",
      pages: [
        {
          asset_id: "different-local-page",
          width: 200,
          height: 160,
          sha256: sha(bytes),
          pixel_sha256: sha(await sharp(bytes).raw().toBuffer()),
          coordinate_mapping: [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
        },
      ],
    },
    split: "train",
    provenance: { method: "image_proposals_reference_separate_v1" },
    measures: [
      {
        id: "row1:b1:guitar",
        page_id: "different-local-page",
        bar_number: 1,
        system_id: "row1",
        track: "guitar",
        voice: "1",
        bbox_xyxy: [0, 10, 200, 150],
        staff_lines: [20.125, 40.25, 60.375, 80.5, 100.625, 120.75],
        geometry_reviewed: true,
        completeness_reviewed: true,
        reviewer: "历史AI复核者",
        review_note: "保留证据",
        events: [
          {
            id: "event-stable-1",
            center_x: 50.125,
            bbox_xyxy: [40, 10, 70, 150],
            context_bbox_xyxy: [0, 10, 200, 150],
            review_status: "accepted",
            confidence: null,
            evidence: { candidate_origin: "ai", raw: 17 },
            annotation_source: {
              kind: "visual_review",
              reviewer: "AI",
              observed: true,
            },
            label: { pitch: "DO_NOT_TRAIN" },
          },
        ],
      },
    ],
    relations: [{ unknown: "retain" }],
    texts: [{ text: "retain" }],
    unknown_field: { preserved: true },
  };
  const payload = {
    corpus,
    sourcePageMap: { "different-local-page": page.image.id },
  };
  return {
    api,
    grant,
    cookie,
    dataset,
    song,
    bytes,
    page,
    loc,
    corpus,
    payload,
  };
}
