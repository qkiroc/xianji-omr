// Cloud build only. Output is deliberately outside the tracked repository.
import {
  mkdtemp,
  cp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  lstat,
  rm,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn, execFileSync } from "node:child_process";
const root = resolve(new URL("..", import.meta.url).pathname),
  out = resolve(process.argv[2] || join(root, ".artifacts"));
if (
  process.platform !== "linux" ||
  process.arch !== "x64" ||
  Number(process.versions.node.split(".")[0]) !== 22
)
  throw Error("BUILD_REQUIRES_LINUX_X64_NODE22");
const run = (bin, args, cwd = root) =>
  new Promise((yes, no) => {
    const p = spawn(bin, args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    });
    p.on("error", no);
    p.on("exit", (c) => (c ? no(Error("BUILD_STEP_FAILED " + bin)) : yes()));
  });
const compatibility = JSON.parse(await readFile(join(root, "server/compatibility.json"), "utf8"));
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (
  execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim()
)
  throw Error("BUILD_REQUIRES_COMMITTED_SOURCE");
await run(process.execPath, ["server/build.mjs"]);
const stage = await mkdtemp(join(tmpdir(), "omr-standalone-"));
await mkdir(out, { recursive: true });
try {
  const sourceArchive = join(stage, "source.tar");
  await run("git", [
    "archive",
    "HEAD",
    "--output=" + sourceArchive,
    "package.json",
    "package-lock.json",
    "server",
    "deploy",
    "shared",
    "next.config.ts",
    "tsconfig.json",
    "next-env.d.ts",
    "app",
    "components",
  ]);
  await run("tar", ["-xf", sourceArchive, "-C", stage]);
  await rm(sourceArchive);
  // Install exclusively from lock; no fixtures, database binaries, tests or private config.
  await run(
    "npm",
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    stage,
  );
  async function prune(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          [
            "test",
            "tests",
            "__tests__",
            "fixture",
            "fixtures",
            "__fixtures__",
          ].includes(entry.name.toLowerCase())
        )
          await rm(p, { recursive: true, force: true });
        else await prune(p);
      } else if (
        entry.isFile() &&
        /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)
      )
        await rm(p);
    }
  }
  await prune(join(stage, "node_modules"));
  await rm(join(stage, "server/config.example.json"), { force: true });
  await cp(join(root, ".next/standalone/.next"), join(stage, ".next"), {
    recursive: true,
  });
  await cp(join(root, ".next/static"), join(stage, ".next/static"), {
    recursive: true,
  });
  const files = {};
  async function walk(dir, relative = "") {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      const rel = relative ? relative + "/" + ent.name : ent.name,
        p = join(dir, ent.name);
      if (ent.isDirectory()) await walk(p, rel);
      else if (ent.isFile() || ent.isSymbolicLink()) {
        const h = createHash("sha256");
        for await (const b of createReadStream(p)) h.update(b);
        files[rel] = h.digest("hex");
      } else throw Error("UNSUPPORTED_PACKAGE_ENTRY");
    }
  }
  await walk(stage);
  await writeFile(
    join(stage, "artifact.json"),
    JSON.stringify(
      {
        format: "xianji-omr-standalone-v1",
        commit,
        platform: "linux",
        arch: "x64",
        nodeMajor: 22,
        nodeBuilt: process.version,
        schema: compatibility.schemaMax,
        files,
      },
      null,
      2,
    ) + "\n",
  );
  const name = "xianji-omr-" + commit.slice(0, 12) + "-linux-x64-node22.tar.gz",
    target = join(out, name);
  await run("tar", [
    "--dereference",
    "--hard-dereference",
    "-czf",
    target,
    "-C",
    stage,
    ".",
  ]);
  const hash = createHash("sha256");
  for await (const b of createReadStream(target)) hash.update(b);
  const sha = hash.digest("hex");
  await writeFile(target + ".sha256", sha + "  " + name + "\n");
  console.log(JSON.stringify({ path: target, sha256: sha, commit }));
} finally {
  await rm(stage, { recursive: true, force: true });
}
