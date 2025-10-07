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
        "cursor.svg",
        "logo.svg",
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

    # Build index page
    print("Building index.html...")
    template = env.get_template("index.html")
    html = template.render()
    (output_dir / "index.html").write_text(html)

    # Build markdown pages
    pages = [
        {"slug": "memo", "file": "memo.md"},
        {"slug": "join-us", "file": "join-us.md"},
    ]

    for page in pages:
        print(f"Building {page['slug']}/index.html...")

        # Read and convert markdown
        md_file = content_dir / page["file"]
        md_content = md_file.read_text()
        html_content = markdown.markdown(md_content)

        # Extract title from first h1 if present
        title = page["slug"].capitalize()
        if md_content.startswith("# "):
            title = md_content.split("\n")[0][2:]

        # Render template
        template = env.get_template("page.html")
        html = template.render(
            title=title,
            content=html_content,
            slug=page["slug"]
        )

        # Write to output
        page_dir = output_dir / page["slug"]
        page_dir.mkdir(exist_ok=True)
        (page_dir / "index.html").write_text(html)

    print("Build complete!")


if __name__ == "__main__":
    build_site()
