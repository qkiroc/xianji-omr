import { readFile, lstat } from "node:fs/promises";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import pg from "pg";
export const hashPassword = (p: any) => {
  const s = randomBytes(16).toString("hex");
  return s + ":" + scryptSync(p, s, 64).toString("hex");
};
export function verifyPassword(p: any, h: any) {
  if (
    typeof p !== "string" ||
    p.length > 256 ||
    !/^\w{32}:[a-f0-9]{128}$/.test(h)
  )
    return false;
  const [s, d] = h.split(":");
  return timingSafeEqual(scryptSync(p, s, 64), Buffer.from(d, "hex"));
}
export function validateConfig(c: any) {
  if (
    !c ||
    c.database?.database !== "xianji_omr" ||
    c.database?.user !== "xianji_omr" ||
    !c.database.host ||
    !c.database.password
  )
    throw Error("CONFIG_DEDICATED_DATABASE_REQUIRED");
  if (
    !Number.isInteger(c.database.port) ||
    c.database.port < 1 ||
    c.database.port > 65535 ||
    !["verify-full", "disable"].includes(c.database.sslMode)
  )
    throw Error("CONFIG_DATABASE");
  if (
    !Number.isInteger(c.port) ||
    c.port < 1024 ||
    c.port > 65535 ||
    c.port === 8787 ||
    !["127.0.0.1", "0.0.0.0"].includes(c.host)
  )
    throw Error("CONFIG_PORT");
  if (
    !c.username ||
    !/^\w{32}:[a-f0-9]{128}$/.test(c.passwordHash) ||
    typeof c.secureCookie !== "boolean" ||
    c.secureCookie !== c.origin?.startsWith("https://") ||
    new URL(c.origin).origin !== c.origin ||
    !/^https?:/.test(c.origin)
  )
    throw Error("CONFIG_AUTH");
  const o = c.oss;
  if (
    !o ||
    !/^[a-z0-9][a-z0-9-]{2,62}$/.test(o.bucket) ||
    !/^oss-[a-z0-9-]+$/.test(o.region) ||
    !/^https:\/\/[a-z0-9.-]+\.aliyuncs\.com$/.test(o.endpoint) ||
    !/^omr(?:\/[a-zA-Z0-9_-]+)*\/$/.test(o.prefix) ||
    !["ram", "sts", "ak"].includes(o.authMode)
  )
    throw Error("CONFIG_OSS");
  if (
    (o.authMode !== "ram" && (!o.accessKeyId || !o.accessKeySecret)) ||
    (o.authMode === "sts" && !o.securityToken)
  )
    throw Error("CONFIG_OSS_CREDENTIALS");
  return c;
}
export async function loadConfig(
  path: any = process.env.OMR_CONFIG || "/etc/xianji-omr/config.json",
) {
  const s = await lstat(path);
  if (
    !s.isFile() ||
    s.mode & 0o027 ||
    (process.env.NODE_ENV === "production" && s.uid !== 0)
  )
    throw Error("CONFIG_PERMISSIONS");
  return validateConfig(JSON.parse(await readFile(path, "utf8")));
}
export async function poolFor(c: any) {
  const d = c.database;
  const pool = new pg.Pool({
    host: d.host,
    port: d.port,
    database: d.database,
    user: d.user,
    password: d.password,
    ssl:
      d.sslMode === "disable"
        ? false
        : {
            rejectUnauthorized: true,
            ...(d.caFile ? { ca: await readFile(d.caFile, "utf8") } : {}),
          },
    max: 3,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 10000,
    statement_timeout: 15000,
    application_name: "xianji-omr",
  });
  pool.on("error", () => console.error("DATABASE_CONNECTION_ERROR"));
  return pool;
}
