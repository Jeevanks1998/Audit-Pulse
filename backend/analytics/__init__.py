"""
analytics/

A dedicated, granular analytics/tag-detection package — one file per
tracker — that gives services.audit_service.run_audit_pipeline
something real to write into models.analytics.Analytics instead of its
current `_write_analytics_result` placeholder (random score, hardcoded
"GTM-XXXXXXX" / "G-XXXXXXXXXX" strings). Every check function returns
findings in the same {module, category, severity, title, description,
recommendation} shape services.audit_service / models.issue already
persist, so nothing downstream (Issue sync, report.html, history)
needs to change to consume them — same contract as seo/ and
accessibility/.

Every check here is page-level and synchronous: everything a tracker
needs is either a <script src="...">, an inline <script> body, or a
<noscript> fallback, all of which are already sitting in
crawler.parser.ParsedPage.soup with no extra network calls required.
That's a deliberate difference from seo/ and accessibility/, which
both also have async site-level or live-render checks.

    ga4, gtm, adobe, piano, clarity, hotjar, meta_pixel, linkedin, tiktok
        — one detector each, all following the same shape:
          detect_x(page) -> XDetection (pure data, no findings)
          check_x(page) -> List[dict] (findings built from detect_x)

    data_layer  — dataLayer init/push activity, independent of which
                  tag manager (if any) owns it

    duplicate_tags — cross-tracker pass over every detector's result
                     looking for a loader included twice or more than
                     one ID configured for the same tracker

    analytics_score — turns any list of these findings into a weighted
                       0-100 score (score_analytics), and separately
                       maps the raw detections onto
                       models.analytics.Analytics's columns
                       (build_analytics_summary)

Usage — wiring this into the real pipeline (crawler.crawler.Crawler
already produces a ParsedPage per page; this replaces
_write_analytics_result's random placeholder, it doesn't replace the
whole crawl):

    from analytics import run_page_checks, analyze_page

    findings = run_page_checks(page)               # just the findings
    result = analyze_page(page)                     # findings + score + Analytics-ready summary
    analytics_row = Analytics(audit_id=audit.id, **vars(result.summary))
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List

from crawler.parser import ParsedPage

from analytics.adobe import AdobeDetection, check_adobe, detect_adobe
from analytics.analytics_score import (
    AnalyticsScoreResult,
    AnalyticsSummary,
    build_analytics_summary,
    score_analytics,
)
from analytics.clarity import ClarityDetection, check_clarity, detect_clarity
from analytics.data_layer import DataLayerDetection, check_data_layer, detect_data_layer
from analytics.duplicate_tags import TrackerLoad, check_duplicate_tags
from analytics.ga4 import GA4Detection, check_ga4, detect_ga4
from analytics.gtm import GTMDetection, check_gtm, detect_gtm
from analytics.hotjar import HotjarDetection, check_hotjar, detect_hotjar
from analytics.linkedin import LinkedInDetection, check_linkedin, detect_linkedin
from analytics.meta_pixel import MetaPixelDetection, check_meta_pixel, detect_meta_pixel
from analytics.piano import PianoDetection, check_piano, detect_piano
from analytics.tiktok import TikTokDetection, check_tiktok, detect_tiktok

__all__ = [
    "check_ga4", "check_gtm", "check_adobe", "check_piano", "check_clarity",
    "check_hotjar", "check_meta_pixel", "check_linkedin", "check_tiktok",
    "check_data_layer", "check_duplicate_tags",
    "detect_ga4", "detect_gtm", "detect_adobe", "detect_piano", "detect_clarity",
    "detect_hotjar", "detect_meta_pixel", "detect_linkedin", "detect_tiktok",
    "detect_data_layer",
    "GA4Detection", "GTMDetection", "AdobeDetection", "PianoDetection",
    "ClarityDetection", "HotjarDetection", "MetaPixelDetection", "LinkedInDetection",
    "TikTokDetection", "DataLayerDetection", "TrackerLoad",
    "score_analytics", "AnalyticsScoreResult", "AnalyticsSummary", "build_analytics_summary",
    "run_page_checks", "analyze_page", "AnalyticsAuditResult",
]


def run_page_checks(page: ParsedPage) -> List[dict]:
    """
    Every check in this package, run once for one already-fetched,
    already-parsed page. Cheap and synchronous, same as
    seo.run_page_checks / accessibility.run_page_checks.
    """
    ga4 = detect_ga4(page)
    gtm = detect_gtm(page)
    adobe = detect_adobe(page)
    piano = detect_piano(page)
    clarity = detect_clarity(page)
    hotjar = detect_hotjar(page)
    meta_pixel = detect_meta_pixel(page)
    linkedin = detect_linkedin(page)
    tiktok = detect_tiktok(page)
    data_layer = detect_data_layer(page)

    findings: List[dict] = []
    findings += check_ga4(page)
    findings += check_gtm(page)
    findings += check_adobe(page)
    findings += check_piano(page)
    findings += check_clarity(page)
    findings += check_hotjar(page)
    findings += check_meta_pixel(page)
    findings += check_linkedin(page)
    findings += check_tiktok(page)
    findings += check_data_layer(page, gtm_detected=gtm.detected)
    findings += check_duplicate_tags(page, _build_tracker_loads(
        ga4, gtm, adobe, piano, clarity, hotjar, meta_pixel, linkedin, tiktok,
    ))
    return findings


@dataclass
class AnalyticsAuditResult:
    """Lightweight container mirroring accessibility.AccessibilityAuditResult's shape."""
    findings: List[dict]
    score: AnalyticsScoreResult
    summary: AnalyticsSummary


def analyze_page(page: ParsedPage) -> AnalyticsAuditResult:
    """
    Convenience one-call entry point for a single page: runs every
    detector once, builds findings + a weighted score + an
    Analytics-model-ready summary from the same detection pass (so
    nothing gets scanned for twice).
    """
    ga4 = detect_ga4(page)
    gtm = detect_gtm(page)
    adobe = detect_adobe(page)
    piano = detect_piano(page)
    clarity = detect_clarity(page)
    hotjar = detect_hotjar(page)
    meta_pixel = detect_meta_pixel(page)
    linkedin = detect_linkedin(page)
    tiktok = detect_tiktok(page)
    data_layer = detect_data_layer(page)

    findings: List[dict] = []
    findings += check_ga4(page)
    findings += check_gtm(page)
    findings += check_adobe(page)
    findings += check_piano(page)
    findings += check_clarity(page)
    findings += check_hotjar(page)
    findings += check_meta_pixel(page)
    findings += check_linkedin(page)
    findings += check_tiktok(page)
    findings += check_data_layer(page, gtm_detected=gtm.detected)
    findings += check_duplicate_tags(page, _build_tracker_loads(
        ga4, gtm, adobe, piano, clarity, hotjar, meta_pixel, linkedin, tiktok,
    ))

    score = score_analytics(findings)
    summary = build_analytics_summary(
        ga4_detection=ga4,
        gtm_detection=gtm,
        data_layer_detection=data_layer,
        meta_pixel_detection=meta_pixel,
        tiktok_detection=tiktok,
        other_detections={"adobe": adobe, "piano": piano, "clarity": clarity,
                           "hotjar": hotjar, "linkedin": linkedin},
        score_result=score,
    )

    return AnalyticsAuditResult(findings=findings, score=score, summary=summary)


def _build_tracker_loads(ga4, gtm, adobe, piano, clarity, hotjar, meta_pixel, linkedin, tiktok) -> List[TrackerLoad]:
    return [
        TrackerLoad("ga4", "Google Analytics 4", ga4.measurement_ids, ga4.script_tag_count),
        TrackerLoad("gtm", "Google Tag Manager", gtm.container_ids, gtm.script_tag_count),
        TrackerLoad("adobe", "Adobe Analytics", adobe.report_suites, 0),
        TrackerLoad("piano", "Piano Analytics", piano.site_ids, 0),
        TrackerLoad("clarity", "Microsoft Clarity", clarity.project_ids, clarity.script_tag_count),
        TrackerLoad("hotjar", "Hotjar", hotjar.site_ids, hotjar.script_tag_count),
        TrackerLoad("meta_pixel", "Meta Pixel", meta_pixel.pixel_ids, 1 if meta_pixel.loader_found else 0),
        TrackerLoad("linkedin", "LinkedIn Insight Tag", linkedin.partner_ids, 1 if linkedin.loader_found else 0),
        TrackerLoad("tiktok", "TikTok Pixel", tiktok.pixel_ids, 0),
    ]
