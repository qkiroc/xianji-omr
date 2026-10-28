"use client";
import { Tabs } from "antd";
import { usePathname } from "next/navigation";
import { useNavigation } from "../navigation";
export function LayoutTaskTabs() {
  const path = usePathname(), { go } = useNavigation();
  const active = path.startsWith("/layout/training") ? "training" : path.startsWith("/layout/models") ? "models" : "datasets";
  return <Tabs className="layout-task-tabs" activeKey={active} items={[
    {key:"datasets",label:"数据标注"}, {key:"training",label:"模型训练"}, {key:"models",label:"图片推理"},
  ]} onChange={(key) => go(key === "datasets" ? "/datasets" : "/layout/" + key)} />;
}