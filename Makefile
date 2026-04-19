.DEFAULT_GOAL := help
SHELL := /bin/sh

MODEL_OUT_DIR ?= artifacts/models/latest
OUTPUT ?= artifacts/signals/current.json
CHECKPOINT ?= $(MODEL_OUT_DIR)/best-checkpoint.npz

.PHONY: help install install-train js-install py-sync py-sync-train check test py-test build paper replay signal dataset train-signal signal-nn summary clean guard-%

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z0-9_-]+:.*## / {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install TypeScript and Python dependencies
	pnpm install
	uv sync

install-train: ## Install TypeScript deps and the accelerated Python training extras
	pnpm install
	uv sync --extra train

js-install: ## Install TypeScript dependencies with pnpm
	pnpm install

py-sync: ## Sync the Python environment with uv
	uv sync

py-sync-train: ## Sync the Python environment with the accelerated training extras
	uv sync --extra train

check: ## Run TypeScript checks and Python syntax validation
	pnpm check
	uv run python -m compileall -q tools/research

test: ## Run the TypeScript test suite
	pnpm test
	uv run python -m unittest discover -s tools/research/tests

py-test: ## Run Python research tests
	uv run python -m unittest discover -s tools/research/tests

build: ## Build the TypeScript project
	pnpm build

paper: ## Run the paper trading bot
	pnpm paper

replay: guard-REPLAY_INPUT_PATH ## Replay a captured market session
	REPLAY_INPUT_PATH="$(REPLAY_INPUT_PATH)" pnpm replay

signal: guard-INPUT ## Generate a baseline signal from JSONL snapshots
	@set -e; \
	if [ -n "$(MARKET)" ]; then \
		uv run python tools/research/generate_signal.py --input "$(INPUT)" --market "$(MARKET)" --output "$(OUTPUT)"; \
	else \
		uv run python tools/research/generate_signal.py --input "$(INPUT)" --output "$(OUTPUT)"; \
	fi

dataset: guard-INPUT guard-MODEL_OUT_DIR ## Build supervised train/validation examples from JSONL snapshots
	@set -e; \
	if [ -n "$(MARKET)" ]; then \
		uv run python tools/research/build_dataset.py --input "$(INPUT)" --market "$(MARKET)" --out-dir "$(MODEL_OUT_DIR)"; \
	else \
		uv run python tools/research/build_dataset.py --input "$(INPUT)" --out-dir "$(MODEL_OUT_DIR)"; \
	fi

train-signal: guard-INPUT ## Train the neural signal model on offline JSONL snapshots
	@set -e; \
	if [ -n "$(MARKET)" ]; then \
		uv run python tools/research/train_signal_model.py --input "$(INPUT)" --market "$(MARKET)" --out-dir "$(MODEL_OUT_DIR)"; \
	else \
		uv run python tools/research/train_signal_model.py --input "$(INPUT)" --out-dir "$(MODEL_OUT_DIR)"; \
	fi

signal-nn: guard-INPUT guard-CHECKPOINT ## Generate a neural signal from JSONL snapshots
	@set -e; \
	if [ -n "$(MARKET)" ]; then \
		uv run python tools/research/generate_nn_signal.py --input "$(INPUT)" --market "$(MARKET)" --checkpoint "$(CHECKPOINT)" --output "$(OUTPUT)"; \
	else \
		uv run python tools/research/generate_nn_signal.py --input "$(INPUT)" --checkpoint "$(CHECKPOINT)" --output "$(OUTPUT)"; \
	fi

summary: guard-INPUT ## Summarize a captured JSONL market session
	@set -e; \
	if [ -n "$(MARKET)" ]; then \
		uv run python tools/research/replay_session.py --input "$(INPUT)" --market "$(MARKET)"; \
	else \
		uv run python tools/research/replay_session.py --input "$(INPUT)"; \
	fi

clean: ## Remove generated local artifacts and caches
	rm -rf dist coverage artifacts .mypy_cache .turbo apps/web/.next packages/trader-core/dist packages/motorsport-core/dist

guard-%:
	@if [ -z "$($*)" ]; then \
		echo "Missing required variable: $*"; \
		echo "Set it with: make <target> $*=..."; \
		exit 1; \
	fi
