import next from "next";
import { loadConfig, poolFor } from "./config.ts";
import { assertSchema } from "./migrate.ts";
import { ossStorage } from "./storage.ts";
import { createApp } from "./app.ts";
import { readFile } from "node:fs/promises";
let pool: import("pg").Pool | undefined;
try {
  const config = await loadConfig();
  pool = await poolFor(config);
  await assertSchema(pool);
  const role = (
    await pool.query("SELECT rolsuper FROM pg_roles WHERE rolname=current_user")
  ).rows[0];
  if (role?.rolsuper) throw Error("NON_SUPERUSER_REQUIRED");
  const release = await readFile(
    new URL("../RELEASE", import.meta.url),
    "utf8",
  ).catch(() => "development");
  const nextApp = next({
    dev: false,
    dir: process.cwd(),
    hostname: config.host,
    port: config.port,
  });
  await nextApp.prepare();
  const app = createApp({
    config,
    pool,
    storage: ossStorage(config.oss),
    staticDir: new URL("../static/", import.meta.url).pathname,
    release: release.trim(),
    webHandler: nextApp.getRequestHandler(),
  });
  void app.locals.platform.deletion.recover().catch(() => {});
  const deletionTimer = setInterval(
    () => void app.locals.platform.deletion.recover().catch(() => {}),
    30000,
  );
  deletionTimer.unref();
  await app.locals.platform.exporter.recover();
  const server = app.listen(config.port, config.host, () =>
    console.log("XIANJI_OMR_STARTED"),
  );
  server.on("error", () => {
    console.error("LISTEN_FAILED");
    process.exitCode = 1;
    void pool?.end();
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(async () => {
      await pool?.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} catch {
  console.error("STARTUP_FAILED_CHECK_CONFIG_SCHEMA");
  await pool?.end();
  process.exitCode = 1;
}
