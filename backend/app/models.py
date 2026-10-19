"""Request and response models for runs."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field

StageState = Literal["pending", "running", "needs_input", "done", "failed", "skipped"]
RunState = Literal["draft", "queued", "running", "needs_input", "done", "failed", "cancelled"]


def now() -> datetime:
    return datetime.now(timezone.utc)


class Sample(BaseModel):
    id: str = Field(description="Sample ID exactly as it appears in the sample sheet.")
    condition: str
    replicate: int = 1
    batch: str | None = None


class StageConfig(BaseModel):
    tool: str
    enabled: bool = True
    params: dict[str, Any] = Field(default_factory=dict)


class RunCreate(BaseModel):
    name: str
    description: str = ""
    organism: Literal["human", "mouse"] = "human"
    reference: str = Field("GRCh38-2024-A", description="Genome or index name under the reference root.")
    input_type: Literal["bcl", "fastq"] = "bcl"
    input_path: str = Field(description="BCL run folder, or a folder of FASTQ files.")
    sample_sheet: str | None = None
    samples: list[Sample]
    config: dict[str, StageConfig]


class StageStatus(BaseModel):
    id: str
    state: StageState = "pending"
    started_at: datetime | None = None
    finished_at: datetime | None = None
    progress: float = 0.0
    message: str = ""
    metrics: dict[str, Any] = Field(default_factory=dict)


class Run(RunCreate):
    id: str
    state: RunState = "draft"
    created_at: datetime = Field(default_factory=now)
    updated_at: datetime = Field(default_factory=now)
    stages: list[StageStatus] = Field(default_factory=list)
    demo: bool = False


class RunSummary(BaseModel):
    id: str
    name: str
    description: str
    state: RunState
    created_at: datetime
    updated_at: datetime
    n_samples: int
    conditions: list[str]
    progress: float
    current_stage: str | None
    cells: int | None = None
    demo: bool = False
    stages: list[dict[str, str]] = Field(default_factory=list, description="Stage ID and state, in order.")


class AnnotationUpdate(BaseModel):
    labels: dict[str, str] = Field(description="Cluster ID → cell type label.")
