.DEFAULT_GOAL := help
SHELL := /bin/sh

OUTPUT ?= artifacts/signals/current.json

.PHONY: help install js-install py-sync check test build paper replay signal summary clean guard-%

help: ## Show available targets
	@awk 'BEGIN {FS = ":.*## "}; /^[a-zA-Z0-9_-]+:.*## / {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install TypeScript and Python dependencies
	pnpm install
	uv sync

js-install: ## Install TypeScript dependencies with pnpm
	pnpm install

py-sync: ## Sync the Python environment with uv
	uv sync

check: ## Run TypeScript checks and Python syntax validation
	pnpm check
	uv run python -m py_compile research/signal_contract.py research/generate_signal.py research/replay_session.py

test: ## Run the TypeScript test suite
	pnpm test

build: ## Build the TypeScript project
	pnpm build

paper: ## Run the paper trading bot
	pnpm paper

replay: guard-REPLAY_INPUT_PATH ## Replay a captured market session
	REPLAY_INPUT_PATH="$(REPLAY_INPUT_PATH)" pnpm replay

signal: guard-INPUT ## Generate a baseline signal from JSONL snapshots
	@set -e; \
	if [ -n "$(MARKET)" ]; then \
		uv run python research/generate_signal.py --input "$(INPUT)" --market "$(MARKET)" --output "$(OUTPUT)"; \
	else \
		uv run python research/generate_signal.py --input "$(INPUT)" --output "$(OUTPUT)"; \
	fi

summary: guard-INPUT ## Summarize a captured JSONL market session
	@set -e; \
	if [ -n "$(MARKET)" ]; then \
		uv run python research/replay_session.py --input "$(INPUT)" --market "$(MARKET)"; \
	else \
		uv run python research/replay_session.py --input "$(INPUT)"; \
	fi

clean: ## Remove generated local artifacts and caches
	rm -rf dist coverage artifacts .mypy_cache

guard-%:
	@if [ -z "$($*)" ]; then \
		echo "Missing required variable: $*"; \
		echo "Set it with: make <target> $*=..."; \
		exit 1; \
	fi
