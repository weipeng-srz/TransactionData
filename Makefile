GO ?= go
PNPM ?= pnpm
BIN_DIR ?= bin

.PHONY: setup dev build build-go build-web test test-go test-web lint lint-go lint-web check

setup:
	cd web && $(PNPM) install --frozen-lockfile

dev:
	cd web && $(PNPM) dev

build: build-go build-web

build-go:
	mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 $(GO) build -trimpath -o $(BIN_DIR)/stock-ticks ./cmd/stock-ticks
	CGO_ENABLED=0 $(GO) build -trimpath -o $(BIN_DIR)/stock-news ./cmd/stock-news

build-web:
	cd web && $(PNPM) build

test: test-go test-web

test-go:
	CGO_ENABLED=0 $(GO) test ./...

test-web:
	cd web && $(PNPM) test

lint: lint-go lint-web

lint-go:
	test -z "$$(gofmt -l $$(find cmd internal -name '*.go' -type f))"
	CGO_ENABLED=0 $(GO) vet ./...

lint-web:
	cd web && $(PNPM) lint

check: lint test
