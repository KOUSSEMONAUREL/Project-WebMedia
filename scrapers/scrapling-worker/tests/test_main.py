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
        self.assertIn("# 10. SteamRip", source, "SteamRip handler must exist")
        self.assertIn('if "steamrip.com" in url:', source, "SteamRip URL check must exist")

    def test_headers_not_conditional(self):
        with open(os.path.join(os.path.dirname(__file__), '..', 'src', 'main.py')) as f:
            source = f.read()
        self.assertNotIn("headers if site_name == 'steamrip.com' else {}", source,
                         "Headers should NOT be conditional on steamrip")
        self.assertIn("page = fetcher.get(search_url, headers=headers)", source,
                      "Headers should use 'headers' variable directly")

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
