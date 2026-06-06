import base64
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

import httpx

from app.mybvlife_recovery.ocr_service import _clean_name, _digits_only

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gpt-4o-mini"
READ_FAILED_MESSAGE = "Không đọc được thông tin CCCD. Vui lòng thử ảnh rõ hơn."
MISSING_BASE_URL_MESSAGE = "Chưa cấu hình AI_API_BASE_URL trên backend."
MISSING_API_KEY_MESSAGE = "Chưa cấu hình AI_API_KEY trên backend."
INVALID_KEY_MESSAGE = "API key không hợp lệ hoặc không có quyền truy cập model."
VISION_UNSUPPORTED_MESSAGE = "Model hiện tại không hỗ trợ đọc ảnh. Vui lòng đổi AI_MODEL sang model vision."
MISSING_SURNAME_WARNING = "Họ tên có thể bị thiếu họ, vui lòng kiểm tra lại."

SYSTEM_PROMPT = (
    "Bạn là hệ thống trích xuất dữ liệu từ ảnh CCCD Việt Nam hoặc ảnh màn hình kết quả quét QR CCCD từ Zalo. "
    "Chỉ trả về JSON hợp lệ, không giải thích."
)

USER_PROMPT = (
    "Hãy đọc ảnh và trích xuất đúng 3 trường: Họ và tên, Số CCCD, Số CMND. "
    'Trả về JSON theo schema: {"fullName":"","cccd":"","cmnd":""}. '
    "Quy tắc: giữ nguyên dấu tiếng Việt của họ tên; không bỏ họ đầu tiên như Nguyễn, Trần, Lê, "
    "Phạm, Hoàng, Huỳnh, Võ, Đặng, Bùi, Đỗ; nếu thấy nhãn Họ và tên, lấy đầy đủ dòng tên ngay bên dưới; "
    "nếu tên bị xuống dòng, ghép đầy đủ các phần của tên; số CCCD và CMND chỉ giữ chữ số; "
    "không lấy ngày sinh, giới tính, địa chỉ, ngày cấp; nếu không thấy trường nào thì để chuỗi rỗng."
)


def _load_dotenv_file(path: Path) -> None:
    if not path.exists():
        return
    try:
        for raw_line in path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
    except Exception as exc:
        logger.warning("Could not read env file %s: %s", path, exc)


def load_ai_config() -> tuple[str, str, str, str | None]:
    backend_dir = Path(__file__).resolve().parents[2]
    root_dir = backend_dir.parent
    _load_dotenv_file(root_dir / ".env")
    _load_dotenv_file(backend_dir / ".env")

    base_url = os.getenv("AI_API_BASE_URL", "").strip().rstrip("/")
    api_key = os.getenv("AI_API_KEY", "").strip()
    model = os.getenv("AI_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL

    if not base_url:
        return "", "", model, MISSING_BASE_URL_MESSAGE
    if not api_key:
        return base_url, "", model, MISSING_API_KEY_MESSAGE
    return base_url, api_key, model, None


def _image_to_data_url(image_path: Path, content_type: str) -> str:
    image_base64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return f"data:{content_type};base64,{image_base64}"


def _build_payload(model: str, image_data_url: str, *, include_response_format: bool) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": USER_PROMPT},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ],
        "temperature": 0,
    }
    if include_response_format:
        payload["response_format"] = {"type": "json_object"}
    return payload


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        data = json.loads(cleaned)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(cleaned[start : end + 1])
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _extract_message_content(api_data: dict[str, Any]) -> str:
    choices = api_data.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        return ""
    content = message.get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        return "\n".join(parts)
    return ""


def normalize_ai_data(data: dict[str, Any]) -> dict[str, str]:
    return {
        "fullName": _clean_name(str(data.get("fullName") or data.get("full_name") or "")),
        "cccd": _digits_only(str(data.get("cccd") or data.get("identity_no") or "")),
        "cmnd": _digits_only(str(data.get("cmnd") or data.get("old_identity_no") or "")),
    }


def validate_ai_data(data: dict[str, str]) -> tuple[bool, list[str]]:
    warnings: list[str] = []
    words = [word for word in data["fullName"].split() if word]
    first_word = words[0].lower() if words else ""

    if not data["fullName"]:
        warnings.append("Không đọc được họ tên, vui lòng nhập thủ công")
    elif len(words) < 2 or re.search(r"\d", data["fullName"]):
        warnings.append("Họ tên không hợp lệ, vui lòng kiểm tra lại")
    elif len(words) == 2 and first_word in {"thị", "thi", "văn", "van", "công", "cong", "thanh", "ngọc", "ngoc"}:
        warnings.append(MISSING_SURNAME_WARNING)

    if len(data["cccd"]) != 12:
        warnings.append("Không đọc được số CCCD/GTTT hợp lệ, vui lòng kiểm tra lại")
    if data["cmnd"] and len(data["cmnd"]) not in (9, 12):
        warnings.append("Số CMND không hợp lệ, vui lòng kiểm tra lại")

    return bool(data["fullName"] and len(data["cccd"]) == 12), warnings


async def _post_ai_request(
    client: httpx.AsyncClient,
    endpoint: str,
    api_key: str,
    payload: dict[str, Any],
) -> httpx.Response:
    return await client.post(
        endpoint,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
    )


def _map_ai_error(status_code: int, body: str) -> str:
    lower_body = body.lower()
    if status_code in (401, 403):
        return INVALID_KEY_MESSAGE
    if "vision" in lower_body or "image" in lower_body or "modal" in lower_body:
        return VISION_UNSUPPORTED_MESSAGE
    return READ_FAILED_MESSAGE


async def ocr_cccd_with_ai_vision(image_path: Path, content_type: str) -> dict[str, Any]:
    base_url, api_key, model, config_error = load_ai_config()
    if config_error:
        return {"ok": False, "source": "ai_vision", "data": {"fullName": "", "cccd": "", "cmnd": ""}, "warnings": [], "message": config_error}

    endpoint = f"{base_url}/chat/completions"
    image_data_url = _image_to_data_url(image_path, content_type)

    async with httpx.AsyncClient(timeout=60) as client:
        payload = _build_payload(model, image_data_url, include_response_format=True)
        try:
            response = await _post_ai_request(client, endpoint, api_key, payload)
            if response.status_code >= 400 and "response_format" in response.text.lower():
                fallback_payload = _build_payload(model, image_data_url, include_response_format=False)
                response = await _post_ai_request(client, endpoint, api_key, fallback_payload)
        except httpx.HTTPError as exc:
            logger.exception("AI Vision request failed: %s", exc)
            return {"ok": False, "source": "ai_vision", "data": {"fullName": "", "cccd": "", "cmnd": ""}, "warnings": [], "message": READ_FAILED_MESSAGE}

    if response.status_code >= 400:
        logger.warning("AI Vision API returned status %s: %s", response.status_code, response.text[:500])
        return {
            "ok": False,
            "source": "ai_vision",
            "data": {"fullName": "", "cccd": "", "cmnd": ""},
            "warnings": [],
            "message": _map_ai_error(response.status_code, response.text),
        }

    try:
        api_data = response.json()
    except json.JSONDecodeError:
        logger.warning("AI Vision API returned non-JSON response")
        return {"ok": False, "source": "ai_vision", "data": {"fullName": "", "cccd": "", "cmnd": ""}, "warnings": [], "message": READ_FAILED_MESSAGE}

    raw_content = _extract_message_content(api_data)
    extracted = _extract_json_object(raw_content)
    if not extracted:
        logger.warning("Could not parse JSON from AI response: %s", raw_content[:500])
        return {"ok": False, "source": "ai_vision", "data": {"fullName": "", "cccd": "", "cmnd": ""}, "warnings": [], "message": "AI trả về dữ liệu không đúng định dạng JSON."}

    normalized = normalize_ai_data(extracted)
    ok, warnings = validate_ai_data(normalized)
    return {
        "ok": ok,
        "source": "ai_vision",
        "data": normalized,
        "warnings": warnings,
        "message": None if ok else READ_FAILED_MESSAGE,
    }
