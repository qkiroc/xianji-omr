"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, json, ApiError } from "../shared/client";
interface RequestInfo {
  client_name: string;
  device_description: string;
  scopes: string[];
  expires_at: string;
  tokenDays: number;
}
interface Grant {
  id: string;
  client_name: string;
  device_description: string;
  scopes: string[];
  expires_at: string;
  revoked_at: string | null;
}
export function CliAuthorize() {
  const query = useSearchParams(),
    id = query.get("request") || "",
    [info, setInfo] = useState<RequestInfo | null>(null),
    [login, setLogin] = useState(false),
    [error, setError] = useState(""),
    [insecure, setInsecure] = useState(false);
  useEffect(() => setInsecure(location.protocol === "http:"), []);
  const load = () => {
    if (!/^[a-f0-9]{64}$/.test(id)) {
      setError("授权请求标识无效");
      return;
    }
    api<RequestInfo>("/cli-auth/requests/" + id)
      .then((v) => {
        setInfo(v);
        setLogin(false);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setLogin(true);
        else setError(e.message);
      });
  };
  useEffect(load, [id]);
  return (
    <section className="panel" style={{ maxWidth: 560, margin: "40px auto" }}>
      <h1>授权独立 CLI</h1>
      <p className="error">
        {insecure
          ? "当前平台使用HTTP：登录和凭证为明文传输，PKCE不替代HTTPS。"
          : ""}
      </p>
      {login && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget,
              f = new FormData(form);
            try {
              await api(
                "/login",
                json({
                  username: f.get("username"),
                  password: f.get("password"),
                }),
              );
              form.reset();
              load();
            } catch (e) {
              setError(e instanceof Error ? e.message : "登录失败");
            }
          }}
        >
          <label>
            用户名
            <input name="username" autoComplete="username" required />
          </label>
          <label>
            密码
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button>登录</button>
        </form>
      )}
      {info && (
        <>
          <dl>
            <dt>客户端</dt>
            <dd>{info.client_name}</dd>
            <dt>设备说明</dt>
            <dd>{info.device_description}</dd>
            <dt>请求权限</dt>
            <dd>{info.scopes.join("、")}</dd>
            <dt>请求到期</dt>
            <dd>{new Date(info.expires_at).toLocaleString()}</dd>
          </dl>
          <p>
            只有明确点击授权后CLI才能获得专用可撤销凭证，有效期{info.tokenDays}
            天。CLI不读取浏览器Cookie。
          </p>
          <form
            method="POST"
            action={"/api/cli-auth/requests/" + id + "/decision"}
          >
            <div className="actions">
              <button name="decision" value="deny">
                拒绝
              </button>
              <button name="decision" value="approve" className="primary">
                授权
              </button>
            </div>
          </form>
        </>
      )}
      <p className="error">{error}</p>
    </section>
  );
}
export function CliGrants() {
  const [items, setItems] = useState<Grant[]>([]),
    [error, setError] = useState("");
  const load = () =>
    api<Grant[]>("/cli-auth/grants")
      .then(setItems)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="panel" style={{ maxWidth: 800, margin: "40px auto" }}>
      <a href="/datasets">‹ 返回数据集</a>
      <h1>CLI授权设备</h1>
      <p className="error">{error}</p>
      {items.map((g) => (
        <article className="panel" key={g.id}>
          <b>{g.client_name}</b>
          <p>
            {g.device_description} · {g.scopes.join("、")}
          </p>
          <p>到期：{new Date(g.expires_at).toLocaleString()}</p>
          <button
            disabled={!!g.revoked_at}
            onClick={async () => {
              try {
                await api("/cli-auth/grants/" + g.id + "/revoke", json({}));
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : "撤销失败");
              }
            }}
          >
            {g.revoked_at ? "已撤销" : "撤销授权"}
          </button>
        </article>
      ))}
    </section>
  );
}
