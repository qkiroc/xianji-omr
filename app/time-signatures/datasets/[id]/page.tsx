import { KeyRecordList } from "../../../../components/key-signatures/records";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
 const { id } = await params; return <KeyRecordList key={id} datasetId={id} task="time-signatures" />;
}