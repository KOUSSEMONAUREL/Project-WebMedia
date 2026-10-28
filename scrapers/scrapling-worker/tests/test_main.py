"""
Tests for scrapling-worker main.py fixes
"""
import os
import unittest

class TestMainModule(unittest.TestCase):

    def test_steamrip_in_source(self):
        with open(os.path.join(os.path.dirname(__file__), '..', 'src', 'main.py')) as f:
            source = f.read()
        self.assertIn("steamrip.com", source, "SteamRip must be in source")

    def test_steamrip_handler_exists(self):
        with open(os.path.join(os.path.dirname(__file__), '..', 'src', 'main.py')) as f:
            source = f.read()
        self.assertIn('if "steamrip.com" in url:', source, "SteamRip URL check must exist")

    def test_headers_not_conditional(self):
        with open(os.path.join(os.path.dirname(__file__), '..', 'src', 'main.py')) as f:
            source = f.read()
        self.assertNotIn("headers if site_name == 'steamrip.com' else {}", source,
                         "Headers should NOT be conditional on steamrip")
        self.assertIn('"headers": {"User-Agent": DEFAULT_UA}', source,
                      "Headers should use the shared User-Agent")
        self.assertIn("return Fetcher.get(url, **kwargs)", source,
                      "Fetcher should receive the shared request options")

    def test_gamedrive_uses_search_path(self):
        src = os.path.join(os.path.dirname(__file__), '..', 'src')
        for name in ('main.py', 'scraper_verify.py'):
            with open(os.path.join(src, name)) as f:
                source = f.read()
            self.assertIn('("gamedrive.org", "https://gamedrive.org/search/")', source)
            self.assertNotIn('("gamedrive.org", "https://gamedrive.org/?s=")', source)

    def test_all_game_sources_present(self):
        with open(os.path.join(os.path.dirname(__file__), '..', 'src', 'main.py')) as f:
            source = f.read()
        expected = [
            "steamunlocked.org",
            "fitgirl-repacks.site",
            "gamedrive.org",
            "elamigos.site",
            "romspure.cc",
            "cfinder.xyz",
            "emulatorgamesx.net",
            "romsfun.com",
            "games4u.org",
            "steamrip.com",
        ]
        for site in expected:
            with self.subTest(site=site):
                self.assertIn(site, source, f"{site} must be in GAME_SOURCES")


if __name__ == '__main__':
    unittest.main()
