import { spawn } from "node:child_process";
const sampler = new URL("./preview-memory.mjs", import.meta.url).href;
const env = {
  ...process.env,
  NODE_OPTIONS:
    (process.env.NODE_OPTIONS || "") +
    " --max-old-space-size=2048 --import=" +
    sampler,
};
if (process.env.OMR_REBUILD_PREVIEW === "1") {
  const build = spawn(process.execPath, ["server/build.mjs"], {
    stdio: "inherit",
    env,
  });
  const code = await new Promise((resolve) => build.on("exit", resolve));
  if (code) process.exit(Number(code) || 1);
}
await import("./preview.mjs");
