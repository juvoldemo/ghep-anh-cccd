import time
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from app.mybvlife_recovery.config import MYBVLIFE_RECOVERY_ENABLED, RECOVERY_RATE_LIMIT_PER_MINUTE
from app.mybvlife_recovery.ocr_service import ocr_cccd
from app.mybvlife_recovery.recovery_service import recover_mybvlife
from app.mybvlife_recovery.schemas import OcrResponse, RecoveryRequest, RecoveryResponse
from app.mybvlife_recovery.security_utils import mask_identity_no

router = APIRouter(tags=["MyBVLife Recovery"])

TMP_DIR = Path("tmp_uploads")
MAX_FILE_SIZE = 10 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"image/jpeg": ".jpg", "image/png": ".png"}
_rate_bucket: dict[str, list[float]] = {}
_masked_logs: list[dict[str, str | int | float | bool | None]] = []


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(ip: str) -> None:
    now = time.time()
    window_start = now - 60
    entries = [stamp for stamp in _rate_bucket.get(ip, []) if stamp >= window_start]
    if len(entries) >= RECOVERY_RATE_LIMIT_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Bạn thao tác quá nhanh, vui lòng thử lại sau.")
    entries.append(now)
    _rate_bucket[ip] = entries


async def _save_upload_temporarily(file: UploadFile) -> Path:
    if not MYBVLIFE_RECOVERY_ENABLED:
        raise HTTPException(status_code=403, detail="Chức năng đang tạm tắt.")
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Vui lòng tải ảnh JPG, JPEG hoặc PNG.")

    TMP_DIR.mkdir(parents=True, exist_ok=True)
    temp_path = TMP_DIR / f"{uuid.uuid4()}{ALLOWED_CONTENT_TYPES[file.content_type]}"
    size = 0
    with temp_path.open("wb") as buffer:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_FILE_SIZE:
                temp_path.unlink(missing_ok=True)
                raise HTTPException(status_code=400, detail="Dung lượng ảnh tối đa 10MB.")
            buffer.write(chunk)
    return temp_path


@router.post("/api/ocr-cccd", response_model=OcrResponse)
async def ai_ocr_endpoint(file: UploadFile = File(...)):
    temp_path = await _save_upload_temporarily(file)
    try:
        result = ocr_cccd(temp_path)
        data = result["data"]
        return {
            **result,
            "full_name": data["fullName"],
            "identity_no": data["cccd"],
            "old_id_no": data["cmnd"],
        }
    finally:
        await file.close()
        temp_path.unlink(missing_ok=True)


@router.post("/api/mybvlife/ocr", response_model=OcrResponse)
async def legacy_ocr_endpoint(file: UploadFile = File(...)):
    temp_path = await _save_upload_temporarily(file)
    try:
        result = ocr_cccd(temp_path)
        data = result["data"]
        return {
            **result,
            "full_name": data["fullName"],
            "identity_no": data["cccd"],
            "old_id_no": data["cmnd"],
        }
    finally:
        await file.close()
        temp_path.unlink(missing_ok=True)


@router.post("/api/mybvlife/recover", response_model=RecoveryResponse)
async def recover_endpoint(payload: RecoveryRequest, request: Request):
    if not MYBVLIFE_RECOVERY_ENABLED:
        raise HTTPException(status_code=403, detail="Chức năng đang tạm tắt.")

    ip = _client_ip(request)
    _check_rate_limit(ip)
    result = await recover_mybvlife(payload.full_name, payload.identity_no)
    _masked_logs.append(
        {
            "time": time.time(),
            "ip": ip,
            "masked_identity_no": mask_identity_no(payload.identity_no),
            "response_status": result.get("response_status"),
            "success": result.get("success"),
        }
    )
    return result


@router.get("/api/mybvlife/admin/logs")
async def admin_logs():
    return {"logs": list(reversed(_masked_logs[-100:]))}


@router.delete("/api/mybvlife/admin/logs")
async def clear_admin_logs():
    _masked_logs.clear()
    return {"ok": True}
