"""
models/analytics.py

Result of the "analytics" audit module — which trackers/tag managers the
site loads (GA4, GTM, Meta Pixel, etc.), whether a dataLayer is present,
and how many tracked events were detected during the crawl. One row per
audit, one-to-one with Audit.
"""

from datetime import datetime, timezone
from typing import Optional, TYPE_CHECKING

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from config.database import Base

if TYPE_CHECKING:
    from models.audit import Audit


class Analytics(Base):
    __tablename__ = "analytics_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    audit_id: Mapped[int] = mapped_column(
        ForeignKey("audits.id", ondelete="CASCADE"), unique=True, index=True
    )

    trackers_detected: Mapped[list] = mapped_column(JSON, default=list)  # ["Google Analytics 4", "Meta Pixel", ...]

    tag_manager_detected: Mapped[bool] = mapped_column(Boolean, default=False)
    gtm_container_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    ga_measurement_id: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)

    data_layer_present: Mapped[bool] = mapped_column(Boolean, default=False)
    pageview_events_found: Mapped[int] = mapped_column(Integer, default=0)
    custom_events_found: Mapped[int] = mapped_column(Integer, default=0)

    analytics_score: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

    # ----------------------------------------------------------------
    # Relationships
    # ----------------------------------------------------------------
    audit: Mapped["Audit"] = relationship("Audit", back_populates="analytics_result")

    def __repr__(self) -> str:  # pragma: no cover
        return f"<Analytics audit_id={self.audit_id} score={self.analytics_score}>"
