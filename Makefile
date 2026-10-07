.DEFAULT_GOAL := build
.PHONY: build serve

# Install pinned npm dependencies (KaTeX) on first use and
# after dependency updates.
node_modules/.installed: package.json package-lock.json
	npm ci --ignore-scripts --no-audit --no-fund
	touch $@

build: node_modules/.installed
	uv run --script build.py build

serve: node_modules/.installed
	uv run --script build.py serve
