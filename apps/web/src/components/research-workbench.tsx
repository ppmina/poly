"use client";

import { Liveline } from "liveline";
import { startTransition, useEffect, useState } from "react";

import type {
  ResearchDashboardState,
  ResearchSetupState,
  ResearchWorkbenchStreamState,
  ResolvedSeriesPoint,
} from "@/lib/research-types";

type SurfaceTone = "default" | "positive" | "warning";

interface MetricBlockProps {
  eyebrow: string;
  headline: string;
  body: string;
  tone?: SurfaceTone;
}

interface ResearchWorkbenchViewProps {
  streamState: ResearchWorkbenchStreamState | null;
}

interface StatusPillProps {
  label: string;
  tone: "live" | "warning" | "error" | "quiet";
}

interface ValuePanelProps {
  caption: string;
  title: string;
  value: string;
  detail: string;
  tone?: SurfaceTone;
}

const SETTINGS = [
  { label: "Sampling", value: "30s cadence" },
  { label: "Truth", value: "midpoint at +5m" },
  { label: "Accuracy", value: "within +/-0.02" },
];

const CHART_WINDOW_SECS = 60 * 60;

export function ResearchWorkbench() {
  const [streamState, setStreamState] = useState<ResearchWorkbenchStreamState | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/live");
    const onSnapshot = (event: Event) => {
      const message = event as MessageEvent<string>;
      const nextState = JSON.parse(message.data) as ResearchWorkbenchStreamState;

      startTransition(() => {
        setStreamState(nextState);
      });
    };

    source.addEventListener("snapshot", onSnapshot);
    source.onerror = () => {
      startTransition(() => {
        setStreamState((current: ResearchWorkbenchStreamState | null) => {
          if (!current || current.mode === "setup_required") {
            return current;
          }

          return {
            mode: "streaming",
            state: {
              ...current.state,
              connectionState:
                current.state.connectionState === "live" ? "reconnecting" : "error",
            },
          };
        });
      });
    };

    return () => {
      source.removeEventListener("snapshot", onSnapshot);
      source.close();
    };
  }, []);

  return <ResearchWorkbenchView streamState={streamState} />;
}

export function ResearchWorkbenchView({ streamState }: ResearchWorkbenchViewProps) {
  const activeState = streamState?.mode === "streaming" ? streamState.state : null;
  const setupState = streamState?.mode === "setup_required" ? streamState.state : null;
  const chartSeries = buildChartSeries(activeState?.resolvedSeries ?? []);
  const chartEmptyText = getChartEmptyText(streamState);
  const latestPrediction = activeState?.latestPrediction;
  const latestResolved = activeState?.latestResolved;
  const diffTone = getDiffTone(latestResolved?.diff ?? null, latestResolved?.accurate ?? null);
  const connectionTone = setupState
    ? "warning"
    : getConnectionTone(activeState?.connectionState ?? "connecting");
  const signalTone = setupState
    ? "warning"
    : activeState?.signalState.status === "ready"
      ? "quiet"
      : "warning";

  return (
    <section className="research-shell" aria-label="Prediction research workbench">
      <section className="research-header">
        <div className="research-copy">
          <p className="eyebrow">Poly Research Workbench</p>
          <h1>Prediction value against realized truth.</h1>
          <p className="intro-copy">
            Live model output is sampled every 30 seconds, compared with the first valid midpoint
            five minutes later, and scored inside a fixed tolerance band so researchers can tune
            prediction quality instead of mirroring a trading venue.
          </p>
        </div>

        <aside className="ledger-panel panel" aria-label="Live research status">
          <div className="ledger-topline">
            <StatusPill
              label={setupState ? "Setup required" : connectionLabel(activeState?.connectionState)}
              tone={connectionTone}
            />
            <StatusPill
              label={setupState ? "Missing market config" : modelStatusLabel(activeState)}
              tone={signalTone}
            />
          </div>

          <dl className="ledger-grid">
            <div>
              <dt>Market</dt>
              <dd>
                {setupState ? "Set POLYMARKET_MARKET_ID" : shortId(activeState?.market.marketId)}
              </dd>
            </div>
            <div>
              <dt>Token</dt>
              <dd>{setupState ? "Set POLYMARKET_TOKEN_ID" : shortId(activeState?.market.tokenId)}</dd>
            </div>
            <div>
              <dt>Current midpoint</dt>
              <dd>{setupState ? "--" : formatProbability(activeState?.market.currentMidpoint)}</dd>
            </div>
            <div>
              <dt>Pending truths</dt>
              <dd>{setupState ? "0" : formatInteger(activeState?.pendingCount)}</dd>
            </div>
            <div>
              <dt>Signal confidence</dt>
              <dd>{setupState ? "--" : formatPercent(activeState?.signalState.confidence)}</dd>
            </div>
            <div>
              <dt>Signal adjustment</dt>
              <dd>{setupState ? "--" : formatBps(activeState?.signalState.fairValueAdjBps)}</dd>
            </div>
          </dl>

          <p className="ledger-note">
            {setupState
              ? "The research hub is waiting for required market env before it can open the live Polymarket stream."
              : activeState?.signalState.message ??
                "Fresh signal files are eligible for scoring. Missing or stale signals are skipped."}
          </p>
        </aside>
      </section>

      <section className="overview-grid" aria-label="Research summary">
        <article className="prediction-panel panel stage-panel">
          <div className="panel-headline">
            <p className="eyebrow">Current prediction</p>
            <h2>Latest sampled model value</h2>
          </div>

          <div className="prediction-body">
            <div className="prediction-value-wrap">
              <p className="hero-value">
                {setupState ? "Setup" : formatProbability(latestPrediction?.predictionValue)}
              </p>
              <p className="hero-detail">
                {setupState
                  ? "Add the required market env below before the first sampled prediction can be created."
                  : latestPrediction
                    ? `Predicted ${formatTimestamp(latestPrediction.predictedAt)}`
                    : "Awaiting the first valid sampled prediction."}
              </p>
            </div>

            <div className="metric-list">
              <MetricBlock
                eyebrow="Base fair value"
                headline={setupState ? "Needs live feed" : formatProbability(latestPrediction?.baseFairValue)}
                body="Depth-aware fair value before any model adjustment is applied."
                tone={setupState ? "warning" : "default"}
              />
              <MetricBlock
                eyebrow="Sample midpoint"
                headline={
                  setupState
                    ? "Needs live feed"
                    : formatProbability(latestPrediction?.midpointAtPrediction)
                }
                body="Observed midpoint at the time the prediction candidate was captured."
                tone={setupState ? "warning" : "default"}
              />
              <MetricBlock
                eyebrow="Model confidence"
                headline={setupState ? "Needs setup" : formatPercent(latestPrediction?.confidence)}
                body="Confidence is shown for context only and does not change the scored value."
                tone={setupState ? "warning" : "default"}
              />
            </div>
          </div>
        </article>

        <div className="summary-column">
          <ValuePanel
            caption="Latest realized truth"
            title="Resolved midpoint"
            value={formatProbability(latestResolved?.truthValue)}
            detail={
              setupState
                ? "Truth values begin only after live market setup is valid and the first horizon closes."
                : latestResolved
                  ? `Resolved ${formatTimestamp(latestResolved.truthAt)}`
                  : "Truth values appear once the first five-minute horizon closes."
            }
          />
          <ValuePanel
            caption="Prediction gap"
            title="Diff = prediction - truth"
            value={formatDelta(latestResolved?.diff)}
            detail={
              setupState
                ? "Diff remains unavailable until the app can sample live predictions."
                : latestResolved
                  ? latestResolved.accurate
                    ? "Inside the fixed +/-0.02 accuracy band."
                    : "Outside the fixed +/-0.02 accuracy band."
                  : "Diff is calculated only after a truth value resolves."
            }
            tone={setupState ? "default" : diffTone}
          />
          <ValuePanel
            caption="Rolling score"
            title="Accuracy over recent resolved rows"
            value={formatPercent(activeState?.rollingAccuracy)}
            detail={
              setupState
                ? "Rolling accuracy starts after setup is complete and resolved evaluations begin arriving."
                : activeState?.recentEvaluations.length
                  ? `${activeState.recentEvaluations.length} recent resolved evaluations shown below.`
                  : "No resolved rows yet, so rolling accuracy has not started."
            }
            tone={setupState ? "default" : getAccuracyTone(activeState?.rollingAccuracy)}
          />
        </div>
      </section>

      <section className="workspace-grid">
        <article className="chart-panel panel" aria-label="Prediction versus truth chart">
          <div className="chart-header">
            <div className="panel-headline">
              <p className="eyebrow">Primary workspace</p>
              <h2>
                {setupState
                  ? "Finish setup to unlock live evaluation"
                  : "Prediction versus truth over the last hour"}
              </h2>
            </div>

            <div className="settings-strip" aria-label="Fixed evaluation settings">
              {SETTINGS.map((setting) => (
                <div key={setting.label} className="setting-chip">
                  <span>{setting.label}</span>
                  <strong>{setting.value}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="chart-copy">
            <p>
              {setupState
                ? "The page is ready, but the live hub is paused until the required market env becomes valid."
                : "Both traces are plotted on the original prediction timestamp so researchers can read forecast and realized truth on the same time axis without shifting mental context."}
            </p>
            {!setupState ? (
              <div className="chart-legend" aria-label="Series legend">
                <span className="legend-item">
                  <i className="legend-swatch legend-swatch-prediction" />
                  Prediction value
                </span>
                <span className="legend-item">
                  <i className="legend-swatch legend-swatch-truth" />
                  Realized truth
                </span>
              </div>
            ) : null}
          </div>

          {setupState ? (
            <SetupIssuePanel state={setupState} />
          ) : (
            <div className="chart-stage">
              <Liveline
                badge={false}
                color="#1c1c1c"
                cursor="crosshair"
                data={[]}
                emptyText={chartEmptyText}
                formatTime={formatChartTime}
                formatValue={formatProbability}
                grid
                loading={!activeState}
                paused={activeState?.connectionState === "error"}
                pulse
                scrub
                series={chartSeries}
                style={{ height: "100%" }}
                theme="light"
                value={chartSeries[0]?.value ?? chartSeries[1]?.value ?? 0}
                window={CHART_WINDOW_SECS}
                windowStyle="rounded"
                padding={{ bottom: 42 }}
              />
            </div>
          )}
        </article>

        <aside className="inspector-panel panel" aria-label="Evaluation notes">
          <div className="panel-headline">
            <p className="eyebrow">Inspection rail</p>
            <h2>
              {setupState ? "What the app is waiting for" : "What the stream is doing right now"}
            </h2>
          </div>

          <div className="inspector-stack">
            <MetricBlock
              eyebrow="Feed freshness"
              headline={
                setupState
                  ? "Setup required"
                  : activeState?.market.lastSnapshotAt !== null &&
                      activeState?.market.lastSnapshotAt !== undefined
                    ? formatTimestamp(activeState.market.lastSnapshotAt)
                    : "Awaiting feed"
              }
              body={
                setupState
                  ? "No live Polymarket snapshot can arrive until the required market env is configured."
                  : "This is the most recent market snapshot timestamp received by the server-side hub."
              }
              tone={setupState ? "warning" : "default"}
            />
            <MetricBlock
              eyebrow="Scorable queue"
              headline={setupState ? "0" : formatInteger(activeState?.pendingCount)}
              body={
                setupState
                  ? "The queue stays empty until the app can sample live predictions."
                  : "Pending predictions are held until the first midpoint arrives at or after the full five-minute horizon."
              }
            />
            <MetricBlock
              eyebrow="Midpoint availability"
              headline={
                setupState
                  ? "Needs market env"
                  : activeState?.market.currentMidpoint === null
                    ? "No valid midpoint"
                    : formatProbability(activeState?.market.currentMidpoint)
              }
              body={
                setupState
                  ? "Midpoints are unavailable because the market stream has not been configured yet."
                  : "Predictions are skipped whenever the market snapshot cannot provide a valid midpoint."
              }
              tone={
                setupState || activeState?.market.currentMidpoint === null ? "warning" : "default"
              }
            />
            <MetricBlock
              eyebrow="Signal rule"
              headline={
                setupState
                  ? "Setup before scoring"
                  : activeState?.signalState.status === "ready"
                    ? "Fresh signal accepted"
                    : "Fresh signal required"
              }
              body={
                setupState
                  ? "Signal freshness still matters, but the model cannot be evaluated until the live market config is present."
                  : "Missing, stale, malformed, or cross-market signals are treated as model unavailable for scoring."
              }
              tone={
                setupState
                  ? "warning"
                  : activeState?.signalState.status === "ready"
                    ? "positive"
                    : "warning"
              }
            />
          </div>
        </aside>
      </section>

      <section className="history-panel panel" aria-label="Recent resolved evaluations">
        <div className="history-header">
          <div className="panel-headline">
            <p className="eyebrow">Recent evaluations</p>
            <h2>{setupState ? "Setup checklist" : "Latest 25 resolved rows"}</h2>
          </div>
          <p className="history-copy">
            {setupState
              ? "The evaluation table will populate after the required env is set and the first five-minute horizon resolves."
              : "The table stays focused on resolved comparisons so each row answers one question: how close was the prediction to the realized midpoint at the fixed horizon?"}
          </p>
        </div>

        {setupState ? (
          <SetupChecklist state={setupState} />
        ) : activeState?.recentEvaluations.length ? (
          <div className="history-table-wrap">
            <table className="history-table">
              <thead>
                <tr>
                  <th scope="col">Sample</th>
                  <th scope="col">Truth at</th>
                  <th scope="col">Prediction</th>
                  <th scope="col">Truth</th>
                  <th scope="col">Diff</th>
                  <th scope="col">Accuracy</th>
                  <th scope="col">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {activeState.recentEvaluations.map((evaluation) => (
                  <tr key={`${evaluation.predictedAt}-${evaluation.truthAt}`}>
                    <td>{formatTimestamp(evaluation.predictedAt)}</td>
                    <td>{formatTimestamp(evaluation.truthAt)}</td>
                    <td>{formatProbability(evaluation.predictionValue)}</td>
                    <td>{formatProbability(evaluation.truthValue)}</td>
                    <td className={evaluation.accurate ? "tone-positive" : "tone-warning"}>
                      {formatDelta(evaluation.diff)}
                    </td>
                    <td>
                      <span
                        className={
                          evaluation.accurate
                            ? "accuracy-pill accuracy-positive"
                            : "accuracy-pill accuracy-warning"
                        }
                      >
                        {evaluation.accurate ? "Accurate" : "Outside band"}
                      </span>
                    </td>
                    <td>{formatPercent(evaluation.confidence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state empty-state-wide">
            <p>{chartEmptyText}</p>
          </div>
        )}
      </section>
    </section>
  );
}

function MetricBlock({ eyebrow, headline, body, tone = "default" }: MetricBlockProps) {
  return (
    <article className={`metric-block metric-${tone}`}>
      <p className="metric-eyebrow">{eyebrow}</p>
      <strong>{headline}</strong>
      <p>{body}</p>
    </article>
  );
}

function SetupChecklist({ state }: { state: ResearchSetupState }) {
  return (
    <div className="setup-steps-panel">
      <ol className="setup-steps">
        {state.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

function SetupIssuePanel({ state }: { state: ResearchSetupState }) {
  return (
    <div className="setup-board">
      <div className="setup-column">
        <p className="metric-eyebrow">Detected env issues</p>
        <ul className="setup-issue-list">
          {state.issues.map((issue) => (
            <li key={issue.envKey} className={`setup-issue setup-issue-${issue.kind}`}>
              <div className="setup-issue-head">
                <strong>{issue.envKey}</strong>
                <span>{issue.kind === "missing" ? "Missing" : "Invalid"}</span>
              </div>
              <p>{issue.message}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="setup-column">
        <p className="metric-eyebrow">What to do next</p>
        <ol className="setup-steps compact-steps">
          {state.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function StatusPill({ label, tone }: StatusPillProps) {
  return (
    <span className={`status-pill status-${tone}`}>
      <i className="status-dot" />
      {label}
    </span>
  );
}

function ValuePanel({ caption, title, value, detail, tone = "default" }: ValuePanelProps) {
  return (
    <article className={`value-panel panel value-${tone}`}>
      <p className="metric-eyebrow">{caption}</p>
      <h3>{title}</h3>
      <p className="value-number">{value}</p>
      <p className="value-detail">{detail}</p>
    </article>
  );
}

function buildChartSeries(points: readonly ResolvedSeriesPoint[]) {
  const predictionData: { time: number; value: number }[] = [];
  const truthData: { time: number; value: number }[] = [];

  for (const point of points) {
    const time = Math.floor(point.time / 1000);
    predictionData.push({ time, value: point.predictionValue });
    truthData.push({ time, value: point.truthValue });
  }

  return [
    {
      id: "prediction",
      label: "Prediction value",
      color: "#1c1c1c",
      data: predictionData,
      value: predictionData.at(-1)?.value ?? 0,
    },
    {
      id: "truth",
      label: "Realized truth",
      color: "#b56a33",
      data: truthData,
      value: truthData.at(-1)?.value ?? 0,
    },
  ];
}

function connectionLabel(state: ResearchDashboardState["connectionState"] | undefined): string {
  switch (state) {
    case "live":
      return "Live feed";
    case "reconnecting":
      return "Reconnecting";
    case "error":
      return "Feed interrupted";
    default:
      return "Connecting";
  }
}

function getConnectionTone(state: ResearchDashboardState["connectionState"]) {
  switch (state) {
    case "live":
      return "live";
    case "error":
      return "error";
    case "reconnecting":
      return "warning";
    default:
      return "quiet";
  }
}

function getDiffTone(diff: number | null, accurate: boolean | null): SurfaceTone {
  if (diff === null) {
    return "default";
  }

  if (accurate) {
    return "positive";
  }

  return "warning";
}

function getAccuracyTone(rollingAccuracy: number | null | undefined): SurfaceTone {
  if (rollingAccuracy !== null && rollingAccuracy !== undefined && rollingAccuracy >= 0.6) {
    return "positive";
  }

  return "default";
}

function getChartEmptyText(streamState: ResearchWorkbenchStreamState | null): string {
  if (!streamState) {
    return "Connecting to the live market feed.";
  }

  if (streamState.mode === "setup_required") {
    return "Complete the required market env to start the live research stream.";
  }

  const state = streamState.state;
  if (state.connectionState === "connecting") {
    return "Connecting to the live market feed.";
  }

  if (state.connectionState === "error") {
    return "The live feed is currently unavailable.";
  }

  if (state.signalState.status !== "ready") {
    return state.signalState.message ?? "Waiting for a fresh signal file.";
  }

  if (state.market.currentMidpoint === null) {
    return "The market feed is live, but there is no valid midpoint to score yet.";
  }

  if (state.recentEvaluations.length === 0) {
    return "Predictions are streaming. Truth values appear after the first full five-minute horizon.";
  }

  return "No resolved evaluations are visible in the current window.";
}

function modelStatusLabel(state: ResearchDashboardState | null): string {
  return state?.signalState.status === "ready" ? "Model ready" : "Model unavailable";
}

function formatBps(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "--";
  }

  const prefix = value > 0 ? "+" : "";
  return `${prefix}${Math.round(value)} bps`;
}

function formatChartTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDelta(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "--";
  }

  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(3)}`;
}

function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "--";
  }

  return value.toString();
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "--";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function formatProbability(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "--";
  }

  return value.toFixed(3);
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function shortId(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }

  if (value.length <= 14) {
    return value;
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
