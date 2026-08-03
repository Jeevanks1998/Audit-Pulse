"""
reports/generator.py

Builds the full, in-memory report payload for one completed Audit —
the score grid (report.html's radar chart, see assets/js/report.js ->
Charts.renderRadar), the findings, and the AI-generated layer on top
(executive summary, prioritized findings, business impact, action plan).
This is the one place that assembles all of that into a single shape;
reports/json_report.py and reports/html_report.py both take a
`ReportPayload` from here and just re-render it in a different format,
and reports/report_storage.py persists whatever they produce.

services.report_service is the thin, request-facing layer that calls in
here — nothing under api/ should build a report payload itself.

The AI section is additive and best-effort: `build_report_payload` always
returns the score grid + findings even if every AI call fails, since
ai.* itself already falls back to heuristic content rather than raising
(see ai/provider.py's docstring) — there's no failure mode left here to
handle, but `include_ai=False` is available for callers that want the
fast, AI-free path (e.g. a live preview) regardless.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from ai import (
    ActionPlan,
    generate_action_plan,
    generate_business_impact,
    generate_executive_summary,
    top_priorities,
)
from ai.priority import PrioritizedFinding

MODULE_LABELS = {
    "seo": "SEO",
    "performance": "Performance",
    "accessibility": "Accessibility",
    "security": "Security",
    "ux": "UX",
    "images": "Images",
    "links": "Links",
    "mobile": "Mobile",
    "forms": "Forms",
    "consent": "Consent",
    "analytics": "Analytics",
    "ai": "AI Review",
}


@dataclass
class ScoreCell:
    module: str
    label: str
    score: int
    target_section: str


@dataclass
class ReportPayload:
    audit_id: int
    url: str
    overall: int
    generated_at: str
    score_grid: List[ScoreCell] = field(default_factory=list)
    findings: List[dict] = field(default_factory=list)
    executive_summary: Optional[str] = None
    priorities: List[PrioritizedFinding] = field(default_factory=list)
    business_impact: List[dict] = field(default_factory=list)
    action_plan: Optional[ActionPlan] = None
    share_url: Optional[str] = None


def build_score_grid(breakdown: Dict[str, int]) -> List[ScoreCell]:
    return [
        ScoreCell(
            module=key,
            label=MODULE_LABELS.get(key, key.title()),
            score=value,
            target_section=f"section-{key}",
        )
        for key, value in breakdown.items()
    ]


async def build_report_payload(
    *,
    audit_id: int,
    url: str,
    overall: int,
    generated_at: str,
    breakdown: Dict[str, int],
    findings: List[dict],
    share_url: Optional[str] = None,
    include_ai: bool = True,
) -> ReportPayload:
    """
    Assembles the full report payload for one audit. `breakdown` and
    `findings` are read straight off the Audit row (Audit.breakdown /
    Audit.findings) by the caller — this function does no DB access itself,
    so it's equally usable from a request handler, a background job, or a
    test.
    """
    payload = ReportPayload(
        audit_id=audit_id,
        url=url,
        overall=overall,
        generated_at=generated_at,
        score_grid=build_score_grid(breakdown),
        findings=findings,
        share_url=share_url,
    )

    if not include_ai:
        return payload

    payload.executive_summary = await generate_executive_summary(url, overall, breakdown, findings)
    payload.priorities = top_priorities(findings, breakdown)
    payload.business_impact = await generate_business_impact(url, breakdown, findings)
    payload.action_plan = await generate_action_plan(url, breakdown, findings)
    return payload
