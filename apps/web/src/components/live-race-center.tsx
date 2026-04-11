"use client";

import {
  buildLivelineSeries,
  chartMetrics,
  formatMetricValue,
  formatSessionClock,
  getMetricMeta,
  type ChartMetric,
  type DriverSnapshot,
  type SeriesDefinition,
  type SessionSnapshot,
} from "@poly/motorsport-core";
import { Liveline } from "liveline";
import { startTransition, useDeferredValue, useEffect, useState } from "react";

const windowOptions = [
  { label: "30s", secs: 30 },
  { label: "90s", secs: 90 },
  { label: "5m", secs: 300 },
];

type ConnectionState = "connecting" | "live" | "reconnecting" | "error";

interface LiveRaceCenterProps {
  catalog: readonly SeriesDefinition[];
}

function formatAxisTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDriverMetric(driver: DriverSnapshot, metric: ChartMetric): string {
  if (metric === "position_history") {
    return `P${driver.position}`;
  }

  if (driver.position === 1 && metric === "gap_to_leader") {
    return "Leader";
  }

  if (driver.position === 1 && metric === "interval_ahead") {
    return "Track clear";
  }

  const value = metric === "gap_to_leader" ? driver.gapToLeader : driver.intervalAhead;
  return `+${value.toFixed(2)}s`;
}

function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case "live":
      return "Live stream";
    case "reconnecting":
      return "Reconnecting";
    case "error":
      return "Feed interrupted";
    default:
      return "Connecting";
  }
}

function feedModeLabel(snapshot: SessionSnapshot | null, state: ConnectionState): string {
  if (snapshot?.status === "demo") {
    return "Demo replay";
  }

  if (state === "live" || state === "reconnecting") {
    return "Provider stream";
  }

  if (state === "error") {
    return "Awaiting stream";
  }

  return "Connecting";
}

export function LiveRaceCenter({ catalog }: LiveRaceCenterProps) {
  const [selectedSeriesId, setSelectedSeriesId] = useState(catalog[0]?.id ?? "f1");
  const selectedSeries = catalog.find((series) => series.id === selectedSeriesId) ?? catalog[0];
  const fallbackSessionId = selectedSeries?.sessions[0]?.id ?? "race";
  const [selectedSessionId, setSelectedSessionId] = useState(fallbackSessionId);
  const [metric, setMetric] = useState<ChartMetric>("gap_to_leader");
  const [windowSecs, setWindowSecs] = useState(90);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [selectedDriverIds, setSelectedDriverIds] = useState<string[]>([]);

  useEffect(() => {
    if (!selectedSeries) {
      return;
    }

    const hasSession = selectedSeries.sessions.some((session) => session.id === selectedSessionId);
    if (!hasSession) {
      setSelectedSessionId(fallbackSessionId);
      setSelectedDriverIds([]);
    }
  }, [fallbackSessionId, selectedSeries, selectedSessionId]);

  useEffect(() => {
    setConnectionState("connecting");
    setSnapshot(null);

    const source = new EventSource(`/api/live/${selectedSeriesId}/${selectedSessionId}`);
    const onSnapshot = (event: Event) => {
      const message = event as MessageEvent<string>;
      const nextSnapshot = JSON.parse(message.data) as SessionSnapshot;

      startTransition(() => {
        setSnapshot(nextSnapshot);
        setSelectedDriverIds((current) => {
          const availableIds = new Set(nextSnapshot.drivers.map((driver) => driver.driverId));
          const persisted = current.filter((driverId) => availableIds.has(driverId));
          if (persisted.length > 0) {
            return persisted;
          }

          return nextSnapshot.drivers
            .slice(0, Math.min(4, nextSnapshot.drivers.length))
            .map((driver) => driver.driverId);
        });
      });
      setConnectionState("live");
    };

    source.addEventListener("snapshot", onSnapshot);
    source.onerror = () => {
      setConnectionState((current) => (current === "live" ? "reconnecting" : "error"));
    };

    return () => {
      source.removeEventListener("snapshot", onSnapshot);
      source.close();
    };
  }, [selectedSeriesId, selectedSessionId]);

  const deferredSnapshot = useDeferredValue(snapshot);
  const activeSnapshot = deferredSnapshot ?? snapshot;
  const selectedSession =
    selectedSeries?.sessions.find((session) => session.id === selectedSessionId) ??
    selectedSeries?.sessions[0];
  const driverCount = activeSnapshot?.drivers.length ?? selectedSeries?.drivers.length ?? 0;
  const metricMeta = getMetricMeta(metric);
  const visibleDrivers = activeSnapshot?.drivers ?? [];
  const livelineSeries = activeSnapshot
    ? buildLivelineSeries(activeSnapshot, metric, selectedDriverIds).map((series) => {
        const cutoff = Math.floor(Date.now() / 1000) - windowSecs;
        const data = series.data.filter((point) => point.time >= cutoff);

        return {
          ...series,
          data,
          value: data.at(-1)?.value ?? series.value,
        };
      })
    : [];
  const referenceLine = metric === "position_history" ? null : { value: 0, label: "Leader" };
  const trackLabel = activeSnapshot?.track ?? selectedSession?.track ?? "Track";
  const locationLabel = activeSnapshot?.location ?? selectedSession?.location ?? "Location";
  const sessionLabel = activeSnapshot?.sessionLabel ?? selectedSession?.label ?? "Session";
  const lapSummary = activeSnapshot
    ? `Lap ${activeSnapshot.lap ?? "--"}/${activeSnapshot.totalLaps ?? "--"}`
    : "Awaiting live lap data";
  const leader = activeSnapshot?.drivers[0];

  return (
    <section className="race-app">
      <section className="app-header" aria-label="Race overview">
        <div className="app-header-top">
          <div className="app-brand">
            <p className="eyebrow">Poly Race Line</p>
            <h1>
              {sessionLabel} at {trackLabel}
            </h1>
            <p className="hero-text">
              {selectedSeries?.hero ??
                "Live motorsport traces across series, tuned for multi-driver comparisons."}
            </p>
          </div>

          <aside className="app-meta panel" aria-label="Session status">
            <div className="status-row">
              <div className={`status-pill status-${connectionState}`}>
                <span className="status-dot" />
                {connectionLabel(connectionState)}
              </div>

              <span className="meta-inline">{driverCount} drivers</span>
            </div>

            <dl className="app-summary">
              <div>
                <dt>Series</dt>
                <dd>{selectedSeries?.name ?? "Series"}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{locationLabel}</dd>
              </div>
              <div>
                <dt>Feed</dt>
                <dd>{feedModeLabel(activeSnapshot, connectionState)}</dd>
              </div>
              <div>
                <dt>Clock</dt>
                <dd>
                  {activeSnapshot ? formatSessionClock(activeSnapshot.sessionClockSec) : "--:--"}
                </dd>
              </div>
              <div>
                <dt>Lap</dt>
                <dd>{lapSummary}</dd>
              </div>
              <div>
                <dt>Leader</dt>
                <dd>{leader?.shortLabel ?? "--"}</dd>
              </div>
            </dl>
          </aside>
        </div>

        <div className="app-controls">
          <section className="series-strip" aria-label="Series selection">
            {catalog.map((series) => (
              <button
                key={series.id}
                aria-label={series.name}
                aria-pressed={series.id === selectedSeriesId}
                className={series.id === selectedSeriesId ? "series-card is-active" : "series-card"}
                onClick={() => {
                  setSelectedSeriesId(series.id);
                  setSelectedDriverIds([]);
                }}
                type="button"
              >
                <span className="series-name">{series.shortName}</span>
                <span className="series-full">{series.name}</span>
              </button>
            ))}
          </section>

          <div className="session-strip session-strip-header" aria-label="Session selection">
            {selectedSeries?.sessions.map((session) => (
              <button
                key={session.id}
                aria-pressed={session.id === selectedSessionId}
                className={
                  session.id === selectedSessionId ? "session-pill is-active" : "session-pill"
                }
                onClick={() => {
                  setSelectedSessionId(session.id);
                  setSelectedDriverIds([]);
                }}
                type="button"
              >
                {session.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="chart-panel panel">
          <div className="chart-toolbar">
            <div className="panel-heading">
              <p className="eyebrow">Primary workspace</p>
              <h2>Live trace</h2>
              <p className="subtle-copy">
                {selectedSeries?.name ?? "Series"} · {sessionLabel} · {trackLabel} · {lapSummary}
              </p>
            </div>
          </div>

          <div className="metric-strip" aria-label="Metric selection">
            {chartMetrics.map((nextMetric) => (
              <button
                key={nextMetric}
                aria-pressed={nextMetric === metric}
                className={nextMetric === metric ? "metric-pill is-active" : "metric-pill"}
                onClick={() => setMetric(nextMetric)}
                type="button"
              >
                {getMetricMeta(nextMetric).label}
              </button>
            ))}
          </div>

          <div className="chart-copy">
            <p>{metricMeta.subtitle}</p>
            <span className="subtle-copy">
              Toggle drivers in the side rail to compare only the traces you need.
            </span>
          </div>

          <div className="chart-stage">
            <Liveline
              badge={false}
              color={selectedSeries?.accentColor ?? "#ff6a3d"}
              cursor="crosshair"
              data={[]}
              emptyText="Waiting for the session stream"
              formatTime={formatAxisTime}
              formatValue={(value) => formatMetricValue(metric, value, driverCount)}
              grid
              loading={!activeSnapshot}
              paused={connectionState === "error"}
              pulse
              scrub
              series={livelineSeries}
              style={{ height: "calc(100% - 34px)" }}
              theme="light"
              value={livelineSeries[0]?.value ?? 0}
              window={windowSecs}
              windowStyle="rounded"
              windows={windowOptions}
              padding={{ bottom: 40 }}
              onWindowChange={(nextWindow) => setWindowSecs(nextWindow)}
              {...(referenceLine ? { referenceLine } : {})}
            />
          </div>
        </div>

        <aside className="side-panel panel">
          <div className="panel-section panel-section-stack">
            <p className="eyebrow">Driver focus</p>
            <h3>Overlay selection</h3>
            <p className="subtle-copy">
              Toggle drivers to add or remove traces from the live chart without changing the field
              table below.
            </p>
          </div>

          <div className="side-facts">
            <div className="side-fact">
              <span className="meta-label">Selected</span>
              <strong>{selectedDriverIds.length}</strong>
            </div>
            <div className="side-fact">
              <span className="meta-label">Leader</span>
              <strong>{leader?.shortLabel ?? "--"}</strong>
            </div>
          </div>

          {visibleDrivers.length > 0 ? (
            <div className="driver-selector">
              {visibleDrivers.map((driver) => {
                const selected = selectedDriverIds.includes(driver.driverId);

                return (
                  <button
                    key={driver.driverId}
                    aria-pressed={selected}
                    className={selected ? "driver-toggle is-active" : "driver-toggle"}
                    onClick={() => {
                      startTransition(() => {
                        setSelectedDriverIds((current) => {
                          if (current.includes(driver.driverId)) {
                            return current.filter((driverId) => driverId !== driver.driverId);
                          }

                          return [...current, driver.driverId];
                        });
                      });
                    }}
                    type="button"
                  >
                    <span className="driver-swatch" style={{ backgroundColor: driver.color }} />
                    <span className="driver-meta">
                      <strong>{driver.shortLabel}</strong>
                      <small>{driver.label}</small>
                    </span>
                    <span className="driver-stat">{formatDriverMetric(driver, metric)}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <p>Waiting for the session feed.</p>
            </div>
          )}
        </aside>
      </section>

      <section className="field-section panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Field snapshot</p>
            <h3>Driver intervals</h3>
          </div>
          <p className="subtle-copy">
            Current positions, gaps, and interval deltas from the selected session.
          </p>
        </div>

        {visibleDrivers.length > 0 ? (
          <div className="comparison-table-wrap">
            <table className="comparison-table">
              <thead>
                <tr>
                  <th scope="col">Pos</th>
                  <th scope="col">Driver</th>
                  <th scope="col">On chart</th>
                  <th scope="col">{metricMeta.label}</th>
                  <th scope="col">Gap</th>
                  <th scope="col">Interval</th>
                </tr>
              </thead>
              <tbody>
                {visibleDrivers.map((driver) => {
                  const selected = selectedDriverIds.includes(driver.driverId);

                  return (
                    <tr key={driver.driverId} className={selected ? "is-selected" : undefined}>
                      <td>
                        <span className="position-badge position-badge-compact">
                          P{driver.position}
                        </span>
                      </td>
                      <td>
                        <div className="comparison-driver">
                          <span
                            className="driver-swatch"
                            style={{ backgroundColor: driver.color }}
                          />
                          <div className="driver-ident">
                            <strong>{driver.shortLabel}</strong>
                            <span>{driver.label}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span
                          className={
                            selected
                              ? "comparison-state comparison-state-selected"
                              : "comparison-state"
                          }
                        >
                          {selected ? "On chart" : "Available"}
                        </span>
                      </td>
                      <td>{formatDriverMetric(driver, metric)}</td>
                      <td>
                        {driver.position === 1 ? "Leader" : `+${driver.gapToLeader.toFixed(2)}s`}
                      </td>
                      <td>
                        {driver.position === 1
                          ? "Track clear"
                          : `+${driver.intervalAhead.toFixed(2)}s`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state empty-state-wide">
            <p>Field rows appear once the live session feed starts.</p>
          </div>
        )}
      </section>
    </section>
  );
}
