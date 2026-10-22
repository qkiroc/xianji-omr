import { SongList } from "../../../components/catalogue/songs";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SongList key={id} datasetId={id} />;
}
