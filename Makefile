PNPM ?= pnpm

.PHONY: setup dev build test lint check

setup:
	cd web && $(PNPM) install --frozen-lockfile

dev:
	cd web && $(PNPM) dev

build:
	cd web && $(PNPM) build

test:
	cd web && $(PNPM) test

lint:
	cd web && $(PNPM) lint

check: lint test
