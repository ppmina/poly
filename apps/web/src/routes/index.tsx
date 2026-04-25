import { createFileRoute } from "@tanstack/react-router";

import { ResearchWorkbench } from "@/components/research-workbench";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="page-shell">
      <ResearchWorkbench />
    </main>
  );
}
