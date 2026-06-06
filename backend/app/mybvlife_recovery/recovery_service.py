from typing import Any

import httpx

from app.mybvlife_recovery.security_utils import mask_identity_no

MYBVLIFE_URL = "https://mybvlapi.baovietnhantho.com.vn/eposws/api/user/forgotPasswordValid"

HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json;charset=utf-8",
    "Origin": "https://mybvlife.baovietnhantho.com.vn",
    "Referer": "https://mybvlife.baovietnhantho.com.vn/",
    "User-Agent": "Mozilla/5.0",
}


def _get_response_value(raw: dict[str, Any], *keys: str) -> Any:
    lowered = {str(key).lower(): value for key, value in raw.items()}
    for key in keys:
        if key in raw:
            return raw[key]
        value = lowered.get(key.lower())
        if value is not None:
            return value
    return None


def _coerce_response_status(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


async def recover_mybvlife(full_name: str, identity_no: str) -> dict[str, Any]:
    payload = {"strIdenti": identity_no, "strName": full_name}
    masked = mask_identity_no(identity_no)

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(MYBVLIFE_URL, headers=HEADERS, json=payload)
    except httpx.HTTPError:
        return {
            "success": False,
            "http_status": 503,
            "response_status": None,
            "message": "Có lỗi xảy ra, vui lòng thử lại sau.",
            "masked_identity_no": masked,
            "raw": {},
        }

    try:
        raw = response.json() if response.headers.get("content-type", "").lower().startswith("application/json") else {"text": response.text}
    except ValueError:
        raw = {"text": response.text}

    response_status = _coerce_response_status(_get_response_value(raw, "responseStatus", "response_status", "status")) if isinstance(raw, dict) else None
    response_message = _get_response_value(raw, "responseMessage", "response_message", "message") if isinstance(raw, dict) else None

    if response_status == 220:
        success = True
        message = response_message or "Khôi phục thành công."
    elif response_status == 412:
        success = False
        message = response_message or "Không tìm thấy thông tin phù hợp."
    elif response.status_code == 403:
        success = False
        message = response_message or "API MyBVLife đang từ chối truy cập từ môi trường hiện tại (HTTP 403). Vui lòng kiểm tra VPN nội bộ, whitelist IP hoặc quyền tích hợp API."
    else:
        success = False
        message = response_message or f"MyBVLife trả về trạng thái không xác định (HTTP {response.status_code})."

    return {
        "success": success,
        "http_status": response.status_code,
        "response_status": response_status,
        "message": message,
        "masked_identity_no": masked,
        "raw": raw if isinstance(raw, dict) else {},
    }
