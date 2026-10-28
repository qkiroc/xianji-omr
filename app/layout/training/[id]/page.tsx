import { TrainingDetail } from "../../../../components/training/dashboard";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; return <TrainingDetail id={id} />;
}