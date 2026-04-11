import { getSeriesCatalog } from "@poly/motorsport-core";

import { LiveRaceCenter } from "@/components/live-race-center";

export default function Home() {
  return (
    <main className="page-shell">
      <LiveRaceCenter catalog={getSeriesCatalog()} />
    </main>
  );
}

