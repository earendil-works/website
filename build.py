#!/usr/bin/env python3
"""Build script for the Earendil website."""

import shutil
from pathlib import Path
from jinja2 import Environment, FileSystemLoader
import markdown


def build_site():
    """Build the static website."""
    # Setup paths
    base_dir = Path(__file__).parent
    templates_dir = base_dir / "templates"
    content_dir = base_dir / "content"
    output_dir = base_dir / "build"

    # Clean and create output directory
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(exist_ok=True)

    # Copy static assets
    print("Copying static assets...")
    static_files = [
        "earendil.css",
        "earendil.js",
        "cursor.svg",
        "cursor-hover.svg",
        "logo.svg",
        "back.svg",
        "ocean-10.jpg",
        "ocean-70.jpg",
        "waves-100.jpg",
        "waves-80.jpg",
        "CNAME",
    ]
    for file in static_files:
        src = base_dir / file
        if src.exists():
            shutil.copy2(src, output_dir / file)

    # Copy favicon directory
    favicon_src = base_dir / "favicon"
    if favicon_src.exists():
        shutil.copytree(favicon_src, output_dir / "favicon")

    # Setup Jinja2 environment
    env = Environment(loader=FileSystemLoader(templates_dir))

    # Gather markdown-backed page content for SPA
    page_sources = [
        {"slug": "memo", "file": "memo.md"},
        {"slug": "join-us", "file": "join-us.md"},
    ]

    pages = []
    for entry in page_sources:
        md_file = content_dir / entry["file"]
        md_content = md_file.read_text()
        lines = md_content.splitlines()

        title = entry["slug"].replace('-', ' ').title()
        content_lines = lines
        if lines and lines[0].startswith("# "):
            title = lines[0][2:].strip()
            content_lines = lines[1:]

        # Drop the leading heading from the rendered HTML to avoid duplicate H1s
        content_md = "\n".join(content_lines).lstrip("\n")
        html_content = markdown.markdown(content_md)

        pages.append({
            "slug": entry["slug"],
            "title": title,
            "path": f"/{entry['slug']}/",
            "content": html_content,
        })

    # Build index page with embedded page content
    print("Building index.html...")
    template = env.get_template("index.html")
    html = template.render(pages=pages)
    (output_dir / "index.html").write_text(html)

    # Create fallback copies for direct navigation
    for page in pages:
        page_dir = output_dir / page["slug"]
        page_dir.mkdir(exist_ok=True)
        print(f"Copying index.html to {page['slug']}/index.html...")
        shutil.copy2(output_dir / "index.html", page_dir / "index.html")

    print("Build complete!")


if __name__ == "__main__":
    build_site()
