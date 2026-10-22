import { LocalizationEditor } from "../../../../../../components/localization/editor";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string; recordId: string }>;
}) {
  const { id, recordId } = await params;
  return (
    <LocalizationEditor key={recordId} datasetId={id} recordId={recordId} />
  );
}
