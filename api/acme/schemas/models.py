from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Role = Literal["nurse", "physician", "biomed", "admin"]
Scenario = Literal["normal", "low_spo2", "low_battery", "sensor_fault", "connection_loss"]
Param = Literal["hr", "spo2", "rr", "sbp", "dbp"]


class ProfileUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    title: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    avatar_url: str | None = Field(default=None, max_length=500)


class Preferences(BaseModel):
    alarm_sound: bool = True
    alarm_volume: int = Field(default=70, ge=0, le=100)
    default_ward_id: str | None = None
    trend_window_minutes: int = Field(default=30, ge=5, le=240)
    show_ecg: bool = True
    compact_tiles: bool = False
    notify_high_priority: bool = True
    notify_technical: bool = True


class SystemSettingsUpdate(BaseModel):
    facility_name: str = Field(min_length=2, max_length=120)
    paging_enabled: bool
    escalation_minutes: int = Field(ge=1, le=60)
    battery_low_threshold: int = Field(ge=5, le=50)
    history_retention_hours: int = Field(ge=6, le=720)


class BindMonitor(BaseModel):
    bed_id: str | None  # None = unbind


class MonitorUpdate(BaseModel):
    status: Literal["in_use", "available", "maintenance", "retired"] | None = None
    firmware: str | None = Field(default=None, max_length=40)
    next_maintenance_due: date | None = None


class AckAlarm(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class ObservationCreate(BaseModel):
    category: Literal["assessment", "intervention", "medication", "note", "escalation"]
    note: str = Field(min_length=3, max_length=4000)
    include_vitals: bool = True


class ThresholdIn(BaseModel):
    parameter: Param
    low: float | None = None
    high: float | None = None
    enabled: bool = True

    @model_validator(mode="after")
    def check_range(self):
        if self.low is not None and self.high is not None and self.low >= self.high:
            raise ValueError(f"{self.parameter}: low limit must be below high limit")
        if self.low is None and self.high is None and self.enabled:
            raise ValueError(f"{self.parameter}: set at least one limit or disable the alarm")
        return self


class ThresholdSet(BaseModel):
    items: list[ThresholdIn] = Field(min_length=1, max_length=5)


class MaintenanceCreate(BaseModel):
    monitor_id: str
    type: Literal["preventive", "corrective", "calibration", "battery_replacement", "inspection"]
    scheduled_for: date
    description: str = Field(min_length=3, max_length=1000)


class MaintenanceUpdate(BaseModel):
    status: Literal["scheduled", "in_progress", "completed", "cancelled"] | None = None
    resolution: str | None = Field(default=None, max_length=2000)
    scheduled_for: date | None = None
    attachment_path: str | None = Field(default=None, max_length=500)


class ReportRequest(BaseModel):
    type: Literal["alarm_summary", "patient_vitals", "device_status"]
    hours: int = Field(default=24, ge=1, le=720)
    ward_id: str | None = None
    patient_id: str | None = None


class StaffCreate(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$", max_length=254)
    full_name: str = Field(min_length=2, max_length=120)
    role: Role
    title: str | None = Field(default=None, max_length=120)
    password: str = Field(min_length=8, max_length=72)

    @field_validator("password")
    @classmethod
    def strong(cls, v: str) -> str:
        if not any(c.isdigit() for c in v) or not any(c.isalpha() for c in v):
            raise ValueError("Password must contain letters and numbers")
        return v


class StaffUpdate(BaseModel):
    role: Role | None = None
    is_active: bool | None = None
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    title: str | None = Field(default=None, max_length=120)


class AdvanceRequest(BaseModel):
    ticks: int = Field(default=1, ge=1, le=120)


class ScenarioRequest(BaseModel):
    scenario: Scenario


class BulkScenarioRequest(BaseModel):
    scenario: Scenario
    monitor_ids: list[str] = Field(min_length=1)


class RunningRequest(BaseModel):
    running: bool
