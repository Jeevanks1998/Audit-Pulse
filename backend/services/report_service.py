"""
services/report_service.py

Business logic behind api/reports.py: read-only report views built on
top of a completed Audit (models/audit.py). Shapes data the way
report.html expects it — a score grid for the radar chart (see
assets/js/report.js -> Charts.renderRadar) and findings grouped by
module/severity — plus the share / export actions behind the banner
buttons (shareReportBtn, downloadPdfBtn), backed by the persisted Report
model (models/report.py) so share links can be revoked/expired and view
counts tracked.

The score grid + AI layer (executive summary, prioritized findings,
business impact, action plan) are built by reports.generator rather than
here — this module only knows about the Audit/Report ORM rows and the
FastAPI-facing request/response shapes; reports/ has no idea SQLAlchemy
or HTTPException exist. json/html/pdf export bodies go through
reports.json_report / reports.html_report / pdf.pdf_generator and are
cached to disk via reports.report_storage so a repeat download doesn't
re-run the AI pipeline in reports.generator (or, for the PDF, redraw
every chart on top of that).
"""

import secrets
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from crawler.screenshots import capture_screenshot
from models.audit import Audit
from models.history import HistoryEventType, log_event
from models.report import Report
from models.user import User
from pdf.pdf_generator import generate_pdf_report
from reports import build_report_payload, build_score_grid, render_html_report, to_json_report
from reports.report_storage import load_html, load_json, load_pdf, save_html, save_json, save_pdf
from schemas.report import Finding, ReportOut, ScoreCell, ShareOut


async def get_owned_completed_audit(audit_id: int, db: AsyncSession, user: User) -> Audit:
    audit = await db.get(Audit, audit_id)
    if not audit or audit.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    if audit.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This audit hasn't finished running yet.",
        )
    return audit


async def get_report_row(audit_id: int, db: AsyncSession) -> Optional[Report]:
    result = await db.execute(select(Report).where(Report.audit_id == audit_id))
    return result.scalar_one_or_none()


async def get_report(audit_id: int, db: AsyncSession, user: User) -> ReportOut:
    """
    Fetches the completed audit + its shaped report payload, bumping the
    Report row's view_count (if one exists — a report only gets a row
    once it's been shared, see `share_report`).
    """
    audit = await get_owned_completed_audit(audit_id, db, user)
    breakdown = audit.breakdown or {}
    score_grid = [
        ScoreCell(module=c.module, label=c.label, score=c.score, target_section=c.target_section)
        for c in build_score_grid(breakdown)
    ]

    report = await get_report_row(audit_id, db)
    if report:
        report.view_count += 1
        await db.commit()

    return ReportOut(
        audit_id=audit.id,
        url=audit.url,
        overall=audit.overall_score or 0,
        generated_at=audit.completed_at.isoformat() if audit.completed_at else "",
        score_grid=score_grid,
        findings=[Finding(**f) for f in (audit.findings or [])],
        share_url=f"/public/report/{report.share_token}" if report and report.share_token else None,
    )


async def share_report(audit_id: int, db: AsyncSession, user: User) -> ShareOut:
    """Mints (or reuses) a share token for a completed audit's report."""
    audit = await get_owned_completed_audit(audit_id, db, user)

    report = await get_report_row(audit_id, db)
    if report is None:
        report = Report(audit_id=audit.id, user_id=user.id)
        db.add(report)

    if not report.share_token:
        report.share_token = secrets.token_urlsafe(12)
        report.is_public = True
        await log_event(
            db,
            user.id,
            HistoryEventType.REPORT_SHARED,
            description=f"Shared the report for {audit.url}",
            audit_id=audit.id,
        )

    await db.commit()
    return ShareOut(share_url=f"/public/report/{report.share_token}")


# --------------------------------------------------------------------------
# Full (AI-enriched) payload — shared by the json/html export endpoints
# --------------------------------------------------------------------------
async def _build_full_payload(audit_id: int, db: AsyncSession, user: User):
    audit = await get_owned_completed_audit(audit_id, db, user)
    report = await get_report_row(audit_id, db)
    share_url = f"/public/report/{report.share_token}" if report and report.share_token else None

    return await build_report_payload(
        audit_id=audit.id,
        url=audit.url,
        overall=audit.overall_score or 0,
        generated_at=audit.completed_at.isoformat() if audit.completed_at else "",
        breakdown=audit.breakdown or {},
        findings=audit.findings or [],
        share_url=share_url,
    )


async def export_report_json(audit_id: int, db: AsyncSession, user: User, force_refresh: bool = False) -> dict:
    """Returns the full JSON export (reports.json_report), using the on-disk cache unless `force_refresh`."""
    await get_owned_completed_audit(audit_id, db, user)  # 404/409 check even on a cache hit

    if not force_refresh:
        cached = load_json(audit_id)
        if cached is not None:
            return cached

    payload = await _build_full_payload(audit_id, db, user)
    data = to_json_report(payload)
    save_json(audit_id, data)
    return data


async def export_report_html(audit_id: int, db: AsyncSession, user: User, force_refresh: bool = False) -> str:
    """Returns the full standalone HTML export (reports.html_report), using the on-disk cache unless `force_refresh`."""
    await get_owned_completed_audit(audit_id, db, user)  # 404/409 check even on a cache hit

    if not force_refresh:
        cached = load_html(audit_id)
        if cached is not None:
            return cached

    payload = await _build_full_payload(audit_id, db, user)
    html = render_html_report(payload)
    save_html(audit_id, html)
    return html


async def export_report_pdf(audit_id: int, db: AsyncSession, user: User, force_refresh: bool = False) -> bytes:
    """Returns the full PDF export (pdf.pdf_generator), using the on-disk cache unless `force_refresh`.

    Same shape as export_report_json/export_report_html above; the only
    extra step is resolving a homepage screenshot to embed
    (pdf/screenshots.py), which is itself best-effort — see
    `_resolve_screenshot_path`.
    """
    audit = await get_owned_completed_audit(audit_id, db, user)

    if not force_refresh:
        cached = load_pdf(audit_id)
        if cached is not None:
            return cached

    payload = await _build_full_payload(audit_id, db, user)
    screenshot_path = await _resolve_screenshot_path(audit)
    pdf_bytes = generate_pdf_report(payload, screenshot_path=screenshot_path)
    save_pdf(audit_id, pdf_bytes)
    return pdf_bytes


async def _resolve_screenshot_path(audit: Audit) -> Optional[str]:
    """Best-effort homepage screenshot for the PDF's "Page Preview" section.

    Gated on settings.CRAWLER_ENABLE_SCREENSHOTS — the same flag the
    crawler itself checks — since capture requires the optional Playwright
    dependency; `capture_screenshot` already returns None on any failure
    (missing browser binary, navigation timeout, etc.) rather than
    raising, so a bad capture never blocks the PDF.
    """
    if not settings.CRAWLER_ENABLE_SCREENSHOTS:
        return None
    return await capture_screenshot(audit.url, filename_hint=f"audit-{audit.id}")
