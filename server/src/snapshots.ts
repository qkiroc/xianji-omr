import { randomUUID } from "node:crypto";
import { exportSelection, selectedBoxes } from "./export-selection.ts";
import {
  need,
  ID,
  TAXONOMY,
  LATEST_TAXONOMY,
  CATEGORIES,
  canonicalAnnotation,
  regions,
  digest,
  stable,
} from "./annotation.ts";
import { transaction, datasetRecord } from "./datasets.ts";
export async function freezeSnapshot(
  pool: any,
  datasetId: any,
  { pageIds, classKeys, artifactKinds }: any = {},
) {
  need(ID.test(datasetId), "数据集ID无效");
  const selectionOptions = exportSelection(classKeys, artifactKinds);
  classKeys = selectionOptions.classKeys;
  const maxPages = classKeys ? 5000 : 200, maxBoxes = classKeys ? 100000 : 10000;
  return transaction(
    pool,
    async (c: any) => {
      const dataset = await datasetRecord(c, datasetId, { lock: true });
      need(
        pageIds === undefined ||
          (Array.isArray(pageIds) &&
            pageIds.length > 0 &&
            pageIds.length <= maxPages &&
            new Set(pageIds).size === pageIds.length &&
            pageIds.every((id: any) => ID.test(id))),
        `本批需选择1–${maxPages}张不重复原图`,
      );
      const selection = [datasetId, pageIds || null, classKeys || null];
      const categoryScope = " AND ($3::text[] IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(i.boxes) b WHERE b->>'classKey'=ANY($3::text[])))";
      if (pageIds) {
        const eligible = (await c.query(
          "SELECT count(*)::int n FROM omr_images i JOIN omr_songs s ON s.id=i.song_id WHERE s.dataset_id=$1 AND s.deleted_at IS NULL AND i.status='confirmed' AND i.deleted_at IS NULL AND i.id=ANY($2::uuid[])",
          [datasetId, pageIds],
        )).rows[0].n;
        need(eligible === pageIds.length, "只能导出本数据集内已确认且未删除的原图", 409);
      }
      const songs = (
        await c.query(
          "SELECT * FROM omr_songs WHERE dataset_id=$1 AND deleted_at IS NULL ORDER BY id",
          [datasetId],
        )
      ).rows;
      const size = (
        await c.query(
          "SELECT count(*)::int pages,COALESCE(sum(jsonb_array_length(i.boxes)),0)::int boxes FROM omr_images i JOIN omr_songs s ON s.id=i.song_id WHERE s.dataset_id=$1 AND s.deleted_at IS NULL AND i.status='confirmed' AND i.deleted_at IS NULL AND ($2::uuid[] IS NULL OR i.id=ANY($2))" + categoryScope,
          selection,
        )
      ).rows[0];
      need(
        size.pages <= maxPages && size.boxes <= maxBoxes,
        `本次导出最多${maxPages}确认源页和${maxBoxes}来源框，请用pageIds选择一批确认页导出`,
      );
      const sources = (
        await c.query(
          "SELECT i.* FROM omr_images i JOIN omr_songs s ON s.id=i.song_id WHERE s.dataset_id=$1 AND s.deleted_at IS NULL AND i.status='confirmed' AND i.deleted_at IS NULL AND ($2::uuid[] IS NULL OR i.id=ANY($2))" + categoryScope + " ORDER BY i.id LIMIT " + (maxPages + 1),
          selection,
        )
      ).rows;
      need(sources.length > 0, classKeys ? "没有包含所选类别的已确认页面，无法导出" : "没有已确认页面，无法导出");
      need(sources.length <= maxPages, `每次快照最多${maxPages}确认源页`);
      const groupSplit = new Map();
      for (const s of songs) {
        need(
          !groupSplit.has(s.song_group_key) ||
            groupSplit.get(s.song_group_key) === s.split,
          "同曲目组跨split，拒绝导出",
          409,
          { songGroupKey: s.song_group_key },
        );
        groupSplit.set(s.song_group_key, s.split);
      }
      const selectedSplits = new Map(
        sources.map((p: any) => [
          p.checksum,
          songs.find((s: any) => s.id === p.song_id).split,
        ]),
      );
      const related = (
        await c.query(
          "SELECT i.id,i.checksum,s.split FROM omr_images i JOIN omr_songs s ON s.id=i.song_id WHERE s.dataset_id=$1 AND s.deleted_at IS NULL AND i.deleted_at IS NULL AND i.status='confirmed' AND i.checksum=ANY($2::text[])",
          [datasetId, [...selectedSplits.keys()]],
        )
      ).rows;
      for (const p of related)
        need(
          selectedSplits.get(p.checksum) === p.split,
          "同一原图跨split，当前批次也不能绕过隔离检查",
          409,
          { pageId: p.id },
        );
      const byChecksum = new Map(),
        unique: any[] = [];
      for (const page of sources) {
        const song = songs.find((s: any) => s.id === page.song_id);
        need(
          page.coordinate && page.annotation_format === TAXONOMY,
          "确认页缺少工作图/类别信息",
          409,
          { pageId: page.id },
        );
        regions(
          page.boxes,
          page.coordinate.working.width,
          page.coordinate.working.height,
          {
            confirm: true,
            pageType: page.page_type,
            taxonomyVersion: page.annotation_version || TAXONOMY,
          },
        );
        const canonical = canonicalAnnotation(page.boxes, page.page_type);
        const existing = byChecksum.get(page.checksum);
        const alias = {
          pageId: page.id,
          songId: song.id,
          songGroupKey: song.song_group_key,
          songVersion: song.version,
          sourceVersion: page.version,
          annotationFormat: page.annotation_version || TAXONOMY,
          source: page.source || "",
          pageOrder: page.page_order,
          name: page.original_name,
        };
        if (existing) {
          need(
            existing.split === song.split,
            "同一原图跨split，拒绝导出",
            409,
            { pages: [existing.id, page.id] },
          );
          need(
            stable({
              ...existing.coordinate,
              original: { ...existing.coordinate.original, key: undefined },
              working: { ...existing.coordinate.working, key: undefined },
            }) ===
              stable({
                ...page.coordinate,
                original: { ...page.coordinate.original, key: undefined },
                working: { ...page.coordinate.working, key: undefined },
              }) && existing.canonical === canonical,
            "同图的坐标图像或标注不一致，拒绝静默去重",
            409,
            { pages: [existing.id, page.id] },
          );
          existing.aliases.push(alias);
        } else {
          const item = {
            id: page.id,
            annotationFormat: page.annotation_version || TAXONOMY,
            coordinate: page.coordinate,
            boxes: page.boxes,
            pageType: page.page_type,
            split: song.split,
            canonical,
            aliases: [alias],
          };
          byChecksum.set(page.checksum, item);
          unique.push(item);
        }
      }
      const draftCount = Number(
        (
          await c.query(
            "SELECT count(*) n FROM omr_images i JOIN omr_songs s ON s.id=i.song_id WHERE s.dataset_id=$1 AND s.deleted_at IS NULL AND i.status<>'confirmed' AND i.deleted_at IS NULL",
            [datasetId],
          )
        ).rows[0].n,
      );
      const frozen = JSON.parse(
        JSON.stringify({
          schemaVersion: 2,
          ...(Object.keys(selectionOptions).length ? { selection: selectionOptions } : {}),
          taxonomyVersion: sources.some(
            (p: any) => p.annotation_version === LATEST_TAXONOMY,
          )
            ? LATEST_TAXONOMY
            : TAXONOMY,
          dataset: {
            id: dataset.id,
            name: dataset.name,
            version: dataset.version,
            task: "layout",
          },
          songs: songs.map((s: any) => ({
            id: s.id,
            name: s.name,
            songGroupKey: s.song_group_key,
            split: s.split,
            version: s.version,
          })),
          images: unique.map(({ canonical, ...i }: any) => i),
          stats: {
            sourcePages: sources.length,
            uniqueImages: unique.length,
            sourceBoxes: sources.reduce(
              (n: any, p: any) => n + selectedBoxes(p.boxes, classKeys).length,
              0,
            ),
            uniqueBoxes: unique.reduce(
              (n: any, p: any) => n + selectedBoxes(p.boxes, classKeys).length,
              0,
            ),
            excludedDrafts: draftCount,
          },
          warnings: [
            ...(!unique.some((i: any) => i.split === "val")
              ? ["没有独立验证集"]
              : []),
            ...(!unique.some((i: any) => i.split === "test")
              ? ["没有独立测试集"]
              : []),
          ],
        }),
      );
      const id = randomUUID();
      await c.query(
        "INSERT INTO omr_snapshots(id,dataset_id,frozen) VALUES($1,$2,$3)",
        [id, datasetId, frozen],
      );
      return { id, frozen };
    },
    { isolation: "REPEATABLE READ" },
  );
}
