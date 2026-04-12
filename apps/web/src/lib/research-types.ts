export type {
  PredictionPoint,
  ResearchDashboardState,
  ResolvedEvaluation,
  ResolvedSeriesPoint,
} from "@poly/trader-core/research/evaluation";

export interface ResearchSetupIssue {
  envKey: string;
  kind: "missing" | "invalid";
  message: string;
}

export interface ResearchSetupState {
  status: "setup_required";
  issues: ResearchSetupIssue[];
  steps: string[];
}

export type ResearchWorkbenchStreamState =
  | {
      mode: "streaming";
      state: import("@poly/trader-core/research/evaluation").ResearchDashboardState;
    }
  | {
      mode: "setup_required";
      state: ResearchSetupState;
    };
