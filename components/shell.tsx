"use client";
import { Form, Input, Button } from "./ui/antd";
import { Menu } from "antd";
import { LayoutTaskTabs } from "./layout/task-tabs";
import { ErrorToast } from "./ui/toast";
import { DeletionJobs } from "./deletion-jobs";
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
  const editor = /^\/(?:key-signatures|time-signatures)\/datasets\/[^/]+\/annotate$/.test(path) || /\/songs\/|\/pages\/|\/records\/[^/]+$/.test(path),
    cli = path.startsWith("/cli/");
  useEffect(() => {
    api<{ username: string }>("/session")
      .then((v) => setAccount(v.username))
      .catch((e) => setError(e.status === 401 ? "请登录" : e.message));
  }, []);
  if (account === null && !cli)
    return (
      <main className="login">
        <Form
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
            <Input name="username" autoComplete="username" required />
          </label>
          <label>
            密码
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <ErrorToast>{error}</ErrorToast>
          <Button className="primary">登录</Button>
        </Form>
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
            <Button onClick={() => go("/cli/grants")}>CLI授权</Button>
            <Button
              onClick={async () => {
                await api("/logout", { method: "POST" });
                setAccount(null);
              }}
            >
              退出
            </Button>
          </header>
          <nav className="platform-nav" aria-label="任务导航">
            <p>工作空间</p>
            <Menu
              mode="inline"
              selectedKeys={[
                path.startsWith("/time-signatures") ? "time-signatures" : path.startsWith("/key-signatures") ? "key-signatures" : path.startsWith("/localization") ? "localization" : "layout",
              ]}
              items={[
                { key: "time-signatures", icon: <Icon name="crop" />, label: "拍号标注" },
                { key: "key-signatures", icon: <Icon name="crop" />, label: "调号标注" },
                {
                  key: "layout",
                  icon: <Icon name="crop" />,
                  label: "切图标注",
                },
                {
                  key: "localization",
                  icon: <Icon name="locate" />,
                  label: "小节与音符事件",
                },
              ]}
              onClick={({ key }) =>
                go(key === "time-signatures" ? "/time-signatures/datasets" : key === "key-signatures" ? "/key-signatures/datasets" : key === "layout" ? "/datasets" : "/localization/datasets")
              }
            />
          </nav>
        </>
      )}
      {account && <DeletionJobs />}
      <main
        className={editor ? "editor-root" : cli ? "cli-main" : "page-content"}
      >
        {!editor && !cli && (path.startsWith("/datasets") || path.startsWith("/layout/")) && <LayoutTaskTabs />}
        {children}
      </main>
    </>
  );
}
