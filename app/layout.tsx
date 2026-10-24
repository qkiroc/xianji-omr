import type { Metadata } from "next";
import { Suspense } from "react";
import { NavigationProvider } from "../components/navigation";
import { ToastHost } from "../components/ui/toast";
import { Shell } from "../components/shell";
import "./globals.css";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { UiProvider } from "../components/ui/provider";
export const metadata: Metadata = {
  title: "弦记 OMR · 数据标注",
  description: "原图切图与小节事件几何定位",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: "window.__omrLegacyHash=window.location.hash;",
          }}
        />
      </head>
      <body>
        <AntdRegistry>
          <UiProvider>
            <ToastHost />
            <Suspense fallback={<p>正在加载…</p>}>
              <NavigationProvider>
                <Shell>{children}</Shell>
              </NavigationProvider>
            </Suspense>
          </UiProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
