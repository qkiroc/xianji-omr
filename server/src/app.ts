import { pageRecord } from "./pages.ts";
import { transaction, datasetRecord, songRecord } from "./datasets.ts";
import { identities, hasAuthorization } from "./identity.ts";
import { registerCliAuth } from "./cli-auth.ts";
import { createPlatform } from "./platform.ts";
import express from "express";
import sharp from "sharp";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { verifyPassword } from "./config.ts";
import { SCHEMA, assertSchema } from "./migrate.ts";
const sha = (s: any) => createHash("sha256").update(s).digest("hex"),
  uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validateBoxes(boxes: any, w: any, h: any) {
  if (!Array.isArray(boxes) || boxes.length > 5000)
    throw Error("INVALID_BOXES");
  const ids = new Set();
  return boxes.map((b: any) => {
    if (
      typeof b.id !== "string" ||
      b.id.length > 100 ||
      ids.has(b.id) ||
      !["x", "y", "width", "height"].every((k: any) =>
        Number.isSafeInteger(b[k]),
      ) ||
      b.x < 0 ||
      b.y < 0 ||
      b.width < 1 ||
      b.height < 1 ||
      b.x + b.width > w ||
      b.y + b.height > h
    )
      throw Error("INVALID_BOXES");
    ids.add(b.id);
    return { id: b.id, x: b.x, y: b.y, width: b.width, height: b.height };
  });
}
const meta = (r: any) => ({
  id: r.id,
  name: r.original_name,
  mime: r.mime,
  width: r.width,
  height: r.height,
  checksum: r.checksum,
  version: r.version,
  updatedAt: r.updated_at,
});
export function createApp({
  config,
  pool,
  storage,
  staticDir,
  release = "development",
  webHandler,
}: any) {
  const app = express();
  app.disable("x-powered-by");
  let attempts = new Map(),
    uploadBusy = false;
  const credential = sha(config.passwordHash);
  app.use((req: any, res: any, next: any) => {
    // Next's prerender cache headers must not cache authenticated HTML across releases.
    const immutableAsset = req.path.startsWith("/_next/static/");
    const setHeader = res.setHeader;
    res.setHeader = function (this: any, name: string, value: unknown) {
      return setHeader.call(
        this,
        name,
        !immutableAsset && name.toLowerCase() === "cache-control"
          ? "no-store"
          : value,
      );
    };
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' blob: data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; object-src 'none'; frame-ancestors 'none'",
    });
    if (
      req.path.startsWith("/api/") &&
      !["GET", "HEAD"].includes(req.method) &&
      ((req.headers.origin && req.headers.origin !== config.origin) ||
        (!req.headers.origin &&
          !req.headers.authorization &&
          !["/api/cli-auth/requests", "/api/cli-auth/token"].includes(
            req.path,
          )))
    )
      return res
        .status(403)
        .json({ error: "来源校验失败，请通过配置的网页地址访问" });
    next();
  });
  app.get("/health", async (req: any, res: any) => {
    try {
      await assertSchema(pool);
      res.json({ ok: true, release, schema: SCHEMA });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  app.post(
    "/api/login",
    (req: any, res: any, next: any) =>
      hasAuthorization(req)
        ? res.status(401).json({ error: "网站登录不能使用Bearer" })
        : next(),
    express.json({ limit: "4kb" }),
    async (req: any, res: any) => {
      const ip = req.socket.remoteAddress,
        now = Date.now();
      if (attempts.size > 10000) attempts.clear();
      let a = attempts.get(ip);
      if (!a || a.until < now) {
        a = { n: 0, until: now + 60000 };
        attempts.set(ip, a);
      }
      if (++a.n > 10)
        return res.status(429).json({ error: "登录尝试过多，请稍后再试" });
      if (
        req.body?.username !== config.username ||
        !verifyPassword(req.body?.password, config.passwordHash)
      )
        return res.status(401).json({ error: "用户名或密码错误" });
      const token = randomBytes(32).toString("hex");
      await pool.query("DELETE FROM omr_sessions WHERE expires_at < now()");
      await pool.query(
        "INSERT INTO omr_sessions VALUES($1,$2,now()+interval '7 days')",
        [sha(token), credential],
      );
      res.cookie("omr_session", token, {
        httpOnly: true,
        secure: config.secureCookie,
        sameSite: "strict",
        maxAge: 604800000,
        path: "/",
      });
      res.json({ username: config.username });
    },
  );
  const identity = identities({ pool, config });
  registerCliAuth(app, { pool, config, identity });
  app.use("/api", identity.business);
  app.get("/api/session", (req: any, res: any) =>
    res.json({ username: config.username }),
  );
  app.post("/api/logout", async (req: any, res: any) => {
    await pool.query("DELETE FROM omr_sessions WHERE token_hash=$1", [
      sha(req.token),
    ]);
    res.clearCookie("omr_session", { path: "/" });
    res.json({ ok: true });
  });
  const platform = createPlatform({ pool, storage, config });
  app.use("/api", async (req: any, res: any, next: any) => {
    if (req.path.startsWith("/v2/deletions")) return next();
    if (
      req.method === "POST" &&
      (/\/delete$/.test(req.path) ||
        (/\/restore$/.test(req.path) && !req.path.includes("/events/")))
    )
      return res.status(410).json({
        error:
          "删除已改为不可恢复，请使用deletions预览并明确确认；恢复接口已停用",
      });
    const exists = (
      await pool.query("SELECT to_regclass('public.omr_deletion_jobs') t")
    ).rows[0].t;
    if (
      exists &&
      (
        await pool.query(
          "SELECT 1 FROM omr_deletion_jobs WHERE status IN ('pending','failed') LIMIT 1",
        )
      ).rowCount
    )
      return res.status(503).json({
        error: "永久清理未完成，请在删除任务中重试；当前暂停数据操作",
      });
    next();
  });
  app.use("/api/v2", platform);
  app.locals.platform = platform;
  app.get("/api/images", async (req: any, res: any) => {
    const r = await pool.query(
      "SELECT id,original_name,mime,width,height,checksum,version,updated_at FROM omr_images WHERE deleted_at IS NULL AND song_id IN (SELECT s.id FROM omr_songs s JOIN omr_datasets d ON d.id=s.dataset_id WHERE d.deleted_at IS NULL AND s.deleted_at IS NULL) ORDER BY updated_at DESC,id DESC LIMIT 500",
    );
    res.json(r.rows.map(meta));
  });
  app.post(
    "/api/images",
    (req: any, res: any, next: any) => {
      if (uploadBusy)
        return res.status(429).json({ error: "已有图片正在上传，请稍后重试" });
      uploadBusy = true;
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          uploadBusy = false;
        }
      };
      res.once("finish", release);
      res.once("close", release);
      next();
    },
    express.raw({ type: () => true, limit: "20mb" }),
    async (req: any, res: any) => {
      let key: string = "";
      try {
        const data = req.body,
          mime = (req.headers["content-type"] || "").split(";")[0];
        if (
          !Buffer.isBuffer(data) ||
          !data.length ||
          !["image/png", "image/jpeg", "image/webp"].includes(mime)
        )
          return res
            .status(400)
            .json({ error: "仅支持 PNG/JPG/WebP，最大20MB" });
        const info = await sharp(data, {
          limitInputPixels: 50000000,
          animated: false,
        }).metadata();
        if (
          !(
            (
              {
                png: "image/png",
                jpeg: "image/jpeg",
                webp: "image/webp",
              } as Record<string, string>
            )[info.format] === mime
          ) ||
          !info.width ||
          !info.height ||
          info.width > 20000 ||
          info.height > 20000 ||
          info.width * info.height > 50000000 ||
          (info.pages || 1) > 1
        )
          throw Error("INVALID_IMAGE");
        await sharp(data, { limitInputPixels: 50000000 }).stats();
        let name;
        try {
          name = decodeURIComponent(req.headers["x-file-name"] || "image");
        } catch {
          throw Error("INVALID_NAME");
        }
        if (name.length > 255 || /[\x00-\x1f]/.test(name))
          throw Error("INVALID_NAME");
        const id = randomUUID();
        key = config.oss.prefix + id;
        try {
          const r = await transaction(pool, async (c: any) => {
            // A new legacy upload may create a fresh empty compatibility container; never restore old rows.
            await c.query(
              "INSERT INTO omr_datasets(id,name,description) VALUES('00000000-0000-4000-8000-000000000001','历史未归类','新的兼容上传容器') ON CONFLICT(id) DO NOTHING",
            );
            await c.query(
              "INSERT INTO omr_songs(id,dataset_id,name,song_group_key,split) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','待整理曲目','legacy-unassigned','train') ON CONFLICT(id) DO NOTHING",
            );
            await datasetRecord(c, "00000000-0000-4000-8000-000000000001", {
              lock: true,
            });
            await songRecord(c, "00000000-0000-4000-8000-000000000002");
            await storage.put(key, data, mime);
            return c.query(
              "INSERT INTO omr_images(id,object_key,original_name,mime,width,height,checksum) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
              [id, key, name, mime, info.width, info.height, sha(data)],
            );
          });
          res.status(201).json({ image: meta(r.rows[0]), boxes: [] });
        } catch (error: any) {
          if (error.status) throw error;
          try {
            await storage.delete(key);
          } catch {
            console.error("OSS_ORPHAN_CLEANUP_FAILED " + id);
          }
          res.status(503).json({ error: "数据库写入失败，未保存；请重试" });
        }
      } catch (e: any) {
        if (e.status) throw e;
        if (
          e.message?.startsWith("INVALID") ||
          /Input|image|pixel/i.test(e.message || "")
        )
          res
            .status(400)
            .json({ error: "图片无效或超过像素限制（5000万像素/边长20000）" });
        else res.status(503).json({ error: "对象存储不可用，未保存；请重试" });
      }
    },
  );
  app.param("id", (req: any, res: any, next: any, id: any) =>
    uuid.test(id) ? next() : res.status(400).json({ error: "图片标识无效" }),
  );
  app.get("/api/images/:id", async (req: any, res: any) => {
    await pageRecord(pool, req.params.id);
    const r = await pool.query("SELECT * FROM omr_images WHERE id=$1", [
      req.params.id,
    ]);
    if (!r.rowCount) return res.status(404).json({ error: "图片不存在" });
    res.json({ image: meta(r.rows[0]), boxes: r.rows[0].boxes });
  });
  app.get("/api/images/:id/content", async (req: any, res: any) => {
    await pageRecord(pool, req.params.id);
    const r = await pool.query(
      "SELECT object_key,mime,checksum FROM omr_images WHERE id=$1",
      [req.params.id],
    );
    if (!r.rowCount) return res.sendStatus(404);
    try {
      const data = await storage.get(r.rows[0].object_key);
      res
        .type(r.rows[0].mime)
        .set({
          "X-Checksum-Sha256": r.rows[0].checksum,
          "Content-Length": String(data.length),
        })
        .send(data);
    } catch {
      res.status(503).json({ error: "原图读取失败" });
    }
  });
  app.put(
    "/api/images/:id",
    express.json({ limit: "2mb" }),
    async (req: any, res: any) =>
      res.json(
        await transaction(pool, async (c: any) => {
          const p = await pageRecord(c, req.params.id, true);
          if (p.annotation_format !== "legacy") {
            const e: Error & { status?: number } = new Error(
              "旧客户端不能修改新版类别标注",
            );
            e.status = 409;
            throw e;
          }
          let boxes;
          try {
            boxes = validateBoxes(req.body.boxes, p.width, p.height);
            if (!Number.isInteger(req.body.version) || req.body.version < 1)
              throw Error();
          } catch {
            const e: Error & { status?: number } = new Error("坐标或版本无效");
            e.status = 400;
            throw e;
          }
          if (
            !p.boxes.every((b: any) => boxes.some((x: any) => x.id === b.id))
          ) {
            const e: any = new Error(
              "删除已保存区域请使用永久删除预览与确认接口",
            );
            e.status = 409;
            throw e;
          }
          const result = await c.query(
            "UPDATE omr_images SET boxes=$1,version=version+1,updated_at=now() WHERE id=$2 AND version=$3 AND annotation_format='legacy' RETURNING *",
            [JSON.stringify(boxes), req.params.id, req.body.version],
          );
          if (!result.rowCount) {
            const e: Error & { status?: number } = new Error(
              "版本冲突，请保留草稿",
            );
            e.status = 409;
            throw e;
          }
          return { image: meta(result.rows[0]), boxes: result.rows[0].boxes };
        }),
      ),
  );
  app.get("/__release.json", (req: any, res: any) => res.json({ release }));
  app.use("/api", (req: any, res: any) =>
    res.status(404).json({ error: "API不存在" }),
  );
  if (webHandler) {
    app.get("/cli/authorize", (req: any, res: any, next: any) => {
      res.set("Referrer-Policy", "same-origin");
      next();
    });
    app.use((req: any, res: any, next: any) => {
      Promise.resolve(webHandler(req, res)).catch(next);
    });
  } else {
    app.get("/cli/authorize", (req: any, res: any) =>
      res
        .set("Referrer-Policy", "same-origin")
        .sendFile("cli-authorize.html", { root: staticDir }),
    );
    app.get("/cli/grants", (req: any, res: any) =>
      res.sendFile("cli-grants.html", { root: staticDir }),
    );
    app.use(express.static(staticDir, { etag: false }));
  }
  app.use((err: any, req: any, res: any, next: any) => {
    if (!res.headersSent)
      res.status(err.status || 503).json({
        error:
          err.status === 413
            ? "文件过大"
            : err.status && !err.type
              ? err.message
              : "服务暂不可用，未保存；请保留草稿",
        ...(err.details ? { details: err.details } : {}),
      });
  });
  return app;
}
