import { KeyEditor } from "../../../../../components/key-signatures/editor";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
 const { id } = await params; return <KeyEditor key={id} datasetId={id} task="time-signatures" />;
}