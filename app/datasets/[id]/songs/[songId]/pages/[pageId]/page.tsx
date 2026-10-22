import { LayoutEditor } from "../../../../../../../components/layout/editor";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; songId: string; pageId: string }>;
}) {
  const { id, songId, pageId } = await params;
  return (
    <LayoutEditor key={pageId} datasetId={id} songId={songId} pageId={pageId} />
  );
}
