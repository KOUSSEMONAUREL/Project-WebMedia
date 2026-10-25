import pathlib
import re
from urllib.parse import urlparse

ROOT = pathlib.Path("scrapers/webtoons/definitions/webtoons")
PAT = re.compile(r"baseUrl\s*=\s*['\"]([^'\"]+)['\"]")

seen = {}
for path in ROOT.rglob("*.ts"):
    text = path.read_text(errors="ignore")
    match = PAT.search(text)
    if not match:
        continue
    raw = match.group(1).strip()
    if not raw.startswith("http"):
        continue
    parsed = urlparse(raw)
    if not parsed.netloc or "localhost" in parsed.netloc or "127.0.0.1" in parsed.netloc:
        continue
    seen.setdefault(parsed.netloc.lower(), f"{parsed.scheme}://{parsed.netloc}")

EXTRA = [
    "https://globalcomix.com",
    "https://inkrush.site",
    "https://lunarx.to",
    "https://mangadot.net",
    "https://mangaomega.com",
    "https://nhentai.com",
    "https://hentairead.com",
    "https://mahouirexnohentaikarte.com",
    "https://mangalix.com",
    "https://oriyami.com",
    "https://rubycomics.net",
    "https://www.voyce.me",
    "https://webtoonclub.com",
    "https://kiutaku.com",
    "https://baobua.net",
    "https://mangafire.to",
]
for raw in EXTRA:
    parsed = urlparse(raw)
    seen.setdefault(parsed.netloc.lower(), f"{parsed.scheme}://{parsed.netloc}")

for host in sorted(seen):
    print(seen[host])
