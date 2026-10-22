import { test } from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture.mjs";
import { cookieFor, grantFor, request, json } from "./cli-helpers.mjs";
import {
  withLock,
  migrate,
  checkHistory,
  backup,
  command,
} from "../server/src/migrate.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
test("schema4带7页人工确认/回收站/会话/grant/快照升5，幂等及真实dump恢复保全", async (t) => {
  const f = await fixture({ port: 55463, migrationVersion: 4 });
  t.after(() => f.close());
  const cookie = await cookieFor(f),
    grant = await grantFor(f, cookie);
  await f.pool.query(
    "INSERT INTO omr_images(id,object_key,original_name,mime,width,height,checksum,boxes,status,version,deleted_at) SELECT gen_random_uuid(),'omr/migration-'||n,'confirmed-'||n,'image/png',200,160,repeat('a',64),'[]','confirmed',11,CASE WHEN n=8 THEN now() ELSE NULL END FROM generate_series(1,8)n",
  );
  await f.pool.query(
    "INSERT INTO omr_snapshots(id,dataset_id,frozen,status) VALUES(gen_random_uuid(),'00000000-0000-4000-8000-000000000001',$1,'failed')",
    [{ preserved: "immutable-old" }],
  );
  const before = (await f.pool.query("SELECT * FROM omr_images ORDER BY id"))
      .rows,
    oldSnapshot = (await f.pool.query("SELECT frozen FROM omr_snapshots")).rows;
  const dir = await mkdtemp(join(tmpdir(), "omr-schema5-backup-")),
    dump = await backup(f.config, dir);
  await withLock(f.pool, (c) => migrate(c));
  await withLock(f.pool, (c) => migrate(c));
  assert.equal(await checkHistory(f.pool), 5);
  assert.deepEqual(
    (await f.pool.query("SELECT * FROM omr_images ORDER BY id")).rows,
    before,
  );
  assert.deepEqual(
    (await f.pool.query("SELECT frozen FROM omr_snapshots")).rows,
    oldSnapshot,
  );
  assert.equal(
    (
      await f.pool.query(
        "SELECT count(*) n FROM omr_images WHERE status='confirmed' AND deleted_at IS NULL",
      )
    ).rows[0].n,
    "7",
  );
  assert.equal(
    (await request(f, "/api/session", { headers: { Cookie: cookie } })).status,
    200,
  );
  assert.equal(
    (
      await request(f, "/api/v2/localization/datasets", {
        headers: { Authorization: "Bearer " + grant.token },
      })
    ).status,
    200,
  );
  const admin = new pg.Client({
    host: "127.0.0.1",
    port: 55463,
    user: "postgres",
    database: "postgres",
  });
  await admin.connect();
  await admin.query("CREATE DATABASE omr_before5 OWNER xianji_omr");
  await admin.end();
  await command(
    "pg_restore",
    [
      "--single-transaction",
      "--no-owner",
      "--no-acl",
      "-d",
      "omr_before5",
      dump,
    ],
    {
      env: {
        ...process.env,
        PGHOST: "127.0.0.1",
        PGPORT: "55463",
        PGUSER: "xianji_omr",
      },
    },
  );
  const restored = new pg.Client({
    host: "127.0.0.1",
    port: 55463,
    user: "xianji_omr",
    database: "omr_before5",
  });
  await restored.connect();
  assert.equal(
    (await restored.query("SELECT count(*) n FROM omr_migrations")).rows[0].n,
    "4",
  );
  assert.deepEqual(
    (await restored.query("SELECT * FROM omr_images ORDER BY id")).rows,
    before,
  );
  await restored.end();
});
