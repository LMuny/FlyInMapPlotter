#!/usr/bin/env python3
"""Bundle the app into fly-in-map-plotter.html, a single file that runs anywhere."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "fly-in-map-plotter.html"


def inline(html: str, tag: str, path: str, wrapper: str) -> str:
    if tag not in html:
        raise SystemExit(f"index.html no longer contains: {tag}")
    content = (ROOT / path).read_text(encoding="utf-8")
    if f"</{wrapper}" in content:
        raise SystemExit(f"{path} contains </{wrapper}, which would end the block early")
    return html.replace(tag, f"<{wrapper}>\n{content}</{wrapper}>")


def main() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    html = inline(html, '<link rel="stylesheet" href="css/style.css">', "css/style.css", "style")
    html = inline(html, '<script src="js/core.js"></script>', "js/core.js", "script")
    html = inline(html, '<script src="js/app.js"></script>', "js/app.js", "script")
    OUTPUT.write_text(html, encoding="utf-8")
    print(f"Built {OUTPUT.name} ({OUTPUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
