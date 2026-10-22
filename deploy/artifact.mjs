// Verifies an externally supplied prebuilt archive before extraction. No credentials.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
export async function verifyArchive(file, expected) {
  if (!/^[a-f0-9]{64}$/.test(expected || ""))
    throw Error("ARTIFACT_SHA256_REQUIRED");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest("hex") !== expected)
    throw Error("ARTIFACT_CHECKSUM_MISMATCH");
  const list = spawnSync("tar", ["-tzf", resolve(file)], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const verbose = spawnSync("tar", ["-tvzf", resolve(file)], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (list.status || verbose.status) throw Error("ARTIFACT_INVALID_TAR");
  const paths = list.stdout.trim().split("\n");
  if (
    paths.length > 100000 ||
    paths.some(
      (p) =>
        p.startsWith("/") || p.split("/").includes("..") || /[\r\x00]/.test(p),
    )
  )
    throw Error("ARTIFACT_UNSAFE_PATH");
  // Builder dereferences links; reject all links/special files in foreign archives.
  if (
    verbose.stdout
      .trim()
      .split("\n")
      .some((p) => !/^[-d]/.test(p))
  )
    throw Error("ARTIFACT_UNSAFE_ENTRY");
  if (!paths.some((p) => p.replace(/^\.\//, "") === "artifact.json"))
    throw Error("ARTIFACT_MANIFEST_MISSING");
}
export async function verifyRelease(dir, commit) {
  const m = JSON.parse(await readFile(resolve(dir, "artifact.json"), "utf8"));
  if (
    m.format !== "xianji-omr-standalone-v1" ||
    m.platform !== "linux" ||
    m.arch !== "x64" ||
    m.nodeMajor !== 22 ||
    m.commit !== commit ||
    process.platform !== "linux" ||
    process.arch !== "x64" ||
    Number(process.versions.node.split(".")[0]) !== 22
  )
    throw Error("ARTIFACT_TARGET_OR_COMMIT_MISMATCH");
  for (const [path, sha] of Object.entries(m.files)) {
    if (
      path.startsWith("/") ||
      path.split("/").includes("..") ||
      !/^[a-f0-9]{64}$/.test(sha)
    )
      throw Error("ARTIFACT_MANIFEST_INVALID");
    const h = createHash("sha256");
    for await (const b of createReadStream(resolve(dir, path))) h.update(b);
    if (h.digest("hex") !== sha) throw Error("ARTIFACT_FILE_MISMATCH");
  }
  if (
    !m.files["package-lock.json"] ||
    !m.files["server/src/index.ts"] ||
    !m.files[".next/BUILD_ID"]
  )
    throw Error("ARTIFACT_INCOMPLETE");
  return m;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === new URL(import.meta.url).pathname
) {
  try {
    if (process.argv[2] === "archive")
      await verifyArchive(process.argv[3], process.argv[4]);
    else if (process.argv[2] === "release")
      await verifyRelease(process.argv[3], process.argv[4]);
    else throw Error("ARTIFACT_ARGUMENTS");
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
