"""
analytics/gtm.py

Detects Google Tag Manager: the head <script> loader
(googletagmanager.com/gtm.js?id=GTM-XXXXXXX) and the recommended
<noscript><iframe ...ns.html?id=GTM-XXXXXXX> fallback that's supposed
to sit right after <body>. GTM's own install instructions ask for
both — the script for JS-enabled visitors, the noscript iframe so
tags requiring it can still fire (and so the container is at least
countable) for visitors without JS. Sites frequently paste only the
first block and drop the second.

Reads crawler.parser.ParsedPage.soup directly, same rationale as the
other analytics/* modules.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List, Optional

from crawler.parser import ParsedPage

MODULE = "analytics"
CATEGORY = "gtm"

GTM_SCRIPT_RE = re.compile(r"googletagmanager\.com/gtm\.js\?id=(GTM-[A-Z0-9]+)", re.IGNORECASE)
GTM_NOSCRIPT_RE = re.compile(r"googletagmanager\.com/ns\.html\?id=(GTM-[A-Z0-9]+)", re.IGNORECASE)


@dataclass
class GTMDetection:
    detected: bool = False
    container_ids: List[str] = field(default_factory=list)
    script_tag_count: int = 0
    has_noscript_fallback: bool = False


def detect_gtm(page: ParsedPage) -> GTMDetection:
    """Scans this page's <script> and <noscript> tags for GTM containers."""
    result = GTMDetection()
    ids: List[str] = []

    for tag in page.soup.find_all("script"):
        src = tag.get("src") or ""
        match = GTM_SCRIPT_RE.search(src)
        if match:
            result.script_tag_count += 1
            ids.append(match.group(1))

    for tag in page.soup.find_all("noscript"):
        text = str(tag)
        match = GTM_NOSCRIPT_RE.search(text)
        if match:
            result.has_noscript_fallback = True
            ids.append(match.group(1))

    result.container_ids = list(dict.fromkeys(ids))
    result.detected = bool(result.container_ids) or result.script_tag_count > 0
    return result


def check_gtm(page: ParsedPage) -> List[dict]:
    """Findings for GTM install issues on this page. Absence of GTM is not itself a finding."""
    detection = detect_gtm(page)
    findings: List[dict] = []

    if detection.script_tag_count > 0 and not detection.has_noscript_fallback:
        findings.append(_finding(
            "warning",
            "GTM noscript fallback is missing",
            f"{page.url} loads the GTM script but has no matching "
            "<noscript><iframe src=\"...ns.html?id=GTM-...\"> fallback right after "
            "<body>. Visitors with JavaScript disabled or blocked get no container "
            "at all.",
            recommendation="Add the noscript iframe fallback Google Tag Manager's "
                            "install snippet provides alongside the script block.",
        ))

    if detection.has_noscript_fallback and detection.script_tag_count == 0:
        findings.append(_finding(
            "info",
            "GTM noscript fallback present without the script loader",
            f"{page.url} has the GTM noscript iframe but no gtm.js <script> loader "
            "was found — the container will only ever fire the noscript fallback, "
            "never the full JS-driven tag set.",
            recommendation="Confirm the GTM head script snippet is present on this "
                            "page alongside the noscript fallback.",
        ))

    if len(detection.container_ids) > 1:
        shown = ", ".join(detection.container_ids[:5])
        findings.append(_finding(
            "info",
            "Multiple GTM containers detected on one page",
            f"{page.url} loads more than one GTM container: {shown}. This is "
            "sometimes intentional (e.g. a shared corporate container plus a "
            "site-specific one) but doubles tag-firing overhead if not.",
            recommendation="Confirm every container listed is meant to be here.",
        ))

    return findings


def _finding(severity: str, title: str, description: str, recommendation: Optional[str] = None) -> dict:
    return {
        "module": MODULE,
        "category": CATEGORY,
        "severity": severity,
        "title": title,
        "description": description,
        "recommendation": recommendation,
    }
