#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["minijinja", "pyyaml", "markdown", "watchdog"]
# ///
from __future__ import annotations

import argparse
import os
import re
import shutil
import threading
import time
import traceback
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any, Callable, Tuple
from urllib.parse import urlparse

from minijinja import Environment, safe, load_from_path

import yaml
import markdown as md_lib

ROOT = Path(__file__).resolve().parent
TEMPLATES_DIR = ROOT / "_templates"
STATIC_DIR = ROOT / "_static"
BUILD_DIR = ROOT / "_build"

FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)

SITE_URL = "https://earendil.com/"
UPDATES_FEED_LIMIT = 10
UPDATE_IGNORED_FILES = {"_index.md", "subscribe.md"}


def parse_frontmatter(raw: str) -> Tuple[dict[str, Any], str]:
    match = FRONTMATTER_RE.match(raw)
    if not match:
        return {}, raw
    fm_text = match.group(1)
    body = raw[match.end() :]
    if yaml is not None:
        data = yaml.safe_load(fm_text) or {}
    else:
        data = {}
        for line in fm_text.splitlines():
            if not line.strip() or line.strip().startswith("#"):
                continue
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            data[key.strip()] = value.strip()
    return data, body


def render_markdown(text: str) -> str:
    text = text.strip()
    if not text:
        return ""
    return md_lib.markdown(text, extensions=["extra"])


def format_day_from_date(date_str: str) -> str:
    if not date_str:
        return ""
    try:
        parsed = parsedate_to_datetime(date_str)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.strftime("%a, %d %b %Y")
    except (TypeError, ValueError):
        return date_str


def slug_for_path(path: Path) -> str:
    rel = path.relative_to(ROOT)
    if rel.name == "_index.md":
        # _index.md represents the directory it's in
        parent_parts = rel.parent.parts
        if not parent_parts:
            return "/"
        return "/" + "/".join(parent_parts) + "/"
    without_ext = rel.with_suffix("")
    return "/" + "/".join(without_ext.parts) + "/"


def output_path_for(path: Path, build_dir: Path, frontmatter: dict[str, Any] | None = None) -> Path:
    # Allow explicit output filename via frontmatter
    if frontmatter and "output" in frontmatter:
        return build_dir / frontmatter["output"]
    rel = path.relative_to(ROOT)
    if rel.name == "_index.md":
        # _index.md represents the directory it's in
        parent_parts = rel.parent.parts
        if not parent_parts:
            return build_dir / "index.html"
        return build_dir / Path(*parent_parts) / "index.html"
    without_ext = rel.with_suffix("")
    return build_dir / without_ext / "index.html"


def iter_markdown_files() -> list[Path]:
    markdown_files: list[Path] = []
    for root, dirs, files in os.walk(ROOT):
        root_path = Path(root)
        # Skip build artifacts and template/static dirs
        dirs[:] = [
            d
            for d in dirs
            if d not in {"_build", "_build_tmp"} and not d.startswith(("_", "."))
        ]
        for filename in files:
            if not filename.endswith(".md"):
                continue
            path = root_path / filename
            markdown_files.append(path)
    return markdown_files


def collect_update_entries() -> list[dict[str, Any]]:
    """Collect update files with metadata and rendered content."""
    updates_dir = ROOT / "posts"
    updates = []
    if not updates_dir.exists():
        return updates
    for md_path in updates_dir.glob("*.md"):
        if md_path.name in UPDATE_IGNORED_FILES:
            continue
        raw = md_path.read_text()
        frontmatter, body = parse_frontmatter(raw)
        slug = slug_for_path(md_path)
        base_name = md_path.stem  # e.g., "memorandum"
        date_str = frontmatter.get("date", "")
        date_prefix = ""
        parsed_date = None
        if date_str:
            try:
                parsed_date = parsedate_to_datetime(date_str)
                if parsed_date.tzinfo is None:
                    parsed_date = parsed_date.replace(tzinfo=timezone.utc)
                date_prefix = parsed_date.strftime("%Y%m%d-")
            except (ValueError, TypeError):
                parsed_date = None
        updates.append({
            "name": date_prefix + base_name,
            "slug": slug,
            "title": frontmatter.get("title", base_name),
            "date": frontmatter.get("date", ""),
            "parsed_date": parsed_date,
            "subject": frontmatter.get("subject", ""),
            "content": render_markdown(body),
        })
    # Sort by date, newest first
    updates.sort(
        key=lambda u: u["parsed_date"] or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return updates


def _format_rss_date(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")


def _generate_atom_feed(title: str, feed_url: str, subtitle: str, updates):
    now = datetime.now(timezone.utc).isoformat()
    entries = []
    for update in updates:
        if not update["parsed_date"]:
            continue
        entry_date = update["parsed_date"].astimezone(timezone.utc).isoformat()
        update_url = SITE_URL.rstrip("/") + update["slug"]
        content = update["content"]
        entry_xml = f"""  <entry>
    <id>{update_url}</id>
    <title>{update['title']}</title>
    <link href=\"{update_url}\" />
    <published>{entry_date}</published>
    <updated>{entry_date}</updated>
    <author>
      <name>Earendil</name>
    </author>
    <content type=\"html\"><![CDATA[{content}]]></content>
  </entry>"""
        entries.append(entry_xml)

    feed_xml = f"""<?xml version=\"1.0\" encoding=\"utf-8\"?>
<feed xmlns=\"http://www.w3.org/2005/Atom\">
  <id>{feed_url}</id>
  <title>{title}</title>
  <link href=\"{SITE_URL}\" />
  <link href=\"{feed_url}\" rel=\"self\" />
  <description>{subtitle}</description>
  <language>en</language>
  <updated>{now}</updated>
  <author>
    <name>Earendil</name>
  </author>
{chr(10).join(entries)}
</feed>"""
    return feed_xml


def _generate_rss_feed(title: str, feed_url: str, subtitle: str, updates):
    now = datetime.now(timezone.utc)
    rss_date_format = _format_rss_date(now)

    items = []
    for update in updates:
        if not update["parsed_date"]:
            continue
        update_url = SITE_URL.rstrip("/") + update["slug"]
        pub_date = _format_rss_date(update["parsed_date"])
        content = update["content"]
        item_xml = f"""    <item>
      <title>{update['title']}</title>
      <link>{update_url}</link>
      <guid isPermaLink=\"true\">{update_url}</guid>
      <pubDate>{pub_date}</pubDate>
      <description><![CDATA[{content}]]></description>
    </item>"""
        items.append(item_xml)

    rss_xml = f"""<?xml version=\"1.0\" encoding=\"utf-8\"?>
<rss version=\"2.0\">
  <channel>
    <title>{title}</title>
    <link>{SITE_URL}</link>
    <description>{subtitle}</description>
    <language>en</language>
    <lastBuildDate>{rss_date_format}</lastBuildDate>
{chr(10).join(items)}
  </channel>
</rss>"""
    return rss_xml


def build_update_feeds(updates, build_dir: Path) -> None:
    if not updates:
        return
    recent_updates = updates[:UPDATES_FEED_LIMIT]
    posts_dir = build_dir / "posts"
    posts_dir.mkdir(parents=True, exist_ok=True)

    atom_feed_url = SITE_URL.rstrip("/") + "/posts/feed.atom"
    rss_feed_url = SITE_URL.rstrip("/") + "/posts/feed.rss"

    atom_xml = _generate_atom_feed(
        title="Earendil Posts",
        feed_url=atom_feed_url,
        subtitle="Posts from Earendil",
        updates=recent_updates,
    )
    (posts_dir / "feed.atom").write_text(atom_xml, encoding="utf-8")

    rss_xml = _generate_rss_feed(
        title="Earendil Posts",
        feed_url=rss_feed_url,
        subtitle="Posts from Earendil",
        updates=recent_updates,
    )
    (posts_dir / "feed.rss").write_text(rss_xml, encoding="utf-8")



def build_to(build_dir: Path) -> None:
    if build_dir.exists():
        shutil.rmtree(build_dir)
    build_dir.mkdir(parents=True, exist_ok=True)

    if STATIC_DIR.exists():
        shutil.copytree(STATIC_DIR, build_dir / "static")
        static_files = list(STATIC_DIR.rglob("*"))
        static_count = sum(1 for f in static_files if f.is_file())
        print(f"  Copied {static_count} static files", flush=True)

    cname_file = ROOT / "CNAME"
    if cname_file.exists():
        shutil.copy(cname_file, build_dir / "CNAME")

    env = Environment(loader=load_from_path(str(TEMPLATES_DIR)))

    # Collect updates for navigation + feeds
    update_entries = collect_update_entries()
    updates = [
        {
            "name": update["name"],
            "slug": update["slug"],
            "title": update["title"],
            "date": update["date"],
            "parsed_date": update["parsed_date"],
            "subject": update["subject"],
        }
        for update in update_entries
    ]

    md_files = iter_markdown_files()
    for md_path in md_files:
        raw = md_path.read_text()
        frontmatter, body = parse_frontmatter(raw)
        template_name = frontmatter.get("template", "index") + ".html"
        html_body = render_markdown(body)
        output_path = output_path_for(md_path, build_dir, frontmatter)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        slug = slug_for_path(md_path)
        # Compute dismiss URL (parent directory)
        if slug.startswith("/posts/") and slug != "/posts/":
            dismiss_url = "/posts/"
        else:
            dismiss_url = "/"
        page = dict(frontmatter)
        if "date" in page:
            page["date_day"] = format_day_from_date(page.get("date", ""))
        rendered = env.render_template(
            template_name,
            title=frontmatter.get("title", "Earendil"),
            page=page,
            content=safe(html_body),
            slug=slug,
            posts=updates,
            is_posts_section=slug.startswith("/posts/"),
            dismiss_url=dismiss_url,
        )
        output_path.write_text(rendered)
        rel_path = md_path.relative_to(ROOT)
        print(f"  {rel_path} -> {output_path.relative_to(build_dir)}", flush=True)

    build_update_feeds(update_entries, build_dir)


def build() -> None:
    temp_dir = BUILD_DIR.with_name(f"{BUILD_DIR.name}_tmp")
    build_to(temp_dir)
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
    temp_dir.replace(BUILD_DIR)


HOST = "0.0.0.0"
PORT = 8000
DEBOUNCE_DELAY = 0.3
IGNORE_DIRS = {"_build", "_build_tmp", ".git"}

# Global dictionary to track reload events by connection ID
RELOAD_EVENTS: dict[int, threading.Event] = {}
RELOAD_EVENTS_LOCK = threading.Lock()

RELOAD_SCRIPT = """
<script>
(function() {
  console.log('Live reload enabled');
  const eventSource = new EventSource('/sse');
  eventSource.onmessage = function(event) {
    if (event.data === 'reload') {
      console.log('Reloading page due to file changes...');
      location.reload();
    }
  };
  eventSource.onerror = function(event) {
    console.log('Live reload connection error, retrying...');
    setTimeout(() => location.reload(), 1000);
  };
})();
</script>
"""


class LiveReloadHandler(SimpleHTTPRequestHandler):
    """HTTP handler with live reload support via SSE."""

    def __init__(self, *args, **kwargs):
        try:
            super().__init__(*args, **kwargs)
        except (ConnectionResetError, BrokenPipeError):
            pass

    def do_GET(self):
        try:
            if self.path == "/sse":
                self.handle_sse()
            else:
                self.handle_file_with_reload()
        except (ConnectionResetError, BrokenPipeError):
            pass

    def handle_sse(self):
        """Handle Server-Sent Events for live reload."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

        connection_id = id(self)
        try:
            self.wfile.write(b"data: connected\n\n")
            self.wfile.flush()

            reload_event = threading.Event()
            with RELOAD_EVENTS_LOCK:
                RELOAD_EVENTS[connection_id] = reload_event

            while True:
                try:
                    if reload_event.wait(timeout=0.1):
                        self.wfile.write(b"data: reload\n\n")
                        self.wfile.flush()
                        break
                    else:
                        self.wfile.write(b": keepalive\n\n")
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    break
        finally:
            with RELOAD_EVENTS_LOCK:
                RELOAD_EVENTS.pop(connection_id, None)

    def handle_file_with_reload(self):
        """Handle regular file requests, injecting reload script into HTML."""
        parsed_path = urlparse(self.path)
        file_path = parsed_path.path.lstrip("/")

        if not file_path:
            file_path = "index.html"
        elif file_path.endswith("/"):
            file_path = file_path + "index.html"

        full_path = Path(self.directory) / file_path

        try:
            if full_path.exists() and full_path.is_file() and file_path.endswith(".html"):
                content = full_path.read_text(encoding="utf-8")
                if "</body>" in content:
                    content = content.replace("</body>", f"{RELOAD_SCRIPT}</body>")
                else:
                    content += RELOAD_SCRIPT

                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(content.encode("utf-8"))))
                self.end_headers()
                self.wfile.write(content.encode("utf-8"))
            else:
                super().do_GET()
        except Exception:
            super().do_GET()

    def log_message(self, format, *args):
        pass


def notify_reload():
    """Signal all SSE clients to reload."""
    with RELOAD_EVENTS_LOCK:
        for event in RELOAD_EVENTS.values():
            event.set()
        RELOAD_EVENTS.clear()


class BackgroundBuilder:
    """File watcher that triggers builds on changes."""

    def __init__(self, on_build_complete: Callable[[], None] | None = None):
        self.debounce_delay = DEBOUNCE_DELAY
        self.last_change_time = 0.0
        self.build_thread: threading.Thread | None = None
        self.stop_event = threading.Event()
        self.build_lock = threading.Lock()
        self.is_building = False
        self.on_build_complete = on_build_complete

    def should_ignore(self, path: str) -> bool:
        """Check if a path should be ignored."""
        path_obj = Path(path)
        try:
            rel = path_obj.relative_to(ROOT)
            parts = rel.parts
            return any(part in IGNORE_DIRS or part.startswith(("_", ".")) for part in parts)
        except ValueError:
            return True

    def _on_change(self, event):
        """Handle any file system change."""
        if event.is_directory:
            return
        paths = [event.src_path]
        dest_path = getattr(event, "dest_path", None)
        if dest_path:
            paths.append(dest_path)
        if all(self.should_ignore(path) for path in paths if path):
            return
        self.last_change_time = time.time()

    def _build_loop(self):
        """Background thread that triggers builds after debounce delay."""
        while not self.stop_event.is_set():
            should_build = False

            with self.build_lock:
                if (
                    self.last_change_time > 0
                    and time.time() - self.last_change_time > self.debounce_delay
                    and not self.is_building
                ):
                    should_build = True
                    self.is_building = True
                    build_trigger_time = self.last_change_time

            if should_build:
                try:
                    print("Rebuilding...", flush=True)
                    build()
                    print("Done.", flush=True)
                    if self.on_build_complete:
                        self.on_build_complete()
                except Exception:
                    traceback.print_exc()
                finally:
                    with self.build_lock:
                        self.is_building = False
                        if self.last_change_time == build_trigger_time:
                            self.last_change_time = 0

            time.sleep(0.1)

    def start(self):
        """Start watching for file changes."""
        from watchdog.observers import Observer
        from watchdog.events import FileSystemEventHandler

        # Initial build
        print("Building...", flush=True)
        build()
        print("Done.", flush=True)

        # Set up file watcher
        handler = FileSystemEventHandler()
        handler.on_created = self._on_change
        handler.on_modified = self._on_change
        handler.on_deleted = self._on_change
        handler.on_moved = self._on_change

        self.observer = Observer()
        self.observer.schedule(handler, str(ROOT), recursive=True)
        self.observer.start()

        # Start build thread
        self.build_thread = threading.Thread(target=self._build_loop, daemon=True)
        self.build_thread.start()

    def stop(self):
        """Stop the file watcher."""
        self.stop_event.set()
        self.observer.stop()
        self.observer.join()
        if self.build_thread:
            self.build_thread.join(timeout=5)


def serve() -> None:
    """Serve with file watching and live reload."""
    background_builder = BackgroundBuilder(on_build_complete=notify_reload)
    background_builder.start()

    try:
        print(f"Serving on http://{HOST}:{PORT}/ with live reload")
        server = ThreadingHTTPServer(
            (HOST, PORT),
            lambda *args: LiveReloadHandler(*args, directory=str(BUILD_DIR)),
        )
        server.allow_reuse_address = True
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping...")
        background_builder.stop()
    except Exception as e:
        print(f"Server error: {e}")
        background_builder.stop()
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the site.")
    parser.add_argument("command", nargs="?", default="build", choices=["build", "serve"])
    args = parser.parse_args()

    if args.command == "serve":
        serve()
    else:
        print("Building...", flush=True)
        build()
        print("Done.", flush=True)


if __name__ == "__main__":
    main()
