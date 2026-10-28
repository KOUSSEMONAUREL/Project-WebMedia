#!/usr/bin/env python3
"""Fusion des verdicts du gate deterministe et de la revue IA.

Le gate reste la couche de securite: un FAIL deterministe ne peut jamais
etre transforme en PASS par un modele. La revue IA peut confirmer un PASS,
refuser un PASS, ou debloquer un HOLD uniquement avec une preuve explicite:
live verifie avec des preuves non vides pour un scraper dont le gate a
identifie l'extension, ou registre valide pour une PR registre. Une revue IA
absente fait retomber le pipeline sur le gate; une revue presente mais
invalide ne peut jamais transformer un PASS du gate en merge automatique.
"""

import json
import re

VERDICTS = ("PASS", "FAIL", "HOLD")
GATE_VERSION = 1
AI_REVIEW_VERSION = 1
MAX_REASON = 4000
HEAD_RE = re.compile(r"^[0-9a-fA-F]{40,64}$")


def load_json(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def _is_int(value):
    return type(value) is int


def _valid_number(value):
    return _is_int(value) and value > 0


def _valid_head(value):
    return isinstance(value, str) and HEAD_RE.fullmatch(value) is not None


def _entry_map(review, version_key, version):
    """Retourne (entries, errors, bad_numbers) sans coerction de type."""
    errors = []
    bad_numbers = set()
    if not isinstance(review, dict):
        return {}, [f"{version_key}: revue absente ou JSON non-objet"], bad_numbers
    if not _is_int(review.get(version_key)) or review.get(version_key) != version:
        return {}, [
            f"{version_key}={review.get(version_key)!r}, attendu {version}"
        ], bad_numbers
    raw = review.get("prs")
    if not isinstance(raw, list):
        return {}, [f"{version_key}: prs n'est pas une liste"], bad_numbers

    entries = {}
    for index, entry in enumerate(raw):
        if not isinstance(entry, dict):
            errors.append(f"prs[{index}] n'est pas un objet")
            continue
        number = entry.get("number")
        if not _valid_number(number):
            errors.append(
                f"prs[{index}].number doit etre un entier positif, "
                f"recu {number!r}"
            )
            continue
        if number in entries:
            errors.append(f"PR #{number}: verdict duplique")
            bad_numbers.add(number)
            continue
        entries[number] = entry
    return entries, errors, bad_numbers


def gate_entries(gate):
    return _entry_map(gate, "gate_version", GATE_VERSION)[0]


def ai_entries(ai):
    return _entry_map(ai, "review_version", AI_REVIEW_VERSION)[0]


def normalize_numbers(numbers):
    normalized = set()
    for number in numbers:
        if _valid_number(number):
            normalized.add(number)
    return normalized


def validate_ai_entry(ai_entry, gate_entry, number):
    errors = []
    if not isinstance(ai_entry, dict):
        return [f"PR #{number}: verdict IA n'est pas un objet"]
    if not isinstance(gate_entry, dict):
        return [f"PR #{number}: aucun verdict du gate"]

    verdict = ai_entry.get("verdict")
    if verdict not in VERDICTS:
        errors.append(f"PR #{number}: verdict IA inconnu {verdict!r}")

    gate_verdict = gate_entry.get("verdict")
    if gate_verdict not in VERDICTS:
        errors.append(f"PR #{number}: verdict du gate inconnu {gate_verdict!r}")
        return errors

    if ai_entry.get("gate_verdict") != gate_verdict:
        errors.append(
            f"PR #{number}: gate_verdict={ai_entry.get('gate_verdict')!r}, "
            f"gate reel={gate_verdict!r}"
        )

    gate_head = gate_entry.get("head_sha")
    ai_head = ai_entry.get("head_sha")
    if not _valid_head(gate_head):
        errors.append(f"PR #{number}: head_sha du gate invalide")
    if not _valid_head(ai_head):
        errors.append(f"PR #{number}: head_sha IA invalide")
    elif (
        isinstance(ai_head, str)
        and isinstance(gate_head, str)
        and _valid_head(gate_head)
        and ai_head != gate_head
    ):
        errors.append(
            f"PR #{number}: head_sha IA {ai_head[:12]} != gate {gate_head[:12]}"
        )

    reason = ai_entry.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        errors.append(f"PR #{number}: reason IA vide ou non textuelle")
    elif len(reason) > MAX_REASON:
        errors.append(
            f"PR #{number}: reason IA trop longue ({len(reason)} > {MAX_REASON})"
        )

    for key in ("live_verified", "registry_ok"):
        if key in ai_entry and type(ai_entry[key]) is not bool:
            errors.append(f"PR #{number}: {key} doit etre un booleen")
    if "live_evidence" in ai_entry and not isinstance(
        ai_entry.get("live_evidence"), str
    ):
        errors.append(f"PR #{number}: live_evidence doit etre un texte")

    if gate_verdict == "FAIL" and verdict != "FAIL":
        errors.append(
            f"PR #{number}: le gate FAIL ne peut pas devenir {verdict}"
        )

    if gate_verdict == "HOLD" and verdict == "PASS":
        checks = gate_entry.get("checks")
        checks = checks if isinstance(checks, dict) else {}
        kind = checks.get("kind")
        if kind == "registry":
            if not (
                checks.get("registry_ok") is True
                and ai_entry.get("registry_ok") is True
            ):
                errors.append(
                    f"PR #{number}: HOLD registre debloque sans "
                    "checks.registry_ok + registry_ok"
                )
        elif kind == "code":
            exts = checks.get("exts")
            if (
                not isinstance(exts, list)
                or not exts
                or not all(isinstance(ext, str) and ext for ext in exts)
            ):
                errors.append(
                    f"PR #{number}: HOLD code debloque sans extension de "
                    "scraper identifiee par le gate"
                )
            evidence = ai_entry.get("live_evidence")
            if not (
                ai_entry.get("live_verified") is True
                and isinstance(evidence, str)
                and evidence.strip()
            ):
                errors.append(
                    f"PR #{number}: HOLD code debloque sans live_verified "
                    "et live_evidence non vide"
                )
        else:
            errors.append(
                f"PR #{number}: HOLD debloque avec un kind de gate inconnu"
            )

    return errors


def validate_ai_review(ai, gate, numbers):
    errors = []
    gate_map, gate_errors, gate_bad = _entry_map(
        gate, "gate_version", GATE_VERSION
    )
    ai_map, ai_errors, ai_bad = _entry_map(
        ai, "review_version", AI_REVIEW_VERSION
    )
    errors.extend(gate_errors)
    errors.extend(ai_errors)

    expected = normalize_numbers(numbers)
    if not expected:
        errors.append("aucune PR a reviewer")

    missing = sorted(expected - set(ai_map))
    extra = sorted(set(ai_map) - expected)
    if missing:
        errors.append("PRs sans verdict IA: "
                      + ", ".join(f"#{n}" for n in missing))
    if extra:
        errors.append("verdicts IA pour des PRs hors liste: "
                      + ", ".join(f"#{n}" for n in extra))
    if gate_bad:
        errors.append("verdicts du gate dupliques: "
                      + ", ".join(f"#{n}" for n in sorted(gate_bad)))
    if ai_bad:
        errors.append("verdicts IA dupliques: "
                      + ", ".join(f"#{n}" for n in sorted(ai_bad)))

    for number in sorted(expected):
        gate_entry = gate_map.get(number)
        ai_entry = ai_map.get(number)
        if not isinstance(gate_entry, dict) or number in gate_bad:
            errors.append(f"PR #{number}: aucun verdict du gate valide")
            continue
        if not isinstance(ai_entry, dict) or number in ai_bad:
            if number not in ai_map:
                errors.append(f"PR #{number}: aucun verdict IA valide")
            continue
        errors.extend(validate_ai_entry(ai_entry, gate_entry, number))

    return errors


def _synthetic_hold(gate_entry, number, detail):
    reason = f"Revue IA absente ou invalide pour un PASS du gate: {detail}"
    return {
        "number": number,
        "verdict": "HOLD",
        "gate_verdict": gate_entry.get("verdict"),
        "head_sha": gate_entry.get("head_sha", ""),
        "reason": reason[:MAX_REASON],
        "live_verified": False,
        "live_evidence": "",
        "registry_ok": False,
    }


def _fallback_entry(gate_entry, number, detail):
    gate_verdict = gate_entry.get("verdict")
    if gate_verdict in ("FAIL", "HOLD"):
        return gate_entry
    return _synthetic_hold(gate_entry, number, detail)


def _safe_selection(gate_map, gate_bad, expected, detail):
    selected = {}
    for number in sorted(expected):
        gate_entry = gate_map.get(number)
        if not isinstance(gate_entry, dict) or number in gate_bad:
            continue
        if gate_entry.get("verdict") not in VERDICTS:
            continue
        selected[number] = _fallback_entry(gate_entry, number, detail)
    return selected


def effective_review(gate, ai, numbers, ai_present=False):
    """Fusionne les deux couches avec un fallback sur par PR.

    - IA absente: le gate decide, comportement historique.
    - IA presente mais globalement invalide: FAIL/HOLD du gate conserves,
      PASS du gate bloques en HOLD.
    - IA partielle ou invalide sur une PR: cette PR suit le meme fallback,
      les autres verdicts IA valides sont conserves.
    - Erreur structurelle (version, entree non-objet, numero invalide):
      toute la revue IA est invalidee et le fallback s'applique.
    """
    expected = normalize_numbers(numbers)
    gate_map, gate_errors, gate_bad = _entry_map(
        gate, "gate_version", GATE_VERSION
    )
    errors = list(gate_errors)

    if not expected:
        errors.append("aucune PR a reviewer")
        return {}, "gate", errors

    if gate_errors:
        return (
            _safe_selection(
                gate_map, gate_bad, expected, "gate structurellement invalide"
            ),
            "fallback",
            errors,
        )

    if ai is None:
        if not ai_present:
            selected = {
                n: gate_map[n] for n in expected
                if n in gate_map and n not in gate_bad
            }
            return selected, "gate", errors
        detail = "revue IA presente mais illisible"
        errors.append(detail)
        return (
            _safe_selection(gate_map, gate_bad, expected, detail),
            "fallback",
            errors,
        )

    ai_map, ai_errors, ai_bad = _entry_map(
        ai, "review_version", AI_REVIEW_VERSION
    )
    errors.extend(ai_errors)

    global_invalid = (
        not isinstance(ai, dict)
        or not _is_int(ai.get("review_version"))
        or ai.get("review_version") != AI_REVIEW_VERSION
        or not isinstance(ai.get("prs"), list)
    )
    if global_invalid:
        return (
            _safe_selection(
                gate_map, gate_bad, expected, "revue IA globalement invalide"
            ),
            "fallback",
            errors,
        )

    if ai_errors:
        return (
            _safe_selection(
                gate_map, gate_bad, expected, "revue IA structurellement invalide"
            ),
            "fallback",
            errors,
        )

    extra = sorted(set(ai_map) - expected)
    if extra:
        errors.append(
            "verdicts IA hors liste: "
            + ", ".join(f"#{n}" for n in extra)
        )
        return (
            _safe_selection(
                gate_map, gate_bad, expected, "verdicts IA hors liste"
            ),
            "fallback",
            errors,
        )

    selected = {}
    ai_used = 0
    fallback_used = 0
    for number in sorted(expected):
        gate_entry = gate_map.get(number)
        if not isinstance(gate_entry, dict) or number in gate_bad:
            errors.append(f"PR #{number}: aucun verdict du gate valide")
            continue
        if gate_entry.get("verdict") not in VERDICTS:
            errors.append(f"PR #{number}: verdict du gate inconnu")
            continue

        if number in ai_bad:
            detail = "verdict IA duplique"
            errors.append(f"PR #{number}: {detail}")
            selected[number] = _fallback_entry(gate_entry, number, detail)
            fallback_used += 1
            continue

        ai_entry = ai_map.get(number)
        if not isinstance(ai_entry, dict):
            detail = "verdict IA absent"
            errors.append(f"PR #{number}: {detail}")
            selected[number] = _fallback_entry(gate_entry, number, detail)
            fallback_used += 1
            continue

        entry_errors = validate_ai_entry(ai_entry, gate_entry, number)
        if entry_errors:
            errors.extend(entry_errors)
            selected[number] = _fallback_entry(
                gate_entry, number, "; ".join(entry_errors)
            )
            fallback_used += 1
            continue

        selected[number] = ai_entry
        ai_used += 1

    if ai_used and fallback_used:
        source = "mixed"
    elif ai_used:
        source = "ai"
    else:
        source = "fallback"
    return selected, source, errors
