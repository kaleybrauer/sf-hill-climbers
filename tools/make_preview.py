"""Render the 1200x630 link-preview card from the built page.

Run after build.py:  python3 tools/make_preview.py   (needs Chrome and Pillow)

Screenshots docs/index.html once the opening race has run, puts the title block
next to the race map, writes docs/preview.png and web/preview.png, and bumps the
?v= on the og:image link so chat apps fetch the new image instead of a cached one.
The publish workflow runs this on every deploy, so the card follows wording edits.
"""
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "docs" / "index.html"
CHROMES = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
           "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]
WINDOW = "1200,1300"
CARD_W, CARD_H = 1200, 630

# Reports where the title block and the race map sit, via the page title.
PROBE = """<script>
setTimeout(() => {
  const r = (sel) => { const b = document.querySelector(sel).getBoundingClientRect();
    return [b.left, b.top + scrollY, b.right, b.bottom + scrollY].map(Math.round); };
  document.title = "RECTS " + JSON.stringify({ head: r(".masthead"), map: r("#race-wrap") });
}, 3000);
</script></body>"""


def chrome():
    for c in CHROMES:
        path = shutil.which(c) or (c if pathlib.Path(c).exists() else None)
        if path:
            return path
    sys.exit("make_preview: Chrome not found")


def run_chrome(exe, profile, *args):
    return subprocess.run([exe, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
                           f"--window-size={WINDOW}", f"--user-data-dir={profile}", *args],
                          capture_output=True, text=True, timeout=180).stdout


def main():
    exe = chrome()
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        probe = tmp / "probe.html"
        probe.write_text(PAGE.read_text().replace("</body>", PROBE, 1))
        dom = run_chrome(exe, tmp / "p1", "--virtual-time-budget=6000", "--dump-dom", probe.as_uri())
        m = re.search(r"<title>RECTS (.*?)</title>", dom)
        if not m:
            sys.exit("make_preview: could not locate the title block and map")
        rects = json.loads(m.group(1).replace("&quot;", '"'))
        shot = tmp / "shot.png"
        run_chrome(exe, tmp / "p2", "--virtual-time-budget=9000", f"--screenshot={shot}", PAGE.as_uri())
        im = Image.open(shot).convert("RGB")

    card = Image.new("RGB", (CARD_W, CARD_H), im.getpixel((5, 5)))
    x0, y0, x1, y1 = rects["head"]
    head = im.crop((x0 - 4, y0 - 4, x1 + 4, y1 + 4))
    head = head.resize((480, round(head.height * 480 / head.width)), Image.LANCZOS)
    card.paste(head, (44, max(40, (CARD_H - head.height) // 2 - 60)))
    x0, y0, x1, y1 = rects["map"]
    mp = im.crop((x0, y0, x1, y1))
    mp = mp.resize((626, round(mp.height * 626 / mp.width)), Image.LANCZOS)
    if mp.height > CARD_H - 40:
        mp = mp.crop((0, (mp.height - (CARD_H - 40)) // 2, 626, (mp.height + CARD_H - 40) // 2))
    card.paste(mp, (548, (CARD_H - mp.height) // 2))

    for out in (ROOT / "docs" / "preview.png", ROOT / "web" / "preview.png"):
        card.save(out, optimize=True)
    version = hashlib.sha1((ROOT / "docs" / "preview.png").read_bytes()).hexdigest()[:8]
    html = re.sub(r'preview\.png(\?v=[0-9a-f]+)?"', f'preview.png?v={version}"', PAGE.read_text())
    PAGE.write_text(html)
    print(f"wrote docs/preview.png and web/preview.png (v={version})")


if __name__ == "__main__":
    main()
