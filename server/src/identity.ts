import { createHash } from "node:crypto";
export const hash = (s: any) => createHash("sha256").update(s).digest("hex");
export const hasAuthorization = (req: any) =>
  !!req.headers.authorization ||
  !!req.rawHeaders?.some(
    (h: any, i: any) => i % 2 === 0 && h.toLowerCase() === "authorization",
  );
export const ALL_SCOPES = ["data:read", "data:write", "data:confirm"];
export function identities({ pool, config }: any) {
  const cookie = async (req: any, res: any, next: any) => {
    try {
      if (hasAuthorization(req))
        return res.status(401).json({ error: "仅允许网页登录身份" });
      const token = /(?:^|;\s*)omr_session=([a-f0-9]{64})(?:;|$)/.exec(
        req.headers.cookie || "",
      )?.[1];
      if (
        !token ||
        !(
          await pool.query(
            "SELECT 1 FROM omr_sessions WHERE token_hash=$1 AND credential_hash=$2 AND expires_at>now()",
            [hash(token), hash(config.passwordHash)],
          )
        ).rowCount
      )
        return res.status(401).json({ error: "请先登录" });
      req.token = token;
      req.identity = { kind: "cookie", scopes: ALL_SCOPES };
      next();
    } catch {
      res.status(503).json({ error: "身份服务暂不可用" });
    }
  };
  const bearer = async (req: any, res: any, next: any) => {
    try {
      const match = /^Bearer (omr_cli_[a-f0-9]{64})$/.exec(
        req.headers.authorization || "",
      );
      if (
        (req.rawHeaders?.filter(
          (h: any, i: any) =>
            i % 2 === 0 && h.toLowerCase() === "authorization",
        ).length || 0) > 1 ||
        !match ||
        /(?:^|;\s*)omr_session=/.test(req.headers.cookie || "")
      )
        return res.status(401).json({ error: "CLI凭证无效或身份混合" });
      const r = (
        await pool.query(
          "SELECT id,client_name,device_description,scopes,expires_at,last_used_at FROM omr_cli_grants WHERE token_hash=$1 AND credential_hash=$2 AND user_identity=$3 AND revoked_at IS NULL AND expires_at>now()",
          [hash(match[1]), hash(config.passwordHash), config.username],
        )
      ).rows[0];
      if (!r) return res.status(401).json({ error: "CLI凭证失效，请重新授权" });
      req.identity = { kind: "bearer", ...r };
      await pool.query(
        "UPDATE omr_cli_grants SET last_used_at=now() WHERE id=$1 AND (last_used_at IS NULL OR last_used_at<now()-interval '5 minutes')",
        [r.id],
      );
      next();
    } catch {
      res.status(503).json({ error: "身份服务暂不可用" });
    }
  };
  const business = (req: any, res: any, next: any) => {
    const check = () => {
      if (req.path.endsWith("/review")) {
        if (
          !req.identity.scopes.some((s: any) =>
            ["data:write", "data:confirm"].includes(s),
          )
        )
          return res.status(403).json({ error: "CLI权限不足" });
        return next();
      }
      const scope =
        req.method === "GET" || req.method === "HEAD"
          ? "data:read"
          : req.path.endsWith("/confirm")
            ? "data:confirm"
            : "data:write";
      if (!req.identity.scopes.includes(scope))
        return res.status(403).json({ error: "CLI权限不足" });
      next();
    };
    if (hasAuthorization(req)) {
      if (["/session", "/logout"].includes(req.path))
        return res.status(401).json({ error: "网站接口不能使用CLI凭证" });
      return bearer(req, res, check);
    }
    return cookie(req, res, check);
  };
  return { cookie, bearer, business };
}
