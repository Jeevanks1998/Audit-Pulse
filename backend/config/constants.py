"""
config/constants.py

Static, non-secret constants shared across the backend. These mirror
`window.APP_CONFIG` in assets/js/config.js on the front end, so the two
stay in sync (module keys, audit steps, score bands, etc.).
"""

from enum import Enum

APP_NAME = "AuditPulse"

# Module keys — must match `data-module` attributes in audit.html
AUDIT_MODULES = [
    "ai",
    "pdf",
    "consent",
    "analytics",
    "performance",
    "accessibility",
    "seo",
]

# Ordered pipeline steps for a running audit job.
# `id` corresponds to the check-item element ids used by the frontend
# progress UI (assets/js/audit.js -> checkList).
AUDIT_STEPS = [
    {"id": "checkCrawl", "label": "Crawling website"},
    {"id": "checkSeo", "label": "SEO"},
    {"id": "checkAccessibility", "label": "Accessibility"},
    {"id": "checkPerformance", "label": "Performance"},
    {"id": "checkReport", "label": "Generating report"},
]

# Score-band thresholds shared by ring/chip coloring on the frontend.
SCORE_BANDS = {"good": 80, "mid": 50}


class AuditStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    PASS = "pass"
    FAILED = "failed"
    COMPLETED = "completed"


class AuditDepth(str, Enum):
    HOMEPAGE = "homepage"
    FULL = "full"


class AuditLabel(str, Enum):
    HOMEPAGE = "Homepage"
    FULL_SITE = "Full site"


DEFAULT_MAX_PAGES = 50
MAX_PAGES_LIMIT = 1000
MIN_PAGES_LIMIT = 1

# Pagination defaults
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100
