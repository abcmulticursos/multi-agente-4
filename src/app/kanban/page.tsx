import ConnectionGate from "@/components/ConnectionGate";

export const dynamic = "force-dynamic";

export default function KanbanPage() {
  return <ConnectionGate initialView="kanban" />;
}
