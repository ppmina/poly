import { config as loadDotEnv } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

import type { ExecutionMode, RiskLimits } from "./types.js";

const booleanSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  BOT_NAME: z.string().default("poly-paper-mm"),
  EXECUTION_MODE: z.enum(["paper", "live"]).default("paper"),
  POLYMARKET_HOST: z.string().url().default("https://clob.polymarket.com"),
  POLYMARKET_CHAIN_ID: z.coerce
    .number()
    .int()
    .refine((value) => value === 137 || value === 80002),
  POLYMARKET_MARKET_ID: z.string().min(1),
  POLYMARKET_TOKEN_ID: z.string().min(1),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2_500),
  REPLAY_INPUT_PATH: z.string().optional().default(""),
  REPLAY_SPEED_MULTIPLIER: z.coerce.number().positive().default(10),
  BASE_SPREAD_BPS: z.coerce.number().positive().default(120),
  QUOTE_SIZE: z.coerce.number().positive().default(10),
  MIN_QUOTE_SIZE: z.coerce.number().positive().default(1),
  MAX_POSITION: z.coerce.number().positive().default(50),
  MAX_NOTIONAL: z.coerce.number().positive().default(25),
  MAX_DRAWDOWN: z.coerce.number().positive().default(5),
  STALE_DATA_MS: z.coerce.number().int().positive().default(15_000),
  INVENTORY_SKEW_BPS: z.coerce.number().nonnegative().default(80),
  PAPER_INITIAL_CASH: z.coerce.number().positive().default(1_000),
  PAPER_FILL_SLIPPAGE_BPS: z.coerce.number().nonnegative().default(2),
  SIGNAL_FILE_PATH: z.string().default("artifacts/signals/current.json"),
  SIGNAL_MAX_AGE_MS: z.coerce.number().int().positive().default(30_000),
  ARTIFACTS_DIR: z.string().default("artifacts"),
  KILL_SWITCH_FILE: z.string().default("artifacts/kill-switch.json"),
  ALLOW_LIVE_EXECUTION: booleanSchema.default(false),
  POLYMARKET_PRIVATE_KEY: z.string().optional(),
  POLYMARKET_FUNDER_ADDRESS: z.string().optional(),
  POLYMARKET_API_KEY: z.string().optional(),
  POLYMARKET_API_SECRET: z.string().optional(),
  POLYMARKET_API_PASSPHRASE: z.string().optional(),
  POLYMARKET_SIGNATURE_TYPE: z.coerce.number().int().min(0).max(1).default(1),
});

export interface PolymarketCredentials {
  privateKey: string | undefined;
  funderAddress: string | undefined;
  apiKey: string | undefined;
  apiSecret: string | undefined;
  apiPassphrase: string | undefined;
  signatureType: 0 | 1;
}

export interface AppConfig {
  botName: string;
  executionMode: ExecutionMode;
  allowLiveExecution: boolean;
  polymarketHost: string;
  polymarketChainId: 137 | 80002;
  marketId: string;
  tokenId: string;
  pollIntervalMs: number;
  replayInputPath: string | undefined;
  replaySpeedMultiplier: number;
  baseSpreadBps: number;
  quoteSize: number;
  minQuoteSize: number;
  inventorySkewBps: number;
  paperInitialCash: number;
  paperFillSlippageBps: number;
  signalFilePath: string;
  signalMaxAgeMs: number;
  artifactsDir: string;
  killSwitchFile: string;
  riskLimits: RiskLimits;
  credentials: PolymarketCredentials;
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  loadDotEnv();
  const parsed = envSchema.parse(env);

  if (parsed.EXECUTION_MODE === "live" && !parsed.ALLOW_LIVE_EXECUTION) {
    throw new Error("EXECUTION_MODE=live requires ALLOW_LIVE_EXECUTION=true");
  }

  return {
    botName: parsed.BOT_NAME,
    executionMode: parsed.EXECUTION_MODE,
    allowLiveExecution: parsed.ALLOW_LIVE_EXECUTION,
    polymarketHost: parsed.POLYMARKET_HOST,
    polymarketChainId: parsed.POLYMARKET_CHAIN_ID as 137 | 80002,
    marketId: parsed.POLYMARKET_MARKET_ID,
    tokenId: parsed.POLYMARKET_TOKEN_ID,
    pollIntervalMs: parsed.POLL_INTERVAL_MS,
    replayInputPath: parsed.REPLAY_INPUT_PATH.trim()
      ? resolve(parsed.REPLAY_INPUT_PATH)
      : undefined,
    replaySpeedMultiplier: parsed.REPLAY_SPEED_MULTIPLIER,
    baseSpreadBps: parsed.BASE_SPREAD_BPS,
    quoteSize: parsed.QUOTE_SIZE,
    minQuoteSize: parsed.MIN_QUOTE_SIZE,
    inventorySkewBps: parsed.INVENTORY_SKEW_BPS,
    paperInitialCash: parsed.PAPER_INITIAL_CASH,
    paperFillSlippageBps: parsed.PAPER_FILL_SLIPPAGE_BPS,
    signalFilePath: resolve(parsed.SIGNAL_FILE_PATH),
    signalMaxAgeMs: parsed.SIGNAL_MAX_AGE_MS,
    artifactsDir: resolve(parsed.ARTIFACTS_DIR),
    killSwitchFile: resolve(parsed.KILL_SWITCH_FILE),
    riskLimits: {
      maxPosition: parsed.MAX_POSITION,
      maxNotional: parsed.MAX_NOTIONAL,
      maxDrawdown: parsed.MAX_DRAWDOWN,
      staleDataMs: parsed.STALE_DATA_MS,
    },
    credentials: {
      privateKey: parsed.POLYMARKET_PRIVATE_KEY,
      funderAddress: parsed.POLYMARKET_FUNDER_ADDRESS,
      apiKey: parsed.POLYMARKET_API_KEY,
      apiSecret: parsed.POLYMARKET_API_SECRET,
      apiPassphrase: parsed.POLYMARKET_API_PASSPHRASE,
      signatureType: parsed.POLYMARKET_SIGNATURE_TYPE as 0 | 1,
    },
  };
}
