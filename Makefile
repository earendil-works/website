.PHONY: build serve

build:
	uv run --script build.py build

serve:
	uv run --script build.py serve
