import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from title_match import match_title, pick, strip_edition, search_query

# (wanted, candidate, attendu)
CAS = [
    # --- les bugs reellement observes en prod ---
    ("Gwent: Iron Judgment", "Ben 10", None),
    ("Chrono Trigger", "Cris Tales", None),
    ("Chrono Trigger", "DELTARUNE: Game + Soundtrack Bundle, v14 (Chapters 1-4)", None),
    ("Chrono Trigger", "LIVE A LIVE \u2013 Build 10717762 (Denuvoless) + Bonus Wallpapers", None),

    # --- correspondance exacte ---
    ("Chrono Trigger", "CHRONO TRIGGER", "exact"),
    ("Gwent: Iron Judgment", "Gwent: Iron Judgment", "exact"),

    # --- bruit de site tolere (c'est le cas reel de FitGirl) ---
    ("Baldur's Gate 3: Digital Deluxe Edition",
     "Baldur's Gate 3 - Free Download [FitGirl Repack]", "exact"),
    ("Devil May Cry 5: Devil Hunter Edition", "Devil May Cry 5 v1.2", "exact"),
    ("The Witcher 3: Wild Hunt - Game of the Year Edition",
     "The Witcher 3: Wild Hunt \u2013 Game of the Year Edition [FitGirl]", "exact"),
    ("Diablo II: Resurrected \u2013 Infernal Edition", "Diablo II Resurrected", "exact"),

    # --- les chiffres doivent matcher : la regle non negociable ---
    ("Baldur's Gate 3", "Baldur's Gate", None),
    ("Baldur's Gate", "Baldur's Gate 3", None),
    ("Resident Evil 4", "Resident Evil", None),
    ("The Climb 2", "The Climb", None),

    # --- edition vs jeu de base : rejette, sauf alias explicite ---
    ("Terraria: Calamity Mod", "Terraria", None),
    ("Terraria: Calamity Mod", "Terraria", "alias"),   # via alias ["Terraria"]

    # --- subtile : un chiffre en trop dans le candidat ---
    ("Portal", "Portal 2", None),

    # --- ordinaux / romans convertis ---
    ("Devil May Cry II", "Devil May Cry 2", "exact"),
]

def run():
    echecs = 0
    for wanted, cand, attendu in CAS:
        alias = ["Terraria"] if "alias" in (attendu or "") else None
        note = " (alias)" if alias else ""
        got = match_title(wanted, cand, alias)
        si_alias_attendu = attendu == "alias"
        ok = (got == "alias") if si_alias_attendu else (got == (attendu if attendu != "alias" else None))
        if not ok:
            echecs += 1
        print(f"{'OK  ' if ok else 'ECHEC'} {wanted[:34]:34} | {cand[:44]:44} -> {got}{note}")

    print("\n--- search_query / strip_edition ---")
    for t in ["Baldur's Gate 3: Digital Deluxe Edition",
              "The Witcher 3: Wild Hunt - Game of the Year Edition",
              "Gwent: Iron Judgment", "Chrono Trigger"]:
        print(f"  {t[:44]:44} -> {search_query(t)!r}")

    print("\n--- pick : filtrer AVANT de limiter ---")
    entries = [
        {"url": "https://x/ben-10", "title": "Ben 10"},
        {"url": "https://x/gw1", "title": "Gwent: Iron Judgment [GOG]"},
        {"url": "https://x/gw2", "title": "Gwent: Iron Judgment - Soundtrack"},
        {"url": "https://x/other", "title": "Gwent: The Witcher Card Game"},
    ]
    got = pick(entries, "Gwent: Iron Judgment")
    print("  retenus:", [e["url"] for e in got])
    attendu = ["https://x/gw1", "https://x/gw2"]
    if [e["url"] for e in got] != attendu:
        echecs += 1
        print("  ECHEC: attendu", attendu)
    else:
        print("  OK: les 2 faux positifs sont elimines, filtrage avant limite")

    print("\n" + ("TOUS LES TESTS PASSENT" if echecs == 0 else f"{echecs} ECHEC(S)"))
    return echecs

if __name__ == "__main__":
    sys.exit(1 if run() else 0)