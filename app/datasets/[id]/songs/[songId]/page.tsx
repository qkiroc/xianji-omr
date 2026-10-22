import { LayoutEditor } from "../../../../../components/layout/editor";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; songId: string }>;
}) {
  const { id, songId } = await params;
  return <LayoutEditor key={songId} datasetId={id} songId={songId} />;
}
