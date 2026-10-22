import { LocalizationRecords } from "../../../../components/localization/records";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <LocalizationRecords key={id} datasetId={id} />;
}
