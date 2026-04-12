import { loadAppConfig, type AppConfig } from "@poly/trader-core/config";

import type { ResearchSetupIssue, ResearchSetupState } from "./research-types";

type ResearchBootstrapResult =
  | { mode: "configured"; config: AppConfig }
  | { mode: "setup_required"; state: ResearchSetupState };

const REQUIRED_MARKET_ENV_KEYS = [
  "POLYMARKET_CHAIN_ID",
  "POLYMARKET_MARKET_ID",
  "POLYMARKET_TOKEN_ID",
] as const;

const SETUP_STEPS = [
  "Copy `.env.example` to `.env` if this workspace does not have one yet.",
  "Set `POLYMARKET_CHAIN_ID` to `137` or `80002`.",
  "Set `POLYMARKET_MARKET_ID` and `POLYMARKET_TOKEN_ID` to the market you want to score.",
  "Restart `pnpm dev:web` after saving the env file.",
];

export function loadResearchBootstrap(env: NodeJS.ProcessEnv = process.env): ResearchBootstrapResult {
  try {
    return {
      mode: "configured",
      config: loadAppConfig(env),
    };
  } catch (error) {
    if (isZodErrorLike(error)) {
      return {
        mode: "setup_required",
        state: buildResearchSetupState(error, env),
      };
    }

    throw error;
  }
}

export function buildResearchSetupState(
  error: { issues: Array<{ path: Array<string | number> }> },
  env: NodeJS.ProcessEnv = process.env,
): ResearchSetupState {
  const issues = new Map<string, ResearchSetupIssue>();

  for (const issue of error.issues) {
    const envKey = issue.path[0];
    if (typeof envKey !== "string" || !(REQUIRED_MARKET_ENV_KEYS as readonly string[]).includes(envKey)) {
      continue;
    }

    const kind = classifyIssue(envKey, env);
    issues.set(envKey, {
      envKey,
      kind,
      message: formatIssueMessage(envKey, kind),
    });
  }

  for (const envKey of REQUIRED_MARKET_ENV_KEYS) {
    if (!issues.has(envKey) && isMissingValue(env[envKey])) {
      issues.set(envKey, {
        envKey,
        kind: "missing",
        message: formatIssueMessage(envKey, "missing"),
      });
    }
  }

  return {
    status: "setup_required",
    issues: [...issues.values()],
    steps: [...SETUP_STEPS],
  };
}

function classifyIssue(envKey: string, env: NodeJS.ProcessEnv): ResearchSetupIssue["kind"] {
  return isMissingValue(env[envKey]) ? "missing" : "invalid";
}

function formatIssueMessage(envKey: string, kind: ResearchSetupIssue["kind"]): string {
  switch (envKey) {
    case "POLYMARKET_CHAIN_ID":
      return kind === "missing"
        ? "Add `POLYMARKET_CHAIN_ID` to `.env` with `137` or `80002`."
        : "Set `POLYMARKET_CHAIN_ID` to `137` or `80002`.";
    case "POLYMARKET_MARKET_ID":
      return kind === "missing"
        ? "Add `POLYMARKET_MARKET_ID` to `.env` for the market you want to score."
        : "Set `POLYMARKET_MARKET_ID` to a non-empty target market id.";
    case "POLYMARKET_TOKEN_ID":
      return kind === "missing"
        ? "Add `POLYMARKET_TOKEN_ID` to `.env` for the token you want to score."
        : "Set `POLYMARKET_TOKEN_ID` to a non-empty target token id.";
    default:
      return "Update the market configuration in `.env`.";
  }
}

function isMissingValue(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function isZodErrorLike(
  error: unknown,
): error is { issues: Array<{ path: Array<string | number> }> } {
  return (
    typeof error === "object" &&
    error !== null &&
    "issues" in error &&
    Array.isArray(error.issues)
  );
}
