#!/usr/bin/env python3
"""Assemble the site's pages from src/layout.html + src/pages/*.html.

Each page file starts with a header comment:
    <!-- title: <i18n key> | canonical: <file> -->
Run from the repo root:  python3 tools/build.py [asset-version]
The asset version is appended as ?v= to CSS/JS so browsers drop old caches;
bump it whenever assets change.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
VERSION = sys.argv[1] if len(sys.argv) > 1 else "20261030f"
HEADER = re.compile(r"^<!-- title: (\S+) \| canonical: (\S*) -->\n")


def main():
    layout = (ROOT / "src" / "layout.html").read_text()
    for src in sorted((ROOT / "src" / "pages").glob("*.html")):
        text = src.read_text()
        m = HEADER.match(text)
        if not m:
            sys.exit(f"{src}: missing header comment")
        page = src.stem
        html = (layout
                .replace("{{TITLE_KEY}}", m.group(1))
                .replace("{{CANONICAL}}", m.group(2))
                .replace("{{PAGE}}", "home" if page == "index" else page)
                .replace("{{V}}", VERSION)
                .replace("{{CONTENT}}", text[m.end():]))
        (ROOT / src.name).write_text(html)
        print("built", src.name)


if __name__ == "__main__":
    main()
