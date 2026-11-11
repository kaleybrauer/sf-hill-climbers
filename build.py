"""Inline the stylesheet, terrain data and scripts into one self-contained page.

Run:  python3 build.py   ->  dist/sf-hill-climbers.html
"""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
WEB = ROOT / "web"


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


if __name__ == "__main__":
    main()
