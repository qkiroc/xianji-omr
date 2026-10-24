import { createRequire } from "node:module";
import ts from "typescript";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const compiled = new Map();
const output = new URL("../.test-data/ui-compiled/", import.meta.url);
await mkdir(output, { recursive: true });
export async function compile(file) {
  if (compiled.has(file)) return compiled.get(file);
  const target = new URL(
    createHash("sha256").update(file).digest("hex") + ".mjs",
    output,
  );
  compiled.set(file, target.href);
  let code = ts.transpileModule(await readFile(file, "utf8"), {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const matches = [...code.matchAll(/from\s+["']([^"']+)["']/g)];
  for (const m of matches) {
    let dest;
    if (m[1].startsWith(".")) {
      let base = resolve(dirname(file), m[1]);
      for (const ext of [".ts", ".tsx", ".mjs", ".js"]) {
        try {
          await readFile(base + ext);
          dest = await compile(base + ext);
          break;
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }
      if (!dest) throw Error("Missing module " + base);
    } else dest = pathToFileURL(require.resolve(m[1])).href;
    code = code.replace(m[0], m[0].replace(m[1], dest));
  }
  await writeFile(target, code);
  return target.href;
}
