"""
schemas/audit.py

Request/response models for api/audit.py: starting a run, polling its
progress, and reading back a result. `AuditOut` is also reused as the
list-item shape for dashboard "recent audits" (api/dashboard.py),
history pagination (api/history.py), the schedule "run now" response
(api/scheduler.py), and the audit list embedded in a settings export
(api/settings.py) — one canonical serialization of an Audit row for
every router that needs it.
"""

import os
from datetime import datetime
from typing import List, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator

from config.constants import DEFAULT_MAX_PAGES, MAX_PAGES_LIMIT, MIN_PAGES_LIMIT


class AuditCreate(BaseModel):
    url: str
    depth: str = Field(default="homepage", pattern="^(homepage|full)$")
    max_pages: int = Field(default=DEFAULT_MAX_PAGES, ge=MIN_PAGES_LIMIT, le=MAX_PAGES_LIMIT)
    modules: List[str] = Field(default_factory=list, min_length=1)

    @field_validator("url")
    @classmethod
    def normalize_url(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Please provide a valid website URL.")
        if not v.startswith(("http://", "https://")):
            v = "https://" + v
        if not urlparse(v).netloc:
            raise ValueError("Please provide a valid website URL.")
        return v


class AuditOut(BaseModel):
    id: int
    url: str
    label: str
    depth: str
    status: str
    current_step: Optional[str] = None
    percent: int
    overall_score: Optional[int] = None
    breakdown: Optional[dict] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AuditProgressOut(BaseModel):
    id: int
    status: str
    current_step: Optional[str] = None
    percent: int
    overall_score: Optional[int] = None


class ConsentOut(BaseModel):
    """Result of the consent-module scan (services.audit_service._write_consent_result)."""

    has_cookie_banner: bool
    banner_blocks_scripts_pre_consent: bool
    gdpr_compliant: bool
    ccpa_compliant: bool
    privacy_policy_found: bool
    privacy_policy_url: Optional[str] = None
    cookies_detected: List[dict] = Field(default_factory=list)
    third_party_trackers: List[str] = Field(default_factory=list)
    consent_score: int
    banner_screenshot_path: Optional[str] = Field(default=None, exclude=True)

    model_config = ConfigDict(from_attributes=True)

    @computed_field  # type: ignore[misc]
    @property
    def banner_screenshot_url(self) -> Optional[str]:
        """
        `/screenshots/<file>.png` — served by the StaticFiles mount in
        main.py. None when Playwright wasn't installed, capture was
        disabled, or the capture failed (no banner found / site
        unreachable) — the frontend should render a "no screenshot
        available" state rather than a broken <img> in that case.
        """
        if not self.banner_screenshot_path:
            return None
        return f"/screenshots/{os.path.basename(self.banner_screenshot_path)}"


class AnalyticsOut(BaseModel):
    """Result of the analytics-module scan (services.audit_service._write_analytics_result)."""

    trackers_detected: List[str] = Field(default_factory=list)
    tag_manager_detected: bool
    gtm_container_id: Optional[str] = None
    ga_measurement_id: Optional[str] = None
    data_layer_present: bool
    pageview_events_found: int
    custom_events_found: int
    analytics_score: int

    model_config = ConfigDict(from_attributes=True)


class AuditStatsOut(BaseModel):
    total_audits: int
    seo_issues: int
    performance_score: int
    critical_issues: int
    overall: int
    breakdown: dict
