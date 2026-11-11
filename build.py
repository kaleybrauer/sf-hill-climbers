"""Inline the stylesheet, terrain data, page text and scripts into one self-contained page.

Run:  python3 build.py   ->  docs/ (the GitHub Pages site) and dist/sf-hill-climbers.html

The words on the page live in web/text.md; see the note at the top of that file.
"""
import hashlib
import html
import json
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent
WEB = ROOT / "web"
SITE_URL = "https://www.kaleybrauer.com/sf-hill-climbers/"  # public copy (GitHub Pages, custom domain)


def inline(text):
    """One paragraph of text.md as HTML: escaped, with [links](https://...), **bold**, *italic* and no breaks in "η 256"."""
    out = html.escape(" ".join(text.split()), quote=False)
    out = re.sub(r"\[([^\]]+)\]\((https?://[^\s)]+)\)", r'<a href="\2">\1</a>', out)
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"\*(.+?)\*", r"<em>\1</em>", out)
    return re.sub(r"(η|β|σ|T₀) (?=\d)", "\\1\u00a0", out)


def read_text():
    """Blocks of web/text.md: {key: {"title": ..., "paras": [html, ...]}}."""
    blocks, cur = {}, None
    for line in (WEB / "text.md").read_text().splitlines():
        if line.startswith("## "):
            key, _, title = line[3:].partition(":")
            key = " ".join(key.split())
            if key in blocks:
                sys.exit(f"text.md: the block '## {key}' appears twice")
            cur = blocks[key] = {"title": title.strip(), "lines": []}
        elif cur is not None:
            cur["lines"].append(line)
    for b in blocks.values():
        paras = re.split(r"\n\s*\n", "\n".join(b.pop("lines")).strip())
        b["paras"] = [inline(p) for p in paras if p.strip()]
    return blocks


def fill_text(page, blocks):
    """Put text.md into the page, and check that every block is used and none is missing."""
    used = set()

    def block(key):
        if key not in blocks:
            sys.exit(f"text.md: no block named '## {key}' (the page needs it)")
        used.add(key)
        return blocks[key]

    def one(key):
        paras = block(key)["paras"]
        if len(paras) != 1:
            sys.exit(f"text.md: '## {key}' should be a single paragraph, found {len(paras)}")
        return paras[0]

    def sub(m):
        kind, key = m.group(1), m.group(2)
        if kind == "p":
            return "\n".join(f"<p>{p}</p>" for p in block(key)["paras"])
        if kind == "line":
            return one(key)
        if kind == "title":
            return html.escape(block(key)["title"], quote=False)
        return html.escape(re.sub(r"<[^>]+>", "", one(key)))  # attr

    page = re.sub(r"\{\{(p|line|title|attr):([^}]+)\}\}", sub, page)

    # Cards and climber descriptions are drawn by app.js, keyed by id.
    app, core = (WEB / "src" / "app.js").read_text(), (WEB / "src" / "core.js").read_text()
    tries = app[app.index("const TRIES = ["):app.index("];", app.index("const TRIES = ["))]
    card_ids = re.findall(r'\{ id: "([\w-]+)"', tries)
    opt_keys = re.findall(r"^    (\w+): \{\n      label:", core, re.M)
    templates = re.findall(r'tpl\("([^"]+)"', app)
    data = {
        "cards": {i: {"title": html.escape(block(f"card {i}")["title"], quote=False), "html": " ".join(block(f"card {i}")["paras"])} for i in card_ids},
        "climbers": {k: {"tag": html.escape(block(f"climber {k}")["title"], quote=False), "html": " ".join(block(f"climber {k}")["paras"])} for k in opt_keys},
        "templates": {t: block(f"template {t}")["paras"] for t in templates},
    }
    unused = sorted(set(blocks) - used)
    if unused:
        sys.exit("text.md: these blocks aren't used anywhere (check the name before the colon): " + ", ".join(unused))
    return page.replace("{{TEXT}}", json.dumps(data, ensure_ascii=False).replace("</", "<\\/")), blocks


def main():
    blocks = read_text()
    page, _ = fill_text((WEB / "index.html").read_text(), blocks)
    parts = {
        "/*{{CSS}}*/": (WEB / "src" / "style.css").read_text(),
        "{{TERRAIN}}": (WEB / "data" / "terrain.json").read_text().replace("</", "<\\/"),
        "/*{{CORE}}*/": (WEB / "src" / "core.js").read_text(),
        "/*{{GEOCODE}}*/": (WEB / "src" / "geocode.js").read_text(),
        "/*{{APP}}*/": (WEB / "src" / "app.js").read_text(),
    }
    for key, value in parts.items():
        assert page.count(key) == 1, key
        page = page.replace(key, value)
    out = ROOT / "dist" / "sf-hill-climbers.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(page)
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1e6:.2f} MB)")

    # A standalone copy for ordinary web hosting: the artifact viewer normally
    # supplies the document shell and this small reset.
    head, body = page.split('<div class="page">', 1)
    # ?v= changes with the image, so chat apps fetch a new preview instead of a cached one.
    version = hashlib.sha1((WEB / "preview.png").read_bytes()).hexdigest()[:8]
    site = (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta property="og:title" content="SF Hill Climbers">\n'
        f'<meta property="og:url" content="{SITE_URL}">\n'
        f'<meta property="og:image" content="{SITE_URL}preview.png?v={version}">\n'
        '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'
        '<meta name="twitter:card" content="summary_large_image">\n'
        f'<meta property="og:description" content="{html.escape(re.sub(r"<[^>]+>", "", blocks["link preview"]["paras"][0]))}">\n'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
        'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n'
        + head.strip() + '\n</head>\n<body>\n<div class="page">' + body + '\n</body>\n</html>\n'
    )
    standalone = ROOT / "docs" / "index.html"
    standalone.parent.mkdir(exist_ok=True)
    standalone.write_text(site)
    shutil.copyfile(WEB / "preview.png", standalone.parent / "preview.png")  # link-preview image
    print(f"wrote {standalone.relative_to(ROOT)} ({standalone.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
