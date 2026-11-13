"""Render the 1200x630 link-preview card from the built page.

Run after build.py:  python3 tools/make_preview.py   (needs Chrome and Pillow)

Opens a copy of docs/index.html laid out as a card: the title and the opening
race's results on the left, the race map on the right. Writes docs/preview.png
and web/preview.png, and bumps the ?v= on the og:image link so chat apps fetch
the new image instead of a cached one. The publish workflow runs this on every
deploy, so the card follows changes to the page.
"""
import hashlib
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
CARD_W, CARD_H = 1200, 630
MAP_W = round(CARD_H * 713 / 581)  # the race map keeps its own shape, full height on the right
SIDE = CARD_W - MAP_W

# Goes in before the page's scripts, so the map is drawn at its card size.
STAGE_CSS = f"""<style>
html, body {{ overflow: hidden; }}
.masthead, .tool-head, .search, .collar, .results, .panel, .notes, #race-hint, #zoom-btn, #race-tip {{ display: none !important; }}
#race-wrap {{ position: fixed; left: {SIDE}px; top: 0; width: {MAP_W}px; height: {CARD_H}px; aspect-ratio: auto; border: 0; z-index: 5; }}
#card {{ position: fixed; left: 0; top: 0; width: {SIDE}px; height: {CARD_H}px; box-sizing: border-box; padding: 0 20px 0 44px;
  background: var(--paper); z-index: 6; display: flex; flex-direction: column; justify-content: center; }}
#card h1 {{ margin: 0; font: 700 92px/0.92 var(--font-display); letter-spacing: .01em; text-transform: uppercase; color: var(--ink); }}
#card .sub {{ margin: 18px 0 34px; font: 400 27px/1 var(--font-mono); color: var(--ink-2); }}
#card .row {{ display: flex; align-items: center; height: 62px; border-top: 1px solid var(--rule); }}
#card .row svg {{ width: 44px; height: 32px; flex: none; margin-right: 12px; }}
#card .row b {{ display: block; font: 600 25px/1.15 var(--font-body); color: var(--ink); }}
#card .row span {{ display: block; font: 400 19px/1.15 var(--font-body); color: var(--ink-2); white-space: nowrap; }}
</style>"""

# Goes in after the page's scripts: builds the left side from the page's own results list.
STAGE_JS = """<script>
(() => {
  const card = document.createElement("div");
  card.id = "card";
  card.innerHTML = "<h1>SF Hill<br>Climbers</h1><div class='sub'>" + document.querySelector(".subtitle").textContent + "</div>" +
    [...document.querySelectorAll("#scores .score")].map((li) => {
      const where = li.querySelector(".where"), ft = where.querySelector(".ft");
      return "<div class='row'>" + li.querySelector("svg").outerHTML + "<div><b>" + li.querySelector(".who b").textContent + "</b><span>" +
        where.childNodes[0].textContent.trim() + (ft ? ", " + ft.textContent : "") + "</span></div></div>";
    }).join("");
  document.body.appendChild(card);
})();
</script></body>"""


def chrome():
    for c in CHROMES:
        path = shutil.which(c) or (c if pathlib.Path(c).exists() else None)
        if path:
            return path
    sys.exit("make_preview: Chrome not found")


def main():
    exe = chrome()
    html = PAGE.read_text()
    marker = '<script type="application/json" id="terrain-data">'
    if marker not in html or "</body>" not in html:
        sys.exit("make_preview: the page layout has changed; update the markers in make_preview.py")
    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        staged = tmp / "card.html"
        staged.write_text(html.replace(marker, STAGE_CSS + marker, 1).replace("</body>", STAGE_JS, 1))
        shot = tmp / "shot.png"
        # Reduced motion makes the page draw the finished race straight away.
        subprocess.run([exe, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-sandbox", "--force-prefers-reduced-motion",
                        "--force-device-scale-factor=2", f"--window-size={CARD_W},{CARD_H}", f"--user-data-dir={tmp / 'profile'}",
                        "--virtual-time-budget=9000", f"--screenshot={shot}", staged.as_uri()],
                       capture_output=True, text=True, timeout=180)
        if not shot.exists():
            sys.exit("make_preview: Chrome did not produce a screenshot")
        card = Image.open(shot).convert("RGB").resize((CARD_W, CARD_H), Image.LANCZOS)

    for out in (ROOT / "docs" / "preview.png", ROOT / "web" / "preview.png"):
        card.save(out, optimize=True)
    version = hashlib.sha1((ROOT / "docs" / "preview.png").read_bytes()).hexdigest()[:8]
    PAGE.write_text(re.sub(r'preview\.png(\?v=[0-9a-f]+)?"', f'preview.png?v={version}"', html))
    print(f"wrote docs/preview.png and web/preview.png (v={version})")


if __name__ == "__main__":
    main()
