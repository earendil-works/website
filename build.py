#!/usr/bin/env -S uv run --script
# /// script
# dependencies = ["minijinja", "pyyaml", "markdown", "watchdog", "pillow"]
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
from urllib.parse import urljoin, urlparse
from xml.etree import ElementTree

from minijinja import Environment, safe, load_from_path
from PIL import Image, ImageDraw, ImageFont

import yaml
import markdown as md_lib

ROOT = Path(__file__).resolve().parent
TEMPLATES_DIR = ROOT / "_templates"
STATIC_DIR = ROOT / "_static"
LOCALES_DIR = ROOT / "locales"
BUILD_DIR = ROOT / "_build"

FRONTMATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?", re.DOTALL)
CODE_BLOCK_RE = re.compile(
    r"<pre><code(?P<attrs>[^>]*)>(?P<body>.*?)</code></pre>",
    re.DOTALL,
)
CODE_REVEAL_MARKER = "◊"
CODE_REVEAL_INITIAL_DELAY_MS = 120
CODE_REVEAL_STEP_DELAY_MS = 105

SITE_URL = "https://earendil.com/"
UPDATES_FEED_LIMIT = 10
UPDATE_IGNORED_FILES = {"_index.md", "subscribe.md"}

OG_IMAGE_SIZE = (1200, 630)
OG_TITLE_MAX_WIDTH = 1000
OG_TITLE_MAX_HEIGHT = 310
OG_TITLE_MAX_LINES = 3
OG_TEXT_COLOR = "#353431"
OG_PAPER_PATH = STATIC_DIR / "paper.png"
OG_LOGO_PATH = STATIC_DIR / "og" / "earendil-logo.png"
OG_TITLE_FONT_PATH = STATIC_DIR / "fonts" / "PlantinNowVariable-Upright.woff2"


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


def _render_code_reveals(html: str) -> str:
    """Turn ◊-delimited code chunks into viewport-reveal steps.

    The marker only has meaning inside a fenced code block. Text before the
    first marker stays visible; each marked chunk becomes the next reveal.
    Without the site CSS or JavaScript all chunks remain ordinary code text.
    """
    def replace_code_block(match: re.Match[str]) -> str:
        body = match.group("body")
        if CODE_REVEAL_MARKER not in body:
            return match.group(0)

        chunks = body.split(CODE_REVEAL_MARKER)
        rendered_chunks = [chunks[0]]
        reveal_index = 0
        for chunk in chunks[1:]:
            if not chunk:
                continue
            delay = CODE_REVEAL_INITIAL_DELAY_MS + reveal_index * CODE_REVEAL_STEP_DELAY_MS
            rendered_chunks.append(
                f'<span class="code-reveal__step" style="--reveal-delay: {delay}ms">{chunk}</span>'
            )
            reveal_index += 1

        attrs = match.group("attrs")
        return (
            f'<pre class="code-reveal" data-code-reveal data-reveal-steps="{reveal_index}">'
            f"<code{attrs}>{''.join(rendered_chunks)}</code></pre>"
        )

    return CODE_BLOCK_RE.sub(replace_code_block, html)


def render_markdown(text: str) -> str:
    text = text.strip()
    if not text:
        return ""
    html = md_lib.markdown(text, extensions=["extra"])
    return _render_code_reveals(html)


def parse_post_date(date_str: str) -> datetime | None:
    if not date_str:
        return None
    try:
        parsed = parsedate_to_datetime(date_str)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except (TypeError, ValueError):
        return None


def linkify_email_header(value: str) -> str:
    if not value:
        return ""
    # Convert <email@domain> to &lt;<a href="mailto:email@domain">email@domain</a>&gt;
    return re.sub(
        r"<([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>",
        r"&lt;<a href=\"mailto:\1\">\1</a>&gt;",
        value,
    )


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


def _og_text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> int:
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def _wrap_og_title(draw: ImageDraw.ImageDraw, title: str, font: ImageFont.FreeTypeFont) -> list[str]:
    """Wrap a title to the available card width, including long words."""
    lines: list[str] = []
    current_line = ""
    for word in title.split():
        candidate = f"{current_line} {word}".strip()
        if _og_text_width(draw, candidate, font) <= OG_TITLE_MAX_WIDTH:
            current_line = candidate
            continue

        if current_line:
            lines.append(current_line)
            current_line = ""

        while _og_text_width(draw, word, font) > OG_TITLE_MAX_WIDTH:
            split_at = len(word)
            while split_at > 1 and _og_text_width(draw, word[:split_at], font) > OG_TITLE_MAX_WIDTH:
                split_at -= 1
            lines.append(word[:split_at])
            word = word[split_at:]
        current_line = word

    if current_line:
        lines.append(current_line)
    return lines


def _avoid_og_orphan(
    draw: ImageDraw.ImageDraw,
    lines: list[str],
    font: ImageFont.FreeTypeFont,
) -> list[str]:
    """Move a word from the previous line when the final line is an orphan."""
    balanced = list(lines)
    if len(balanced) < 2 or len(balanced[-1].split()) != 1:
        return balanced

    previous_words = balanced[-2].split()
    if len(previous_words) < 2:
        return balanced

    final_line = f"{previous_words[-1]} {balanced[-1]}"
    if _og_text_width(draw, final_line, font) <= OG_TITLE_MAX_WIDTH:
        balanced[-2] = " ".join(previous_words[:-1])
        balanced[-1] = final_line
    return balanced


def _truncate_og_lines(
    draw: ImageDraw.ImageDraw,
    lines: list[str],
    font: ImageFont.FreeTypeFont,
) -> list[str]:
    """Clamp wrapped title lines and mark omitted text with an ellipsis."""
    omitted_text = len(lines) > OG_TITLE_MAX_LINES
    truncated = _avoid_og_orphan(draw, lines[:OG_TITLE_MAX_LINES], font)

    # If two words cannot share the final line, omit the orphan rather than
    # allowing it to sit by itself.
    if len(truncated) > 1 and len(truncated[-1].split()) == 1:
        truncated.pop()
        omitted_text = True

    if not omitted_text:
        return truncated

    last_line = truncated[-1].rstrip()
    ellipsis = "…"
    while last_line and _og_text_width(draw, last_line + ellipsis, font) > OG_TITLE_MAX_WIDTH:
        last_line = last_line[:-1].rstrip()
    truncated[-1] = last_line + ellipsis
    return truncated


def generate_og_image(title: str, output_path: Path) -> None:
    """Generate a simple paper, logo, and article-title social card."""
    width, height = OG_IMAGE_SIZE
    paper = Image.open(OG_PAPER_PATH).convert("RGB")
    image = Image.new("RGB", OG_IMAGE_SIZE, "#faf9f6")
    for y in range(0, height, paper.height):
        for x in range(0, width, paper.width):
            image.paste(paper, (x, y))

    logo = Image.open(OG_LOGO_PATH).convert("RGBA")
    logo.thumbnail((180, 137), Image.Resampling.LANCZOS)
    image.paste(logo, ((width - logo.width) // 2, 48), logo)

    draw = ImageDraw.Draw(image)
    title_lines: list[str] = []
    title_font = None
    title_spacing = 0
    title_bbox = (0, 0, 0, 0)
    for font_size in range(80, 41, -2):
        candidate_font = ImageFont.truetype(str(OG_TITLE_FONT_PATH), font_size)
        candidate_lines = _avoid_og_orphan(
            draw,
            _wrap_og_title(draw, title, candidate_font),
            candidate_font,
        )
        candidate_spacing = round(font_size * 0.18)
        candidate_text = "\n".join(candidate_lines)
        candidate_bbox = draw.multiline_textbbox(
            (0, 0),
            candidate_text,
            font=candidate_font,
            spacing=candidate_spacing,
            align="center",
        )
        candidate_height = candidate_bbox[3] - candidate_bbox[1]
        has_orphan = len(candidate_lines) > 1 and len(candidate_lines[-1].split()) == 1
        if (
            len(candidate_lines) <= OG_TITLE_MAX_LINES
            and candidate_height <= OG_TITLE_MAX_HEIGHT
            and not has_orphan
        ):
            title_lines = candidate_lines
            title_font = candidate_font
            title_spacing = candidate_spacing
            title_bbox = candidate_bbox
            break

    if title_font is None:
        title_font = ImageFont.truetype(str(OG_TITLE_FONT_PATH), 40)
        title_lines = _truncate_og_lines(
            draw,
            _wrap_og_title(draw, title, title_font),
            title_font,
        )
        title_spacing = 7
        title_bbox = draw.multiline_textbbox(
            (0, 0),
            "\n".join(title_lines),
            font=title_font,
            spacing=title_spacing,
            align="center",
        )

    title_text = "\n".join(title_lines)
    text_width = title_bbox[2] - title_bbox[0]
    text_height = title_bbox[3] - title_bbox[1]
    title_area_top = 240
    title_x = (width - text_width) // 2 - title_bbox[0]
    title_y = title_area_top + (OG_TITLE_MAX_HEIGHT - text_height) // 2 - title_bbox[1]
    draw.multiline_text(
        (title_x, title_y),
        title_text,
        fill=OG_TEXT_COLOR,
        font=title_font,
        spacing=title_spacing,
        align="center",
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, "PNG", optimize=True)


def iter_markdown_files() -> list[Path]:
    markdown_files: list[Path] = []
    for root, dirs, files in os.walk(ROOT):
        root_path = Path(root)
        # Skip build artifacts, template/static dirs, and node_modules
        dirs[:] = [
            d
            for d in dirs
            if d not in {"_build", "_build_tmp", "node_modules", "locales"} and not d.startswith(("_", "."))
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
        parsed_date = parse_post_date(date_str)
        date_prefix = parsed_date.strftime("%Y%m%d-") if parsed_date else ""
        updates.append({
            "name": date_prefix + base_name,
            "slug": slug,
            "title": frontmatter.get("title", base_name),
            "date": date_str,
            "date_day": parsed_date.strftime("%a, %d %b %Y") if parsed_date else date_str,
            "date_iso": parsed_date.date().isoformat() if parsed_date else "",
            "parsed_date": parsed_date,
            "subject": frontmatter.get("subject", ""),
            "i18n_key": frontmatter.get("i18n_key", ""),
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


def _absolutize_html_urls(content: str, base_url: str) -> str:
    """Make links in feed content independent of the feed reader's base URL."""
    url_attr_re = re.compile(
        r"(?P<prefix>\b(?:href|src)\s*=\s*)(?P<quote>['\"])(?P<url>[^'\"]+)(?P=quote)",
        re.IGNORECASE,
    )

    def replace_url(match: re.Match[str]) -> str:
        return (
            f"{match.group('prefix')}{match.group('quote')}"
            f"{urljoin(base_url, match.group('url'))}{match.group('quote')}"
        )

    return url_attr_re.sub(replace_url, content)


def _serialize_xml(root: ElementTree.Element) -> str:
    ElementTree.indent(root, space="  ")
    return ElementTree.tostring(root, encoding="unicode", xml_declaration=True)


def _generate_atom_feed(title: str, feed_url: str, subtitle: str, updates):
    atom_namespace = "http://www.w3.org/2005/Atom"
    xml_namespace = "http://www.w3.org/XML/1998/namespace"
    ElementTree.register_namespace("", atom_namespace)

    def atom_element(name: str) -> str:
        return f"{{{atom_namespace}}}{name}"

    feed = ElementTree.Element(
        atom_element("feed"),
        {f"{{{xml_namespace}}}lang": "en"},
    )
    ElementTree.SubElement(feed, atom_element("id")).text = feed_url
    ElementTree.SubElement(feed, atom_element("title")).text = title
    ElementTree.SubElement(feed, atom_element("link"), {"href": SITE_URL})
    ElementTree.SubElement(
        feed,
        atom_element("link"),
        {"href": feed_url, "rel": "self"},
    )
    ElementTree.SubElement(feed, atom_element("subtitle")).text = subtitle
    ElementTree.SubElement(feed, atom_element("updated")).text = (
        datetime.now(timezone.utc).isoformat()
    )
    author = ElementTree.SubElement(feed, atom_element("author"))
    ElementTree.SubElement(author, atom_element("name")).text = "Earendil"

    for update in updates:
        if not update["parsed_date"]:
            continue
        entry_date = update["parsed_date"].astimezone(timezone.utc).isoformat()
        update_url = SITE_URL.rstrip("/") + update["slug"]
        entry = ElementTree.SubElement(feed, atom_element("entry"))
        ElementTree.SubElement(entry, atom_element("id")).text = update_url
        ElementTree.SubElement(entry, atom_element("title")).text = update["title"]
        ElementTree.SubElement(entry, atom_element("link"), {"href": update_url})
        ElementTree.SubElement(entry, atom_element("published")).text = entry_date
        ElementTree.SubElement(entry, atom_element("updated")).text = entry_date
        author = ElementTree.SubElement(entry, atom_element("author"))
        ElementTree.SubElement(author, atom_element("name")).text = "Earendil"
        content = ElementTree.SubElement(entry, atom_element("content"), {"type": "html"})
        content.text = _absolutize_html_urls(update["content"], update_url)

    return _serialize_xml(feed)


def _generate_rss_feed(title: str, feed_url: str, subtitle: str, updates):
    atom_namespace = "http://www.w3.org/2005/Atom"
    ElementTree.register_namespace("atom", atom_namespace)

    rss = ElementTree.Element("rss", {"version": "2.0"})
    channel = ElementTree.SubElement(rss, "channel")
    ElementTree.SubElement(channel, "title").text = title
    ElementTree.SubElement(channel, "link").text = SITE_URL
    ElementTree.SubElement(
        channel,
        f"{{{atom_namespace}}}link",
        {"href": feed_url, "rel": "self", "type": "application/rss+xml"},
    )
    ElementTree.SubElement(channel, "description").text = subtitle
    ElementTree.SubElement(channel, "language").text = "en"
    ElementTree.SubElement(channel, "lastBuildDate").text = _format_rss_date(datetime.now(timezone.utc))

    for update in updates:
        if not update["parsed_date"]:
            continue
        update_url = SITE_URL.rstrip("/") + update["slug"]
        item = ElementTree.SubElement(channel, "item")
        ElementTree.SubElement(item, "title").text = update["title"]
        ElementTree.SubElement(item, "link").text = update_url
        ElementTree.SubElement(item, "guid", {"isPermaLink": "true"}).text = update_url
        ElementTree.SubElement(item, "pubDate").text = _format_rss_date(update["parsed_date"])
        description = ElementTree.SubElement(item, "description")
        description.text = _absolutize_html_urls(update["content"], update_url)

    return _serialize_xml(rss)


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

    if LOCALES_DIR.exists():
        shutil.copytree(LOCALES_DIR, build_dir / "locales")
        locale_files = list(LOCALES_DIR.rglob("*.json"))
        print(f"  Copied {len(locale_files)} locale files", flush=True)

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
            "date_day": update["date_day"],
            "date_iso": update["date_iso"],
            "parsed_date": update["parsed_date"],
            "subject": update["subject"],
            "i18n_key": update["i18n_key"],
        }
        for update in update_entries
    ]

    md_files = iter_markdown_files()
    for md_path in md_files:
        raw = md_path.read_text()
        frontmatter, body = parse_frontmatter(raw)
        template_key = frontmatter.get("template", "index")
        template_name = template_key + ".html"
        html_body = render_markdown(body)
        output_path = output_path_for(md_path, build_dir, frontmatter)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        slug = slug_for_path(md_path)
        page_classes: list[str] = []
        if template_key == "posts-index":
            page_classes.append("page--posts")
        elif template_key == "updates":
            page_classes.extend(["page--posts", "page--post-detail"])

        extra_page_classes = frontmatter.get("page_class", "")
        if isinstance(extra_page_classes, str):
            page_classes.extend(extra_page_classes.split())
        elif isinstance(extra_page_classes, list):
            page_classes.extend(str(value) for value in extra_page_classes if value)
        page = dict(frontmatter)
        if "date" in page:
            parsed_page_date = parse_post_date(page.get("date", ""))
            if parsed_page_date:
                page["date_day"] = parsed_page_date.strftime("%a, %d %b %Y")
                page["date_iso"] = parsed_page_date.date().isoformat()
        page["from_html"] = safe(linkify_email_header(str(page.get("from", ""))))
        page["to_html"] = safe(linkify_email_header(str(page.get("to", ""))))
        is_article = template_key == "updates"
        og_image_path = str(frontmatter.get("og_image", ""))
        if is_article and not og_image_path:
            og_image_path = f"/static/og{slug.rstrip('/')}.png"
            generate_og_image(
                str(frontmatter.get("title", "Earendil")),
                build_dir / og_image_path.lstrip("/"),
            )
        if og_image_path:
            if og_image_path.startswith(("http://", "https://")):
                og_image_url = og_image_path
            else:
                og_image_url = SITE_URL.rstrip("/") + "/" + og_image_path.lstrip("/")
        else:
            og_image_url = SITE_URL.rstrip("/") + "/static/favicon/android-chrome-512x512.png"

        rendered = env.render_template(
            template_name,
            title=frontmatter.get("title", "Earendil"),
            description=frontmatter.get("description", ""),
            page=page,
            content=safe(html_body),
            slug=slug,
            posts=updates,
            is_posts_section=slug.startswith("/posts/"),
            is_article=is_article,
            og_image=og_image_url,
            page_classes=" ".join(page_classes),
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
        """Handle file requests. For HTML, inject live reload script."""
        # Let parent class handle the actual file serving securely
        # We just need to intercept HTML responses to inject reload script
        
        # Check if this looks like an HTML request
        path = self.path.split('?')[0]
        if not (path.endswith('.html') or path.endswith('/') or path == '/' or '.' not in path.split('/')[-1]):
            super().do_GET()
            return
        
        # For HTML requests, we need to intercept the response
        # Use parent's translate_path which is secure
        fs_path = self.translate_path(self.path)
        
        # Check if it's a directory (serve index.html)
        if os.path.isdir(fs_path):
            fs_path = os.path.join(fs_path, "index.html")
        
        if not os.path.isfile(fs_path) or not fs_path.endswith('.html'):
            super().do_GET()
            return
        
        try:
            with open(fs_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Inject reload script
            if "</body>" in content:
                content = content.replace("</body>", f"{RELOAD_SCRIPT}</body>")
            else:
                content += RELOAD_SCRIPT
            
            encoded = content.encode('utf-8')
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)
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
