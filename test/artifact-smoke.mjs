// Explicit cloud-only acceptance of an actual supplied prebuilt archive; no real cloud config.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { verifyArchive } from "../deploy/artifact.mjs";
import { fixture } from "./fixture.mjs";
import { workflow } from "./cli-workflow.mjs";
const [archive, sha, node22] = process.argv.slice(2);
assert.ok(
  archive && sha && node22,
  "用法 node test/artifact-smoke.mjs archive SHA256 /node22/bin/node",
);
await verifyArchive(archive, sha);
const root = await mkdtemp(join(tmpdir(), "omr-built-smoke-"));
execFileSync("tar", ["-xzf", archive, "-C", root]);
const manifest = JSON.parse(
  await readFile(join(root, "artifact.json"), "utf8"),
);
execFileSync(
  node22,
  [join(root, "deploy/artifact.mjs"), "release", root, manifest.commit],
  { stdio: "inherit" },
);
const { createApp } = await import(
  pathToFileURL(join(root, "server/src/app.ts"))
);
const { default: next } = await import(
  pathToFileURL(join(root, "node_modules/next/dist/server/next.js"))
);
const app = next({ dev: false, dir: root });
await app.prepare();
const f = await fixture({
  port: 55464,
  appFactory: createApp,
  webHandler: app.getRequestHandler(),
});
try {
  const cliDir = await mkdtemp(join(tmpdir(), "omr-built-cli-"));
  const packed = JSON.parse(
    execFileSync(
      process.execPath,
      [
        new URL("../tools/package-cli.mjs", import.meta.url).pathname,
        "--output",
        cliDir,
      ],
      { encoding: "utf8" },
    ),
  );
  execFileSync("tar", ["-xzf", packed.archive, "-C", cliDir]);
  const result = await workflow(
    f,
    join(cliDir, "xianji-omr-cli-0.3.0/xianji-omr.mjs"),
  );
  assert.equal(result.templates, 50);
  assert.equal((await fetch(f.url + "/datasets")).status, 200);
  assert.equal((await fetch(f.url + "/unknown")).status, 404);
  assert.equal((await fetch(f.url + "/_next/static/missing.js")).status, 404);
  assert.ok(!manifest.files["node_modules/embedded-postgres/package.json"]);
  assert.ok(
    !Object.keys(manifest.files).some(
      (p) =>
        p.startsWith("test/") ||
        p === "config.json" ||
        p === "server/config.json",
    ),
  );
  console.log(
    JSON.stringify({
      acceptance: "standalone extracted API + Next + offline CLI",
      templates: 50,
      commit: manifest.commit,
      platform: manifest.platform,
      arch: manifest.arch,
      nodeBuild: manifest.nodeBuilt,
    }),
  );
} finally {
  await f.close();
  await app.close();
}
