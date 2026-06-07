from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class OcrData(BaseModel):
    fullName: str = ""
    cccd: str = ""
    cmnd: str = ""


class OcrConfidence(BaseModel):
    fullName: float = 0.0
    cccd: float = 0.0
    cmnd: float = 0.0


class OcrResponse(BaseModel):
    ok: bool
    source: Literal["ai_vision", "qr", "ocr", "cropped_field_ocr"] = "ai_vision"
    data: OcrData
    warnings: list[str] = []
    message: str | None = None
    confidence: OcrConfidence = Field(default_factory=OcrConfidence)
    method: Literal["ai_vision", "qr", "cropped_field_ocr", "full_image_fallback_ocr"] | None = None
    processing_time_ms: int = 0
    debug_timing: dict[str, int] = Field(default_factory=dict)
    full_name: str = ""
    identity_no: str = ""
    old_id_no: str = ""


class RecoveryRequest(BaseModel):
    full_name: str = Field(min_length=1)
    identity_no: str

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Họ và tên không được để trống.")
        return normalized

    @field_validator("identity_no")
    @classmethod
    def validate_identity_no(cls, value: str) -> str:
        digits = "".join(ch for ch in value if ch.isdigit())
        if len(digits) not in (9, 12):
            raise ValueError("Số CCCD/GTTT phải gồm 9 hoặc 12 chữ số.")
        return digits


class RecoveryResponse(BaseModel):
    success: bool
    http_status: int
    response_status: int | None
    message: str
    masked_identity_no: str
    raw: dict[str, Any] = {}
