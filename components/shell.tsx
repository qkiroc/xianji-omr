"use client";
import { Icon } from "./ui/icon";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { api, json, ApiError } from "../shared/client";
import { useNavigation } from "./navigation";
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname(),
    { go } = useNavigation();
  const [account, setAccount] = useState<string | null>(null),
    [error, setError] = useState("");
  const editor = /\/songs\/|\/pages\/|\/records\/[^/]+$/.test(path),
    cli = path.startsWith("/cli/");
  useEffect(() => {
    api<{ username: string }>("/session")
      .then((v) => setAccount(v.username))
      .catch((e) => setError(e.status === 401 ? "请登录" : e.message));
  }, []);
  if (account === null && !cli)
    return (
      <main className="login">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              const value = await api<{ username: string }>(
                "/login",
                json({
                  username: f.get("username"),
                  password: f.get("password"),
                }),
              );
              setAccount(value.username);
              setError("");
            } catch (e) {
              setError(e instanceof Error ? e.message : "登录失败");
            }
          }}
        >
          <h1>弦记 OMR</h1>
          <p>数据标注工作台</p>
          <label>
            用户名
            <input name="username" autoComplete="username" required />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <p className="error">{error}</p>
          <button className="primary">登录</button>
        </form>
      </main>
    );
  return (
    <>
      {!editor && !cli && (
        <>
          <header className="platform-header">
            <div className="brand">
              <span className="brand-mark">
                <Icon name="layers" />
              </span>
              <b>
                弦记 <em>OMR</em>
              </b>
            </div>
            <span className="workspace-label">数据标注工作台</span>
            <div className="spacer" />
            <span className="account">
              <span className="avatar">
                {account?.slice(0, 1).toUpperCase()}
              </span>
              {account}
            </span>
            <button onClick={() => go("/cli/grants")}>CLI授权</button>
            <button
              onClick={async () => {
                await api("/logout", { method: "POST" });
                setAccount(null);
              }}
            >
              退出
            </button>
          </header>
          <nav className="platform-nav">
            <p>工作空间</p>
            <button
              aria-current={
                !path.startsWith("/localization") ? "page" : undefined
              }
              className={!path.startsWith("/localization") ? "active" : ""}
              onClick={() => go("/datasets")}
            >
              <Icon name="crop" />
              <span>切图标注</span>
            </button>
            <button
              aria-current={
                path.startsWith("/localization") ? "page" : undefined
              }
              className={path.startsWith("/localization") ? "active" : ""}
              onClick={() => go("/localization/datasets")}
            >
              <Icon name="locate" />
              <span>小节与事件定位</span>
            </button>
          </nav>
        </>
      )}
      <main
        className={editor ? "editor-root" : cli ? "cli-main" : "page-content"}
      >
        {children}
      </main>
    </>
  );
}
