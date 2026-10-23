import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteOssKeyPermanently } from "../server/src/oss-delete.ts";
test("OSS未版本化时正常删除；无版本状态读取权限时不触碰对象", async () => {
  const calls = [];
  await deleteOssKeyPermanently(
    {
      async getBucketVersioning() {
        return {};
      },
      async delete(...x) {
        calls.push(x);
      },
    },
    "private",
    "omr/key",
  );
  assert.deepEqual(calls, [["omr/key"]]);
  await assert.rejects(
    deleteOssKeyPermanently(
      {
        async getBucketVersioning() {
          throw Error("denied");
        },
        async delete() {
          assert.fail("must not delete");
        },
      },
      "private",
      "omr/key",
    ),
  );
});
test("OSS版本化/暂停：分页清理全部版本与删除标记，只处理精确key，不删除相邻前缀对象", async () => {
  for (const state of ["Enabled", "Suspended"]) {
    let read = 0;
    const calls = [];
    const client = {
      async getBucketVersioning() {
        return { versionStatus: state };
      },
      async getBucketVersions(q) {
        assert.equal(q.prefix, "omr/key");
        read++;
        if (read === 1)
          return {
            objects: [
              { name: "omr/key", versionId: "v1" },
              { name: "omr/key-other", versionId: "keep" },
            ],
            deleteMarker: [{ name: "omr/key", versionId: "marker" }],
            isTruncated: true,
            nextKeyMarker: "omr/key",
            nextVersionIdMarker: "v1",
          };
        if (read === 2) {
          assert.equal(q.versionIdMarker, "v1");
          return { objects: [{ name: "omr/key", versionId: "null" }] };
        }
        return {};
      },
      async delete(k, o) {
        calls.push([k, o.versionId]);
      },
    };
    await deleteOssKeyPermanently(client, "private", "omr/key");
    assert.deepEqual(calls, [
      ["omr/key", "v1"],
      ["omr/key", "marker"],
      ["omr/key", "null"],
    ]);
    assert.equal(read, 3);
  }
});
test("OSS分页无游标、缺版本ID或删除后仍残留时拒绝报告完成", async () => {
  const base = {
    async getBucketVersioning() {
      return { versionStatus: "Enabled" };
    },
    async delete() {},
  };
  await assert.rejects(
    deleteOssKeyPermanently(
      {
        ...base,
        async getBucketVersions() {
          return { isTruncated: true };
        },
      },
      "private",
      "omr/key",
    ),
    /PAGINATION/,
  );
  await assert.rejects(
    deleteOssKeyPermanently(
      {
        ...base,
        async getBucketVersions() {
          return { objects: [{ name: "omr/key" }] };
        },
      },
      "private",
      "omr/key",
    ),
    /VERSION_ID/,
  );
  await assert.rejects(
    deleteOssKeyPermanently(
      {
        ...base,
        async getBucketVersions() {
          return { objects: [{ name: "omr/key", versionId: "still-present" }] };
        },
      },
      "private",
      "omr/key",
    ),
    /REMAIN/,
  );
});
test("部署权限探测只读：版本化桶按应用前缀maxKeys1探测，拒绝时不触碰对象", async () => {
  const { probeOssPermanentDeleteAccess } = await import(
    "../server/src/oss-delete.ts"
  );
  const calls = [];
  await probeOssPermanentDeleteAccess(
    {
      async getBucketVersioning(b) {
        calls.push(b);
        return { versionStatus: "Enabled" };
      },
      async getBucketVersions(q) {
        calls.push(q);
        return {};
      },
      async delete() {
        assert.fail("probe must not delete");
      },
    },
    "private",
    "omr/",
  );
  assert.deepEqual(calls, ["private", { prefix: "omr/", maxKeys: 1 }]);
  await assert.rejects(
    probeOssPermanentDeleteAccess(
      {
        async getBucketVersioning() {
          throw Error("denied");
        },
      },
      "private",
      "omr/",
    ),
  );
});
