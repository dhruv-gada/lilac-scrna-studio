"""Settings, read from environment variables prefixed LILAC_."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    return default if value is None else value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("LILAC_DATA_DIR", "./data")).resolve())
    reference_root: Path = field(
        default_factory=lambda: Path(os.environ.get("LILAC_REFERENCE_ROOT", "/refs")).resolve()
    )
    demo_mode: bool = field(default_factory=lambda: _bool("LILAC_DEMO", True))
    """In demo mode runs are simulated: stages advance on a timer and results are synthetic."""
    demo_stage_seconds: float = field(default_factory=lambda: float(os.environ.get("LILAC_DEMO_STAGE_SECONDS", "2.5")))
    rscript: str = field(default_factory=lambda: os.environ.get("LILAC_RSCRIPT", "Rscript"))
    python: str = field(default_factory=lambda: os.environ.get("LILAC_PYTHON", "python3"))
    cors_origins: list[str] = field(
        default_factory=lambda: os.environ.get("LILAC_CORS_ORIGINS", "http://localhost:5173").split(",")
    )


settings = Settings()
