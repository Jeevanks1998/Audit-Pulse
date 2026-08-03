"""
services/audit_service.py

Business logic behind api/audit.py: the create flow, the query helpers
reused by dashboard_service / history_service / api/settings.py, stats
aggregation, and `run_audit_pipeline` — which crawls the audited URL once
and runs the real seo/, performance/, accessibility/, security/, ux/,
images/, links/, mobile/, forms/, analytics/, and consent/ check
packages against it. It walks the same step sequence the frontend
already animates through (see config.constants.AUDIT_STEPS and
assets/js/audit.js) so the API and UI stay in lockstep, then persists
real scores/findings across every detail table: Issue rows (normalized
findings), Consent, and Analytics, plus a real AI-module pass via
services.ai_service.

Also links every audit to a Website row (models/website.py) so the same
hostname's runs can be grouped/trended, and logs a History event when an
audit starts and when it finishes or fails.

Nothing in this module imports from api/ or depends on FastAPI request
objects — routers call in, never the other way around, so this logic is
reusable from anywhere (api/audit.py, services.scheduler_service, a
future Celery beat worker, tests, ...).
"""

from datetime import datetime, timezone
from typing import List, Optional
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import accessibility as accessibility_module
import analytics as analytics_module
import consent as consent_module
import forms as forms_module
import images as images_module
import links as links_module
import mobile as mobile_module
import performance as performance_module
import security as security_module
import seo as seo_module
import ux as ux_module
from config.constants import AUDIT_STEPS
from config.database import AsyncSessionLocal
from config.logging import logger
from config.settings import settings
from cookies.detector import parse_set_cookie_headers
from crawler.links import extract_links
from crawler.parser import ParsedPage, parse_html
from crawler.robots import DEFAULT_USER_AGENT
from models.analytics import Analytics
from models.audit import Audit
from models.consent import Consent
from models.history import HistoryEventType, log_event
from models.issue import sync_issues_from_findings
from models.user import User
from models.website import Website, get_or_create_website, record_audit_result
from schemas.audit import AuditCreate, AuditStatsOut
from services import ai_service

EMPTY_BREAKDOWN = {
    "seo": 0,
    "performance": 0,
    "accessibility": 0,
    "security": 0,
    "ux": 0,
    "images": 0,
    "links": 0,
    "mobile": 0,
    "forms": 0,
}


# --------------------------------------------------------------------------
# Query helpers (reused by dashboard_service / history_service / api/settings.py)
# --------------------------------------------------------------------------
async def get_recent_audits(db: AsyncSession, user: User, limit: int = 25) -> List[Audit]:
    result = await db.execute(
        select(Audit).where(Audit.user_id == user.id).order_by(Audit.created_at.desc()).limit(limit)
    )
    return list(result.scalars().all())


async def get_all_audits(db: AsyncSession, user: User) -> List[Audit]:
    result = await db.execute(
        select(Audit).where(Audit.user_id == user.id).order_by(Audit.created_at.desc())
    )
    return list(result.scalars().all())


async def compute_stats(db: AsyncSession, user: User) -> AuditStatsOut:
    all_audits = await get_all_audits(db, user)
    completed = [a for a in all_audits if a.status == "completed"]

    if not completed:
        return AuditStatsOut(
            total_audits=len(all_audits),
            seo_issues=0,
            performance_score=0,
            critical_issues=0,
            overall=0,
            breakdown=dict(EMPTY_BREAKDOWN),
        )

    latest = completed[0]
    avg_overall = round(sum(a.overall_score or 0 for a in completed) / len(completed))
    seo_issues = sum(1 for a in completed for f in (a.findings or []) if f.get("module") == "seo")
    critical_issues = sum(
        1 for a in completed for f in (a.findings or []) if f.get("severity") == "critical"
    )

    return AuditStatsOut(
        total_audits=len(all_audits),
        seo_issues=seo_issues,
        performance_score=(latest.breakdown or {}).get("performance", 0),
        critical_issues=critical_issues,
        overall=avg_overall,
        breakdown=latest.breakdown or dict(EMPTY_BREAKDOWN),
    )


# --------------------------------------------------------------------------
# Creation
# --------------------------------------------------------------------------
def new_audit(
    user_id: int,
    website_id: Optional[int],
    url: str,
    depth: str,
    max_pages: int,
    modules: list,
) -> Audit:
    """Build (but don't add/persist) a queued Audit row."""
    return Audit(
        user_id=user_id,
        website_id=website_id,
        url=url,
        label="Full site" if depth == "full" else "Homepage",
        depth=depth,
        max_pages=max_pages,
        modules=modules,
        status="queued",
    )


async def start_audit(db: AsyncSession, user: User, payload: AuditCreate) -> Audit:
    """
    Full create flow for POST /audits/: resolve the Website row, persist
    the Audit, log an AUDIT_CREATED event, and commit. Does not start the
    background pipeline — the caller (api/audit.py) owns BackgroundTasks
    since that's a FastAPI request-scoped concern.
    """
    website = await get_or_create_website(db, user.id, payload.url)
    audit = new_audit(user.id, website.id, payload.url, payload.depth, payload.max_pages, payload.modules)
    db.add(audit)
    await db.flush()

    await log_event(
        db,
        user.id,
        HistoryEventType.AUDIT_CREATED,
        description=f"Started {audit.label.lower()} audit of {audit.url}",
        audit_id=audit.id,
    )

    await db.commit()
    await db.refresh(audit)
    return audit


# --------------------------------------------------------------------------
# Pipeline — crawls the audited URL once, then runs the real seo/,
# performance/, accessibility/, security/, analytics/, and consent/
# check packages against it.
# --------------------------------------------------------------------------
async def run_audit_pipeline(audit_id: int) -> None:
    """
    Runs in the background after an audit is created (via BackgroundTasks).
    Walks AUDIT_STEPS, persisting progress after each real check group
    completes, then finalizes with real scores across
    Audit.breakdown/findings plus the normalized Issue, Consent, and
    Analytics rows. Uses its own DB session since it runs outside request
    scope — never reuse a request-scoped session here.
    """
    async with AsyncSessionLocal() as db:
        audit = await db.get(Audit, audit_id)
        if not audit:
            logger.warning(f"run_audit_pipeline: audit {audit_id} not found")
            return

        audit.status = "running"
        audit.started_at = datetime.now(timezone.utc)
        await db.commit()

        try:
            async with httpx.AsyncClient(
                follow_redirects=True, timeout=20.0, headers={"User-Agent": DEFAULT_USER_AGENT}
            ) as client:
                await _advance_step(db, audit, "checkCrawl")
                response = await client.get(audit.url)
                page = parse_html(audit.url, response.text)
                hostname = urlparse(audit.url).hostname or ""
                links = extract_links(page, hostname)

                await _advance_step(db, audit, "checkSeo")
                seo_result = await _run_seo_checks(client, audit.url, page, links)

                await _advance_step(db, audit, "checkAccessibility")
                accessibility_result = await accessibility_module.run_accessibility_checks(client, page)

                await _advance_step(db, audit, "checkPerformance")
                performance_result = await performance_module.run_performance_checks(client, audit.url)
                security_result = await security_module.run_security_checks(client, page)

                ux_result = ux_module.score_ux(ux_module.run_page_checks(page))
                forms_result = forms_module.score_forms(forms_module.run_page_checks(page))
                mobile_result = mobile_module.run_mobile_checks(page, performance_result.metrics)

                images_findings = images_module.run_page_checks(page)
                images_findings += await images_module.run_site_checks(client, page)
                images_result = images_module.score_images(images_findings)

                links_findings = links_module.run_page_checks(page, links)
                links_findings += await links_module.run_site_checks(client, links)
                links_result = links_module.score_links(links_findings)

                breakdown = {
                    "seo": seo_result.overall,
                    "performance": performance_result.score.overall,
                    "accessibility": accessibility_result.score.overall,
                    "security": security_result.score.overall,
                    "ux": ux_result.overall,
                    "images": images_result.overall,
                    "links": links_result.overall,
                    "mobile": mobile_result.overall,
                    "forms": forms_result.overall,
                }
                overall = round(sum(breakdown.values()) / len(breakdown))

                findings: list = []
                findings += seo_result.findings
                findings += performance_result.findings
                findings += accessibility_result.findings
                findings += security_result.findings
                findings += ux_result.findings
                findings += images_result.findings
                findings += links_result.findings
                findings += mobile_result.findings
                findings += forms_result.findings

                if "ai" in (audit.modules or []):
                    findings = findings + await ai_service.generate_ai_findings(audit.url, breakdown)

                await _advance_step(db, audit, "checkReport")

            audit.status = "completed"
            audit.overall_score = overall
            audit.breakdown = breakdown
            audit.findings = findings
            audit.completed_at = datetime.now(timezone.utc)

            await sync_issues_from_findings(db, audit, findings)

            if "consent" in (audit.modules or []):
                await _write_consent_result(db, audit)
            if "analytics" in (audit.modules or []):
                await _write_analytics_result(db, audit, page)

            if audit.website_id:
                website = await db.get(Website, audit.website_id)
                if website is not None:
                    await record_audit_result(website, overall, audit.completed_at)

            await log_event(
                db,
                audit.user_id,
                HistoryEventType.AUDIT_COMPLETED,
                description=f"Audit of {audit.url} completed — overall {overall}",
                audit_id=audit.id,
                meta={"overall_score": overall},
            )

            await db.commit()
            logger.info(f"Audit {audit_id} completed — overall {overall}")

        except Exception as exc:  # noqa: BLE001 — persist failure, don't crash the worker
            audit.status = "failed"
            audit.error_message = str(exc)
            await log_event(
                db,
                audit.user_id,
                HistoryEventType.AUDIT_FAILED,
                description=f"Audit of {audit.url} failed: {exc}",
                audit_id=audit.id,
            )
            await db.commit()
            logger.exception(f"Audit {audit_id} failed: {exc}")


async def _advance_step(db: AsyncSession, audit: Audit, step_id: str) -> None:
    """Marks the given AUDIT_STEPS entry current and persists progress %."""
    index = next((i for i, step in enumerate(AUDIT_STEPS) if step["id"] == step_id), None)
    if index is not None:
        audit.current_step = step_id
        audit.percent = round(((index + 1) / len(AUDIT_STEPS)) * 100)
        await db.commit()


async def _run_seo_checks(
    client: httpx.AsyncClient, url: str, page: ParsedPage, links: list
) -> "seo_module.SEOScoreResult":
    """Runs every seo/ check (page-level + site-level, including a capped broken-link sample) and scores them."""
    findings = seo_module.run_page_checks(page, links)
    findings += await seo_module.run_site_checks(client, url, links_to_verify=links)
    return seo_module.score_seo(findings)


async def _write_consent_result(db: AsyncSession, audit: Audit) -> None:
    """
    Real consent/cookie-banner scan: fetches the audited URL, runs every
    check in consent/ against it (banner presence, button parity, consent
    mode, cookies, pre-consent behavior), and — when Playwright is
    installed — captures a clipped screenshot of the banner itself via
    consent.screenshots.capture_banner_screenshot.

    Degrades gracefully: if the fetch itself fails (site down, DNS error,
    blocked by the target), we still write a Consent row with
    has_cookie_banner=False / consent_score=0 rather than raising, so one
    module failing never takes down the whole audit (same contract the
    rest of this pipeline already follows for AI/SEO findings).
    """
    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=15.0, headers={"User-Agent": DEFAULT_USER_AGENT}
        ) as client:
            response = await client.get(audit.url)
        page = parse_html(audit.url, response.text)
        page_cookies = parse_set_cookie_headers(
            response.headers.get_list("set-cookie"), source_url=audit.url
        )
        hostname = urlparse(audit.url).hostname

        result = await consent_module.analyze_site(
            audit.url,
            page,
            cookies=page_cookies,
            first_party_hostname=hostname,
            enable_live_checks=True,
            capture_screenshot=getattr(settings, "CRAWLER_ENABLE_SCREENSHOTS", False),
        )

        consent = Consent(
            audit_id=audit.id,
            **vars(result.summary),
            banner_screenshot_path=result.banner_screenshot_path,
        )
    except Exception as exc:  # noqa: BLE001 — a failed consent scan shouldn't fail the whole audit
        logger.warning(f"_write_consent_result: consent scan failed for {audit.url}: {exc}")
        consent = Consent(audit_id=audit.id, has_cookie_banner=False, consent_score=0)

    db.add(consent)


async def _write_analytics_result(db: AsyncSession, audit: Audit, page: ParsedPage) -> None:
    """
    Real analytics/tag-detection scan: runs every detector in analytics/
    (GA4, GTM, Adobe, Piano, Clarity, Hotjar, Meta Pixel, LinkedIn,
    TikTok, dataLayer, duplicate-tag check) against the already-fetched,
    already-parsed homepage — no extra network call needed, since every
    tracker signature lives in the page's own markup/script tags.
    """
    result = analytics_module.analyze_page(page)
    analytics = Analytics(audit_id=audit.id, **vars(result.summary))
    db.add(analytics)
