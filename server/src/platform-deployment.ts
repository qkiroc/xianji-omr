import {request} from "node:http";
import express from "express";
import {need, ID} from "./annotation.ts";

export function deploymentRequest(method: string, path: string, value?: unknown, socketPath = "/run/xianji-omr-deploy.sock"): Promise<{status: number; body: any}> {
  return new Promise((resolve, reject) => {
    const req = request({socketPath, path, method,
      headers: {"Content-Type": "application/json"}, timeout: 15000}, response => {
      let size = 0; const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 256 * 1024) { req.destroy(); reject(Error("DEPLOY_RESPONSE_SIZE")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => {
        try { resolve({status: response.statusCode || 503, body: JSON.parse(Buffer.concat(chunks).toString("utf8"))}); }
        catch { reject(Error("DEPLOY_RESPONSE_INVALID")); }
      });
      response.on("error", reject);
    });
    req.on("timeout", () => req.destroy(Error("DEPLOY_AGENT_TIMEOUT")));
    req.on("error", reject);
    req.end(value === undefined ? undefined : JSON.stringify(value));
  });
}
export function registerPlatformDeployment(app: any, {send = deploymentRequest}: {send?: typeof deploymentRequest} = {}) {
  const access = (req: any, res: any, next: any) => {
    need(req.identity?.kind === "bearer" && req.identity.scopes.includes("platform:deploy"), "需要单独授权platform:deploy", 403);
    next();
  };
  const proxy = async (res: any, method: string, path: string, value?: unknown) => {
    try { const result = await send(method, path, value); res.status(result.status).json(result.body); }
    catch { res.status(503).json({error: "部署控制器尚未安装或暂不可用，请先升级平台并启用本地部署控制器"}); }
  };
  app.post("/api/platform/deployments", access, express.json({limit: "4kb"}), async (req: any, res: any) => {
    need(req.body && Object.keys(req.body).length === 1 && ID.test(req.body.requestId), "仅支持requestId；部署固定使用本仓库main");
    await proxy(res, "POST", "/jobs", {requestId: req.body.requestId, grantId: req.identity.id});
  });
  app.get("/api/platform/deployments/latest", access, async (req: any, res: any) => {
    await proxy(res, "GET", "/jobs/latest");
  });
  app.get("/api/platform/deployments/:deploymentId", access, async (req: any, res: any) => {
    need(ID.test(req.params.deploymentId), "部署任务ID无效");
    await proxy(res, "GET", "/jobs/" + req.params.deploymentId);
  });
}
