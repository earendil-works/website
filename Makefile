.DEFAULT_GOAL := build
.PHONY: build serve

# Install pinned build-time KaTeX on first use and after dependency updates.
node_modules/.katex-installed: package.json package-lock.json
	npm ci --ignore-scripts --no-audit --no-fund
	touch $@

build: node_modules/.katex-installed
	uv run --script build.py build

serve: node_modules/.katex-installed
	uv run --script build.py serve
