"use client";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useEffect, type ReactNode } from "react";
import { setDialog } from "../../shared/dialog";
function Bridge({ children }: { children: ReactNode }) {
  const { modal } = App.useApp();
  useEffect(
    () =>
      setDialog(
        async (content) =>
          new Promise<boolean>((resolve) => {
            modal.confirm({
              title: "请确认操作",
              content,
              okText: "确定",
              cancelText: "取消",
              onOk: () => resolve(true),
              onCancel: () => resolve(false),
            });
          }),
      ),
    [modal],
  );
  return children;
}
export function UiProvider({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider
      button={{ autoInsertSpace: false }}
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: "#2563eb",
          borderRadius: 8,
          fontSize: 14,
          controlHeight: 34,
        },
        components: { Table: { headerBg: "#f8fafc" } },
      }}
    >
      <App notification={{ maxCount: 4, placement: "topRight" }}>
        <Bridge>{children}</Bridge>
      </App>
    </ConfigProvider>
  );
}
