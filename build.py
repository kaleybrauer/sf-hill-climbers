"""Inline the stylesheet, terrain data and scripts into one self-contained page.

Run:  python3 build.py   ->  dist/sf-hill-climbers.html
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
WEB = ROOT / "web"
SITE_URL = "https://www.kaleybrauer.com/sf-hill-climbers/"  # public copy (GitHub Pages, custom domain)


def main():
    page = (WEB / "index.html").read_text()
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
    site = (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<meta property="og:title" content="SF Hill Climbers">\n'
        f'<meta property="og:url" content="{SITE_URL}">\n'
        f'<meta property="og:image" content="{SITE_URL}preview.png">\n'
        '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'
        '<meta name="twitter:card" content="summary_large_image">\n'
        '<meta property="og:description" content="Gradient descent, Momentum, Adam and Muon race uphill across '
        'San Francisco. Type your address and see which hill each optimizer reaches.">\n'
        '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
        'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>\n'
        + head.strip() + '\n</head>\n<body>\n<div class="page">' + body + '\n</body>\n</html>\n'
    )
    standalone = ROOT / "site" / "index.html"
    standalone.parent.mkdir(exist_ok=True)
    standalone.write_text(site)
    print(f"wrote {standalone.relative_to(ROOT)} ({standalone.stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
