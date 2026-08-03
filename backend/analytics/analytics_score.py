"""
analytics/analytics_score.py

Turns the flat finding lists every other analytics/* module returns
into a single weighted 0-100 score with a per-category breakdown — the
same shape Audit.breakdown["analytics"] / AuditStatsOut.breakdown
already carry for the other modules (see seo/seo_score.py,
accessibility/accessibility_score.py for the identical pattern).

Also exposes `build_analytics_summary`, which maps the individual
detect_*() results onto models.analytics.Analytics's columns
(trackers_detected, tag_manager_detected, gtm_container_id,
ga_measurement_id, data_layer_present, pageview_events_found,
custom_events_found, analytics_score) — this is what
services.audit_service._write_analytics_result should build from once
it's wired to the real detectors instead of its current
random.randint(...) placeholder.

Unlike SEO/accessibility, "no trackers found" is not a defect here —
plenty of legitimate sites run no analytics at all — so a category with
zero findings simply stays at 100 rather than being read as a failure.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

MODULE = "analytics"

SEVERITY_PENALTY = {"critical": 30, "warning": 15, "info": 5}

# Must sum to 1.0. Categories not listed here (e.g. an unrecognized
# `category` value on a finding) are folded into "other" at a small
# default weight so nothing is silently dropped from the overall score.
CATEGORY_WEIGHTS: Dict[str, float] = {
    "ga4": 0.15,
    "gtm": 0.15,
    "adobe": 0.10,
    "piano": 0.05,
    "clarity": 0.05,
    "hotjar": 0.05,
    "meta_pixel": 0.10,
    "linkedin": 0.05,
    "tiktok": 0.05,
    "data_layer": 0.15,
    "duplicate_tags": 0.10,
}

_OTHER_CATEGORY = "other"
_OTHER_WEIGHT = 0.05

TRACKER_DISPLAY_NAMES: Dict[str, str] = {
    "ga4": "Google Analytics 4",
    "gtm": "Google Tag Manager",
    "adobe": "Adobe Analytics",
    "piano": "Piano Analytics",
    "clarity": "Microsoft Clarity",
    "hotjar": "Hotjar",
    "meta_pixel": "Meta Pixel",
    "linkedin": "LinkedIn Insight Tag",
    "tiktok": "TikTok Pixel",
}


@dataclass
class AnalyticsScoreResult:
    overall: int
    breakdown: Dict[str, int] = field(default_factory=dict)
    counts_by_severity: Dict[str, int] = field(default_factory=dict)
    findings: List[dict] = field(default_factory=list)


def score_analytics(findings: List[dict]) -> AnalyticsScoreResult:
    """
    Scores a flat list of finding dicts (as returned by
    analytics.run_page_checks, or concatenated across an entire crawl)
    into an overall score plus per-category breakdown.
    """
    by_category: Dict[str, List[dict]] = {}
    for finding in findings:
        category = finding.get("category") or _OTHER_CATEGORY
        by_category.setdefault(category, []).append(finding)

    breakdown: Dict[str, int] = {}
    weight_total = 0.0
    weighted_sum = 0.0

    all_categories = set(CATEGORY_WEIGHTS) | set(by_category)
    for category in all_categories:
        weight = CATEGORY_WEIGHTS.get(category, _OTHER_WEIGHT)
        score = _score_category(by_category.get(category, []))
        breakdown[category] = score
        weight_total += weight
        weighted_sum += score * weight

    overall = round(weighted_sum / weight_total) if weight_total else 100

    counts_by_severity: Dict[str, int] = {"critical": 0, "warning": 0, "info": 0}
    for finding in findings:
        severity = finding.get("severity", "info")
        counts_by_severity[severity] = counts_by_severity.get(severity, 0) + 1

    return AnalyticsScoreResult(
        overall=overall,
        breakdown=breakdown,
        counts_by_severity=counts_by_severity,
        findings=findings,
    )


def _score_category(category_findings: List[dict]) -> int:
    score = 100
    for finding in category_findings:
        score -= SEVERITY_PENALTY.get(finding.get("severity", "info"), SEVERITY_PENALTY["info"])
    return max(0, score)


@dataclass
class AnalyticsSummary:
    """Field-for-field match with models.analytics.Analytics, minus audit_id/id/created_at."""
    trackers_detected: List[str] = field(default_factory=list)
    tag_manager_detected: bool = False
    gtm_container_id: Optional[str] = None
    ga_measurement_id: Optional[str] = None
    data_layer_present: bool = False
    pageview_events_found: int = 0
    custom_events_found: int = 0
    analytics_score: int = 0


def build_analytics_summary(
    *,
    ga4_detection,
    gtm_detection,
    data_layer_detection,
    meta_pixel_detection=None,
    tiktok_detection=None,
    other_detections: Optional[Dict[str, object]] = None,
    score_result: Optional[AnalyticsScoreResult] = None,
) -> AnalyticsSummary:
    """
    Assembles an AnalyticsSummary ready to pass straight into
    models.analytics.Analytics(**vars(summary), audit_id=...). Takes
    the individual detect_*() results rather than the ParsedPage
    itself, since __init__.run_page_checks already computed all of
    them once and there's no reason to re-scan the page here.

    `other_detections` is an optional {category_key: detection} map for
    adobe/piano/clarity/hotjar/linkedin — anything with a truthy
    `.detected` contributes its display name to trackers_detected.
    """
    trackers: List[str] = []
    if ga4_detection.detected:
        trackers.append(TRACKER_DISPLAY_NAMES["ga4"])
    if gtm_detection.detected:
        trackers.append(TRACKER_DISPLAY_NAMES["gtm"])
    if meta_pixel_detection is not None and meta_pixel_detection.detected:
        trackers.append(TRACKER_DISPLAY_NAMES["meta_pixel"])
    if tiktok_detection is not None and tiktok_detection.detected:
        trackers.append(TRACKER_DISPLAY_NAMES["tiktok"])
    for key, detection in (other_detections or {}).items():
        if getattr(detection, "detected", False):
            trackers.append(TRACKER_DISPLAY_NAMES.get(key, key))

    pageview_events = data_layer_detection.pageview_events
    if meta_pixel_detection is not None and meta_pixel_detection.pageview_fired:
        pageview_events += 1
    if tiktok_detection is not None and tiktok_detection.page_call_found:
        pageview_events += 1

    return AnalyticsSummary(
        trackers_detected=trackers,
        tag_manager_detected=gtm_detection.detected,
        gtm_container_id=gtm_detection.container_ids[0] if gtm_detection.container_ids else None,
        ga_measurement_id=ga4_detection.measurement_ids[0] if ga4_detection.measurement_ids else None,
        data_layer_present=data_layer_detection.present,
        pageview_events_found=pageview_events,
        custom_events_found=data_layer_detection.custom_events,
        analytics_score=score_result.overall if score_result else 100,
    )
