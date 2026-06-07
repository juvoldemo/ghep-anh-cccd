import functools
import logging
import os
import re
import shutil
import tempfile
import time
import unicodedata
from pathlib import Path
from typing import Any, Literal, NotRequired, TypedDict

logger = logging.getLogger(__name__)


FULL_NAME_MISSING_WARNING = "Họ tên có thể bị thiếu, vui lòng kiểm tra lại"
READ_FAILED_MESSAGE = "Không đọc được thông tin CCCD. Vui lòng thử ảnh rõ hơn."

LABEL_ALIASES = {
    "cccd": ("so cccd", "cccd", "can cuoc cong dan", "so dinh danh"),
    "cmnd": ("so cmnd", "cmnd", "cmt", "chung minh nhan dan"),
    "full_name": ("ho va ten", "ho ten", "full name"),
}
STOP_NAME_LABELS = (
    "gioi tinh",
    "sex",
    "ngay sinh",
    "date of birth",
    "noi thuong tru",
    "place of residence",
    "dia chi",
    "que quan",
    "quoc tich",
    "nationality",
    "ngay cap",
    "ngay cap cccd",
    "co gia tri den",
    "so cccd",
    "so cmnd",
    "cccd",
    "cmnd",
)
INVALID_NAME_KEYWORDS = (
    "ho va ten",
    "ho ten",
    "thong tin",
    "can cuoc",
    "cong dan",
    "ngay sinh",
    "ngay cap",
    "gioi tinh",
    "noi thuong tru",
    "thuong tru",
    "chia se",
    "zalo",
    "cccd",
    "cmnd",
)
COMMON_VIETNAMESE_SURNAMES = {
    "nguyen",
    "tran",
    "le",
    "pham",
    "hoang",
    "huynh",
    "phan",
    "vu",
    "vo",
    "do",
    "dang",
    "bui",
    "truong",
    "duong",
    "dinh",
    "ngo",
    "ho",
    "ly",
    "lam",
    "mai",
    "trinh",
    "dao",
    "cao",
    "chau",
    "ta",
    "ha",
    "luu",
    "mac",
    "tong",
}
COMMON_MIDDLE_NAME_KEYS = {"thi", "van", "huu", "duc", "dinh", "ngoc", "quoc"}


class ParsedData(TypedDict):
    fullName: str
    cccd: str
    cmnd: str


class OcrToken(TypedDict):
    text: str
    x1: float
    y1: float
    x2: float
    y2: float
    cx: float
    cy: float


class OcrResult(TypedDict):
    ok: bool
    source: Literal["qr", "ocr", "cropped_field_ocr"]
    data: ParsedData
    warnings: list[str]
    message: str | None
    confidence: NotRequired[dict[str, float]]
    method: NotRequired[Literal["qr", "cropped_field_ocr", "full_image_fallback_ocr"]]
    processing_time_ms: NotRequired[int]
    debug_timing: NotRequired[dict[str, int]]


class FieldOcrResult(TypedDict):
    text: str
    confidence: float


ZALO_CARD_CROP = {"x1": 0.04, "y1": 0.18, "x2": 0.96, "y2": 0.68}
ZALO_FIELD_CROPS = {
    "identity_no": {"x1": 0.055, "y1": 0.168, "x2": 0.52, "y2": 0.200},
    "old_id_no": {"x1": 0.055, "y1": 0.236, "x2": 0.46, "y2": 0.260},
    "full_name": {"x1": 0.055, "y1": 0.296, "x2": 0.68, "y2": 0.320},
}
MAX_OCR_IMAGE_WIDTH = 900
LOW_CONFIDENCE_WARNING = "OCR chá»‰ há»— trá»£ Ä‘iá»n nhanh. Vui lÃ²ng kiá»ƒm tra ká»¹ há» tÃªn, sá»‘ CCCD vÃ  sá»‘ CMND trÆ°á»›c khi gá»­i."
NAME_UNCERTAIN_WARNING = "Há» tÃªn cÃ³ thá»ƒ chÆ°a chÃ­nh xÃ¡c dáº¥u tiáº¿ng Viá»‡t, vui lÃ²ng kiá»ƒm tra láº¡i."


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    without_marks = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return without_marks.replace("đ", "d").replace("Đ", "D").lower()


def _clean_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _digits_only(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def _normalize_ocr_number(value: str) -> str:
    replacements = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1", "|": "1", "S": "5", "s": "5", "B": "8"})
    return _digits_only((value or "").translate(replacements))


def _clean_name(value: str) -> str:
    value = re.sub(r"^[\s:,\-–—]+|[\s:,\-–—]+$", "", value or "")
    return _normalize_vietnamese_middle_name(_clean_spaces(value))


def _match_name_case(source: str, replacement: str) -> str:
    if source.isupper():
        return replacement.upper()
    if source[:1].isupper():
        return replacement
    return replacement.lower()


def _normalize_vietnamese_middle_name(value: str) -> str:
    words = value.split()
    if len(words) < 3:
        return value

    middle_name_map = {
        "thi": "Thị",
        "van": "Văn",
        "huu": "Hữu",
        "duc": "Đức",
        "dinh": "Đình",
        "ngoc": "Ngọc",
        "quoc": "Quốc",
    }

    normalized_words: list[str] = []
    for index, word in enumerate(words):
        key = re.sub(r"[^a-zA-Z]", "", _strip_accents(word).replace("đ", "d"))
        if 0 < index < len(words) - 1 and key in middle_name_map:
            normalized_words.append(_match_name_case(word, middle_name_map[key]))
        else:
            normalized_words.append(word)
    return " ".join(normalized_words)


def _empty_data() -> ParsedData:
    return {"fullName": "", "cccd": "", "cmnd": ""}


@functools.lru_cache(maxsize=1)
def _get_easyocr_reader() -> Any:
    import easyocr  # type: ignore

    return easyocr.Reader(["vi", "en"], gpu=False)


@functools.lru_cache(maxsize=1)
def _get_paddleocr_reader() -> Any:
    from paddleocr import PaddleOCR  # type: ignore

    try:
        return PaddleOCR(use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False, lang="vi")
    except TypeError:
        return PaddleOCR(use_angle_cls=False, lang="vi", show_log=False)


def _token_from_box(text: str, box: Any) -> OcrToken | None:
    try:
        xs = [float(point[0]) for point in box]
        ys = [float(point[1]) for point in box]
    except Exception:
        return None
    x1, x2 = min(xs), max(xs)
    y1, y2 = min(ys), max(ys)
    return {
        "text": text,
        "x1": x1,
        "y1": y1,
        "x2": x2,
        "y2": y2,
        "cx": (x1 + x2) / 2,
        "cy": (y1 + y2) / 2,
    }


def _extract_easyocr_tokens_from_image(image: Any) -> list[OcrToken]:
    reader = _get_easyocr_reader()
    result = reader.readtext(image, detail=1, paragraph=False, decoder="greedy", width_ths=1.0, text_threshold=0.45)
    tokens: list[OcrToken] = []
    for item in result or []:
        try:
            box, text, _confidence = item
        except Exception:
            continue
        cleaned = _clean_spaces(str(text))
        if not cleaned:
            continue
        token = _token_from_box(cleaned, box)
        if token:
            tokens.append(token)
    return tokens


def _extract_easyocr_from_image(image: Any) -> list[str]:
    return [token["text"] for token in _extract_easyocr_tokens_from_image(image)]


def _extract_easyocr(image_path: Path) -> list[str]:
    return _extract_easyocr_from_image(str(image_path))


def _extract_paddleocr(image_path: Path) -> list[str]:
    ocr = _get_paddleocr_reader()
    try:
        result = ocr.predict(str(image_path))
    except AttributeError:
        result = ocr.ocr(str(image_path), cls=False)
    if result and isinstance(result[0], dict):
        return [_clean_spaces(str(text)) for page in result for text in (page.get("rec_texts") or []) if _clean_spaces(str(text))]
    lines: list[str] = []
    for page in result or []:
        for item in page or []:
            text = item[1][0] if item and len(item) > 1 else ""
            if text:
                lines.append(str(text).strip())
    return lines


def _extract_paddleocr_tokens(image_path: Path) -> list[OcrToken]:
    ocr = _get_paddleocr_reader()
    try:
        result = ocr.predict(str(image_path))
    except AttributeError:
        result = ocr.ocr(str(image_path), cls=False)
    return _paddle_result_to_tokens(result)


def _paddle_result_to_tokens(result: Any) -> list[OcrToken]:
    tokens: list[OcrToken] = []
    if result and isinstance(result[0], dict):
        for page in result:
            texts = page.get("rec_texts") or []
            boxes = page.get("rec_polys") or page.get("dt_polys") or []
            for text, box in zip(texts, boxes):
                cleaned = _clean_spaces(str(text))
                if not cleaned:
                    continue
                token = _token_from_box(cleaned, box)
                if token:
                    tokens.append(token)
        return tokens

    for page in result or []:
        for item in page or []:
            if not item or len(item) < 2:
                continue
            box = item[0]
            text = item[1][0] if item[1] and len(item[1]) > 0 else ""
            cleaned = _clean_spaces(str(text))
            if not cleaned:
                continue
            token = _token_from_box(cleaned, box)
            if token:
                tokens.append(token)
    return tokens


def _extract_paddleocr_field(image: Any) -> FieldOcrResult:
    ocr = _get_paddleocr_reader()

    def parse_result(result: Any) -> FieldOcrResult:
        texts: list[str] = []
        confidences: list[float] = []
        if result and isinstance(result[0], dict):
            for page in result:
                for text, confidence in zip(page.get("rec_texts") or [], page.get("rec_scores") or []):
                    cleaned = _clean_spaces(str(text))
                    if cleaned:
                        texts.append(cleaned)
                        try:
                            confidences.append(float(confidence))
                        except Exception:
                            pass
            return {"text": _clean_spaces(" ".join(texts)), "confidence": sum(confidences) / len(confidences) if confidences else 0.0}

        for page in result or []:
            for item in page or []:
                if not item or len(item) < 2:
                    continue
                text = item[1][0] if item[1] and len(item[1]) > 0 else ""
                confidence = item[1][1] if item[1] and len(item[1]) > 1 else 0.0
                cleaned = _clean_spaces(str(text))
                if cleaned:
                    texts.append(cleaned)
                    try:
                        confidences.append(float(confidence))
                    except Exception:
                        pass
        return {"text": _clean_spaces(" ".join(texts)), "confidence": sum(confidences) / len(confidences) if confidences else 0.0}

    parsed: FieldOcrResult = {"text": "", "confidence": 0.0}
    try:
        try:
            result = ocr.predict(image)
        except AttributeError:
            result = ocr.ocr(image, cls=False)
        parsed = parse_result(result)
    except Exception as exc:
        logger.warning("PaddleOCR direct field read failed: %s", exc)
    if parsed["text"] or isinstance(image, (str, Path)):
        return parsed

    try:
        import cv2  # type: ignore

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as temp_file:
            temp_path = Path(temp_file.name)
        try:
            cv2.imwrite(str(temp_path), image)
            try:
                file_result = ocr.predict(str(temp_path))
            except AttributeError:
                file_result = ocr.ocr(str(temp_path), cls=False)
            return parse_result(file_result)
        finally:
            temp_path.unlink(missing_ok=True)
    except Exception as exc:
        logger.warning("PaddleOCR file fallback failed: %s", exc)
        return parsed


def _extract_easyocr_field(image: Any) -> FieldOcrResult:
    reader = _get_easyocr_reader()
    result = reader.readtext(image, detail=1, paragraph=False, decoder="greedy", width_ths=1.0, text_threshold=0.45)
    texts: list[str] = []
    confidences: list[float] = []
    for item in result or []:
        try:
            _box, text, confidence = item
        except Exception:
            continue
        cleaned = _clean_spaces(str(text))
        if cleaned:
            texts.append(cleaned)
            try:
                confidences.append(float(confidence))
            except Exception:
                pass
    return {"text": _clean_spaces(" ".join(texts)), "confidence": sum(confidences) / len(confidences) if confidences else 0.0}


def _read_text(image_path: Path) -> list[str]:
    lines, _tokens = _read_text_and_tokens(image_path)
    return lines


def _read_text_and_tokens(image_path: Path) -> tuple[list[str], list[OcrToken]]:
    lines: list[str] = []
    tokens: list[OcrToken] = []
    try:
        paddle_tokens = _extract_paddleocr_tokens(image_path)
        tokens.extend(paddle_tokens)
        lines.extend(token["text"] for token in paddle_tokens)
        if _has_confident_ocr_data(lines, tokens):
            return _dedupe_lines(lines), _dedupe_tokens(tokens)
    except Exception:
        pass

    for variant in _build_ocr_image_variants(image_path):
        try:
            variant_tokens = _extract_easyocr_tokens_from_image(variant)
            tokens.extend(variant_tokens)
            lines.extend(token["text"] for token in variant_tokens)
            if _has_confident_ocr_data(lines, tokens):
                return _dedupe_lines(lines), _dedupe_tokens(tokens)
        except Exception:
            pass

    if not lines:
        try:
            fallback_tokens = _extract_easyocr_tokens_from_image(str(image_path))
            tokens.extend(fallback_tokens)
            lines.extend(token["text"] for token in fallback_tokens)
        except Exception:
            pass

    return _dedupe_lines(lines), _dedupe_tokens(tokens)


def _has_confident_ocr_lines(lines: list[str]) -> bool:
    data = _parse_ocr_lines(lines)
    return bool(data["cccd"] and len(data["fullName"].split()) >= 3)


def _has_confident_ocr_data(lines: list[str], tokens: list[OcrToken]) -> bool:
    data = _parse_ocr_data(lines, tokens)
    return bool(data["cccd"] and len(data["fullName"].split()) >= 3)


def _dedupe_lines(lines: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for line in lines:
        cleaned = _clean_spaces(str(line))
        if not cleaned:
            continue
        key = _strip_accents(cleaned)
        if key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
    return result


def _dedupe_tokens(tokens: list[OcrToken]) -> list[OcrToken]:
    result: list[OcrToken] = []
    seen: set[tuple[str, int, int]] = set()
    for token in tokens:
        key = (_strip_accents(token["text"]), round(token["cx"] / 8), round(token["cy"] / 8))
        if key in seen:
            continue
        seen.add(key)
        result.append(token)
    return result


def _build_ocr_image_variants(image_path: Path) -> list[Any]:
    try:
        import cv2  # type: ignore
    except Exception:
        return [str(image_path)]

    image = cv2.imread(str(image_path))
    if image is None:
        return [str(image_path)]

    variants: list[Any] = []

    def add_variant(candidate: Any) -> None:
        if candidate is not None:
            variants.append(candidate)

    def scaled(candidate: Any, target_width: int) -> Any:
        height, width = candidate.shape[:2]
        if not width:
            return candidate
        scale = max(1.0, target_width / width)
        return cv2.resize(candidate, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

    base = scaled(image, 1100)
    add_variant(base)

    height, width = base.shape[:2]
    if height and width:
        # Zalo CCCD screenshots usually place the data card around the center.
        add_variant(base[max(0, int(height * 0.08)) : int(height * 0.88), max(0, int(width * 0.12)) : int(width * 0.88)])

    for candidate in list(variants):
        gray = cv2.cvtColor(candidate, cv2.COLOR_BGR2GRAY) if len(candidate.shape) == 3 else candidate
        clahe = cv2.createCLAHE(clipLimit=2.6, tileGridSize=(8, 8)).apply(gray)
        sharpened = cv2.addWeighted(clahe, 1.7, cv2.GaussianBlur(clahe, (0, 0), 1.2), -0.7, 0)
        add_variant(clahe)
        add_variant(sharpened)

    return variants[:6]


def _ratio_crop(image: Any, crop_config: dict[str, float], expand: float = 0.0) -> Any:
    height, width = image.shape[:2]
    x1 = max(0, int((crop_config["x1"] - expand) * width))
    y1 = max(0, int((crop_config["y1"] - expand) * height))
    x2 = min(width, int((crop_config["x2"] + expand) * width))
    y2 = min(height, int((crop_config["y2"] + expand) * height))
    return image[y1:y2, x1:x2]


def _resize_for_fast_ocr(image: Any) -> Any:
    import cv2  # type: ignore

    height, width = image.shape[:2]
    if not width or width <= MAX_OCR_IMAGE_WIDTH:
        return image
    scale = MAX_OCR_IMAGE_WIDTH / width
    return cv2.resize(image, (MAX_OCR_IMAGE_WIDTH, max(1, int(height * scale))), interpolation=cv2.INTER_AREA)


def detect_zalo_cccd_layout(image: Any) -> Any:
    try:
        import cv2  # type: ignore
    except Exception:
        return _ratio_crop(image, ZALO_CARD_CROP)

    height, width = image.shape[:2]
    if not height or not width:
        return image

    search = image[int(height * 0.12) : int(height * 0.78), int(width * 0.02) : int(width * 0.98)]
    gray = cv2.cvtColor(search, cv2.COLOR_BGR2GRAY) if len(search.shape) == 3 else search
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _threshold, binary = cv2.threshold(blurred, 185, 255, cv2.THRESH_BINARY)
    contours, _hierarchy = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates: list[tuple[int, int, int, int, float]] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = w * h
        if area < width * height * 0.08:
            continue
        if w < width * 0.55 or h < height * 0.20:
            continue
        candidates.append((x, y, w, h, area))

    if not candidates:
        return _ratio_crop(image, ZALO_CARD_CROP)

    x, y, w, h, _area = sorted(candidates, key=lambda item: item[4], reverse=True)[0]
    x += int(width * 0.02)
    y += int(height * 0.12)
    pad_x = int(width * 0.015)
    pad_y = int(height * 0.01)
    return image[max(0, y - pad_y) : min(height, y + h + pad_y), max(0, x - pad_x) : min(width, x + w + pad_x)]


def crop_zalo_fields(image: Any, expand: float = 0.0) -> dict[str, Any]:
    return {
        "identity_no_crop": _ratio_crop(image, ZALO_FIELD_CROPS["identity_no"], expand),
        "old_id_no_crop": _ratio_crop(image, ZALO_FIELD_CROPS["old_id_no"], expand),
        "full_name_crop": _ratio_crop(image, ZALO_FIELD_CROPS["full_name"], expand),
    }


def preprocess_crop_for_ocr(crop: Any) -> Any:
    import cv2  # type: ignore

    if crop is None or not getattr(crop, "size", 0):
        return crop
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if len(crop.shape) == 3 else crop
    resized = cv2.resize(gray, None, fx=2, fy=2, interpolation=cv2.INTER_LINEAR)
    enhanced = cv2.convertScaleAbs(resized, alpha=1.18, beta=4)
    return cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)


def _strip_field_label(value: str) -> str:
    labels = (
        "ho va ten",
        "ho ten",
        "full name",
        "so cccd",
        "cccd",
        "so cmnd",
        "cmnd",
    )
    cleaned = _clean_spaces(value)
    normalized = _strip_accents(cleaned)
    for label in labels:
        position = normalized.find(label)
        if position >= 0:
            cleaned = cleaned[position + len(label) :].lstrip(" :,-â€“â€”")
            normalized = _strip_accents(cleaned)
    return _clean_spaces(cleaned)


def _repair_common_name_ocr(value: str) -> str:
    words = _clean_spaces(value).split()
    repaired: list[str] = []
    for word in words:
        key = _normalized_word(word)
        if key in {"nguyn", "nguyen"}:
            repaired.append(_match_name_case(word, "Nguyễn"))
        elif key in {"th", "thi"}:
            repaired.append(_match_name_case(word, "Thị"))
        else:
            repaired.append(word)
    return _clean_spaces(" ".join(repaired))


def _normalize_field_text(raw_text: str, field_type: Literal["identity_no", "old_id_no", "full_name"]) -> str:
    if field_type == "identity_no":
        digits = _normalize_ocr_number(_strip_field_label(raw_text))
        return digits if len(digits) == 12 else digits[:12]
    if field_type == "old_id_no":
        digits = _normalize_ocr_number(_strip_field_label(raw_text))
        return digits if len(digits) in (0, 9, 12) else digits[:12]
    return _clean_name(_repair_common_name_ocr(_strip_field_label(raw_text)))


def ocr_single_field(crop: Any, field_type: Literal["identity_no", "old_id_no", "full_name"]) -> FieldOcrResult:
    prepared = preprocess_crop_for_ocr(crop)
    best: FieldOcrResult = {"text": "", "confidence": 0.0}

    try:
        best = _extract_paddleocr_field(prepared)
    except Exception as exc:
        logger.warning("PaddleOCR field read failed for %s: %s", field_type, exc)

    if not best["text"]:
        try:
            best = _extract_easyocr_field(prepared)
        except Exception as exc:
            logger.warning("EasyOCR field read failed for %s: %s", field_type, exc)

    return {"text": _normalize_field_text(best["text"], field_type), "confidence": round(float(best["confidence"] or 0.0), 4)}


def _field_is_valid(field_type: Literal["identity_no", "old_id_no", "full_name"], result: FieldOcrResult) -> bool:
    text = result["text"]
    if field_type == "identity_no":
        return len(text) == 12
    if field_type == "old_id_no":
        return not text or len(text) in (9, 12)
    return _has_usable_name(text)


def _has_usable_name(value: str) -> bool:
    cleaned = _clean_spaces(value)
    normalized = _strip_accents(cleaned)
    return bool(cleaned and not re.search(r"\d", cleaned) and not _is_any_stop_label(cleaned) and not any(keyword in normalized for keyword in INVALID_NAME_KEYWORDS))


def _has_required_cropped_data(data: ParsedData) -> bool:
    return bool(len(data["cccd"]) == 12 and _has_usable_name(data["fullName"]))


def _save_debug_crops(crops: dict[str, Any], debug_dir: Path = Path("tmp_debug")) -> None:
    if os.getenv("SHOW_OCR_DEBUG", "").lower() not in {"1", "true", "yes"}:
        return
    try:
        import cv2  # type: ignore

        debug_dir.mkdir(parents=True, exist_ok=True)
        for name, crop in crops.items():
            cv2.imwrite(str(debug_dir / f"{name}.png"), crop)
    except Exception:
        pass


def _read_cropped_fields(image_path: Path) -> tuple[ParsedData, dict[str, float], list[str], bool, dict[str, int]]:
    import cv2  # type: ignore

    timing = {
        "resize_time_ms": 0,
        "crop_time_ms": 0,
        "ocr_cccd_time_ms": 0,
        "ocr_cmnd_time_ms": 0,
        "ocr_name_time_ms": 0,
        "fallback_time_ms": 0,
    }
    image = cv2.imread(str(image_path))
    if image is None:
        return _empty_data(), {"fullName": 0.0, "cccd": 0.0, "cmnd": 0.0}, ["KhÃ´ng thá»ƒ má»Ÿ áº£nh Ä‘á»ƒ OCR."], False

    started = time.perf_counter()
    image = _resize_for_fast_ocr(image)
    timing["resize_time_ms"] = round((time.perf_counter() - started) * 1000)

    started = time.perf_counter()
    crops = crop_zalo_fields(image)
    timing["crop_time_ms"] = round((time.perf_counter() - started) * 1000)
    if os.getenv("SHOW_OCR_DEBUG", "").lower() in {"1", "true", "yes"}:
        shutil.rmtree("tmp_debug", ignore_errors=True)
    _save_debug_crops(crops)
    started = time.perf_counter()
    identity_result = ocr_single_field(crops["identity_no_crop"], "identity_no")
    timing["ocr_cccd_time_ms"] = round((time.perf_counter() - started) * 1000)

    started = time.perf_counter()
    old_id_result = ocr_single_field(crops["old_id_no_crop"], "old_id_no")
    timing["ocr_cmnd_time_ms"] = round((time.perf_counter() - started) * 1000)

    started = time.perf_counter()
    name_result = ocr_single_field(crops["full_name_crop"], "full_name")
    timing["ocr_name_time_ms"] = round((time.perf_counter() - started) * 1000)

    results = {
        "identity_no": identity_result,
        "old_id_no": old_id_result,
        "full_name": name_result,
    }

    missing_identity = not _field_is_valid("identity_no", results["identity_no"])
    missing_name = not _field_is_valid("full_name", results["full_name"])
    if missing_identity or missing_name:
        started = time.perf_counter()
        expanded_crops = crop_zalo_fields(image, expand=0.05)
        timing["crop_time_ms"] += round((time.perf_counter() - started) * 1000)
        _save_debug_crops({f"expanded_{key}": value for key, value in expanded_crops.items()})
        if missing_identity:
            started = time.perf_counter()
            retry_identity = ocr_single_field(expanded_crops["identity_no_crop"], "identity_no")
            timing["ocr_cccd_time_ms"] += round((time.perf_counter() - started) * 1000)
            if _field_is_valid("identity_no", retry_identity) or retry_identity["confidence"] > results["identity_no"]["confidence"]:
                results["identity_no"] = retry_identity
        if missing_name:
            started = time.perf_counter()
            retry_name = ocr_single_field(expanded_crops["full_name_crop"], "full_name")
            timing["ocr_name_time_ms"] += round((time.perf_counter() - started) * 1000)
            if _field_is_valid("full_name", retry_name) or retry_name["confidence"] > results["full_name"]["confidence"]:
                results["full_name"] = retry_name

    data: ParsedData = {
        "fullName": results["full_name"]["text"],
        "cccd": results["identity_no"]["text"] if len(results["identity_no"]["text"]) == 12 else "",
        "cmnd": results["old_id_no"]["text"] if len(results["old_id_no"]["text"]) in (9, 12) else "",
    }
    confidence = {
        "fullName": results["full_name"]["confidence"],
        "cccd": results["identity_no"]["confidence"],
        "cmnd": results["old_id_no"]["confidence"] if data["cmnd"] else 0.0,
    }

    warnings = _validate_data(data)
    if data["fullName"] and confidence["fullName"] < 0.9:
        warnings.append(NAME_UNCERTAIN_WARNING)
    if any(value and value < 0.75 for value in confidence.values()):
        warnings.append(LOW_CONFIDENCE_WARNING)

    logger.debug("MyBVLife cropped OCR timing: %s", timing)
    return data, confidence, warnings, _has_required_cropped_data(data), timing


def _decode_qr_with_opencv(image_path: Path) -> str:
    try:
        import cv2  # type: ignore
    except Exception:
        return ""

    image = cv2.imread(str(image_path))
    if image is None:
        return ""

    detector = cv2.QRCodeDetector()
    variants = [image]
    height, width = image.shape[:2]

    if width and height:
        for target in (1200, 1800, 2400):
            scale = target / max(width, height)
            if scale > 1.05:
                variants.append(cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC))

    prepared = []
    for variant in variants:
        prepared.append(variant)
        gray = cv2.cvtColor(variant, cv2.COLOR_BGR2GRAY)
        prepared.extend(
            [
                gray,
                cv2.equalizeHist(gray),
                cv2.GaussianBlur(gray, (3, 3), 0),
                cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 2),
            ]
        )

    for variant in prepared:
        try:
            text, _, _ = detector.detectAndDecode(variant)
            if text:
                return text.strip()
        except Exception:
            pass

        try:
            ok, decoded, _, _ = detector.detectAndDecodeMulti(variant)
            if ok:
                for text in decoded:
                    if text:
                        return str(text).strip()
        except Exception:
            pass

    return ""


def _parse_cccd_qr(qr_text: str) -> ParsedData:
    if not qr_text:
        return _empty_data()

    parts = [_clean_spaces(part) for part in qr_text.split("|")]
    cccd = _digits_only(parts[0]) if len(parts) > 0 else ""
    cmnd = _digits_only(parts[1]) if len(parts) > 1 else ""
    full_name = _clean_name(parts[2]) if len(parts) > 2 else ""

    return {
        "fullName": full_name,
        "cccd": cccd if len(cccd) == 12 else "",
        "cmnd": cmnd if len(cmnd) in (9, 12) else "",
    }


def _normalize_lines(lines: list[str]) -> list[str]:
    normalized: list[str] = []
    for line in lines:
        cleaned = _clean_spaces(str(line).replace("\t", " "))
        if cleaned:
            normalized.append(cleaned)
    return normalized


def _line_has_label(line: str, aliases: tuple[str, ...]) -> bool:
    normalized = _strip_accents(line)
    return any(alias in normalized for alias in aliases)


def _remove_label_prefix(line: str, aliases: tuple[str, ...]) -> str:
    normalized = _strip_accents(line)
    best: tuple[int, int] | None = None
    for alias in aliases:
        position = normalized.find(alias)
        if position < 0:
            continue
        end = position + len(alias)
        if best is None or position < best[0]:
            best = (position, end)

    if best is None:
        return line

    _, end = best
    return line[end:].lstrip(" :,-–—")


def _is_any_stop_label(line: str) -> bool:
    normalized = _strip_accents(line)
    return any(label in normalized for label in STOP_NAME_LABELS)


def _normalized_word(value: str) -> str:
    return re.sub(r"[^a-z]", "", _strip_accents(value).replace("đ", "d"))


def _starts_with_middle_name(value: str) -> bool:
    words = _clean_spaces(value).split()
    return bool(words and _normalized_word(words[0]) in COMMON_MIDDLE_NAME_KEYS)


def _looks_like_person_name(value: str) -> bool:
    cleaned = _clean_spaces(value)
    normalized = _strip_accents(cleaned)
    words = cleaned.split()
    if len(words) < 2 or len(words) > 6:
        return False
    if _starts_with_middle_name(cleaned):
        return False
    if re.search(r"\d", cleaned):
        return False
    if any(keyword in normalized for keyword in INVALID_NAME_KEYWORDS):
        return False

    first_word = _normalized_word(words[0])
    if first_word not in COMMON_VIETNAMESE_SURNAMES:
        return False

    return all(re.search(r"[A-Za-zÀ-ỹĐđ]", word) for word in words)


def _next_non_empty_lines(lines: list[str], start: int, limit: int) -> list[str]:
    result: list[str] = []
    for line in lines[start : start + limit]:
        if line.strip():
            result.append(line)
    return result


def _extract_number_after_label(lines: list[str], label_key: Literal["cccd", "cmnd"], valid_lengths: tuple[int, ...]) -> str:
    aliases = LABEL_ALIASES[label_key]
    for index, line in enumerate(lines):
        if not _line_has_label(line, aliases):
            continue

        same_line = _digits_only(_remove_label_prefix(line, aliases))
        if len(same_line) in valid_lengths:
            return same_line

        for candidate in _next_non_empty_lines(lines, index + 1, 4):
            if _is_any_stop_label(candidate) and not re.search(r"\d", candidate):
                break
            digits = _digits_only(candidate)
            if len(digits) in valid_lengths:
                return digits

    return ""


def _extract_full_name_after_label(lines: list[str]) -> str:
    aliases = LABEL_ALIASES["full_name"]
    candidates: list[str] = []
    for index, line in enumerate(lines):
        if not _line_has_label(line, aliases):
            continue

        pieces: list[str] = []
        same_line = _clean_name(_remove_label_prefix(line, aliases))
        if same_line and not re.search(r"\d", same_line) and not _is_any_stop_label(same_line):
            pieces.append(same_line)

        for candidate in _next_non_empty_lines(lines, index + 1, 6):
            if _is_any_stop_label(candidate):
                break
            if re.search(r"\d", candidate):
                break

            cleaned = _clean_name(candidate)
            if cleaned:
                pieces.append(cleaned)

        full_name = _clean_name(" ".join(pieces))
        if full_name and _looks_like_person_name(full_name):
            candidates.append(full_name)

    if not candidates:
        candidates = [_clean_name(line) for line in lines if _looks_like_person_name(_clean_name(line))]
    if not candidates:
        return ""

    return sorted(candidates, key=lambda value: (len(value.split()), len(value)), reverse=True)[0]


def _group_tokens_into_lines(tokens: list[OcrToken]) -> list[OcrToken]:
    sorted_tokens = sorted(tokens, key=lambda token: (token["cy"], token["x1"]))
    grouped: list[list[OcrToken]] = []
    for token in sorted_tokens:
        token_height = max(8.0, token["y2"] - token["y1"])
        if not grouped:
            grouped.append([token])
            continue

        current = grouped[-1]
        current_cy = sum(item["cy"] for item in current) / len(current)
        if abs(token["cy"] - current_cy) <= token_height * 0.7:
            current.append(token)
        else:
            grouped.append([token])

    line_tokens: list[OcrToken] = []
    for group in grouped:
        ordered = sorted(group, key=lambda token: token["x1"])
        text = _clean_spaces(" ".join(token["text"] for token in ordered))
        if not text:
            continue
        x1 = min(token["x1"] for token in ordered)
        y1 = min(token["y1"] for token in ordered)
        x2 = max(token["x2"] for token in ordered)
        y2 = max(token["y2"] for token in ordered)
        line_tokens.append(
            {
                "text": text,
                "x1": x1,
                "y1": y1,
                "x2": x2,
                "y2": y2,
                "cx": (x1 + x2) / 2,
                "cy": (y1 + y2) / 2,
            }
        )
    return line_tokens


def _try_prepend_left_surname(text: str, line: OcrToken, tokens: list[OcrToken]) -> str:
    cleaned = _clean_name(text)
    if not _starts_with_middle_name(cleaned):
        return cleaned

    line_height = max(12.0, line["y2"] - line["y1"])
    left_candidates = [
        token
        for token in tokens
        if token["text"] not in cleaned
        and token["x2"] <= line["x1"] + 8
        and 0 <= line["x1"] - token["x2"] <= 180
        and abs(token["cy"] - line["cy"]) <= line_height * 1.35
        and _normalized_word(token["text"]) in COMMON_VIETNAMESE_SURNAMES
    ]
    if not left_candidates:
        return cleaned

    surname = sorted(left_candidates, key=lambda token: (abs(token["cy"] - line["cy"]), line["x1"] - token["x2"]))[0]["text"]
    return _clean_name(f"{surname} {cleaned}")


def _extract_full_name_by_position(tokens: list[OcrToken]) -> str:
    lines = _group_tokens_into_lines(tokens)
    aliases = LABEL_ALIASES["full_name"]
    candidates: list[tuple[float, str]] = []

    for index, line in enumerate(lines):
        if not _line_has_label(line["text"], aliases):
            continue

        same_line = _clean_name(_remove_label_prefix(line["text"], aliases))
        if _looks_like_person_name(same_line):
            candidates.append((0, same_line))

        label_height = max(12.0, line["y2"] - line["y1"])
        max_y = line["y2"] + label_height * 6.5
        for next_line in lines[index + 1 :]:
            if next_line["y1"] < line["y1"]:
                continue
            if next_line["y1"] > max_y:
                break

            text = _try_prepend_left_surname(next_line["text"], next_line, tokens)
            if _is_any_stop_label(text):
                break
            if re.search(r"\d", text):
                break
            if _looks_like_person_name(text):
                distance = max(0.0, next_line["y1"] - line["y2"])
                candidates.append((distance, text))
                break

    if not candidates:
        return ""
    return sorted(candidates, key=lambda item: (item[0], -len(item[1].split()), -len(item[1])))[0][1]


def _parse_ocr_data(lines: list[str], tokens: list[OcrToken]) -> ParsedData:
    parsed = _parse_ocr_lines(lines)
    spatial_name = _extract_full_name_by_position(tokens)
    if spatial_name:
        parsed["fullName"] = spatial_name
    return parsed


def _parse_ocr_lines(lines: list[str]) -> ParsedData:
    normalized_lines = _normalize_lines(lines)
    return {
        "fullName": _extract_full_name_after_label(normalized_lines),
        "cccd": _extract_number_after_label(normalized_lines, "cccd", (12,)),
        "cmnd": _extract_number_after_label(normalized_lines, "cmnd", (9, 12)),
    }


def _validate_data(data: ParsedData) -> list[str]:
    warnings: list[str] = []
    full_name = data["fullName"]
    words = [word for word in full_name.split(" ") if word]

    if data["cccd"] and len(data["cccd"]) != 12:
        warnings.append("Số CCCD/GTTT không đủ 12 chữ số, vui lòng kiểm tra lại")
    if data["cmnd"] and len(data["cmnd"]) not in (9, 12):
        warnings.append("Số CMND không hợp lệ, vui lòng kiểm tra lại")
    if not full_name:
        warnings.append("Không đọc được họ tên, vui lòng nhập thủ công")
    elif len(words) < 2 or re.search(r"\d", full_name):
        warnings.append("Họ tên không hợp lệ, vui lòng kiểm tra lại")
    elif len(words) == 2:
        warnings.append(FULL_NAME_MISSING_WARNING)
    elif not _looks_like_person_name(full_name):
        warnings.append("Họ tên không hợp lệ, vui lòng kiểm tra lại")

    if not data["cccd"]:
        warnings.append("Không đọc được số CCCD/GTTT, vui lòng kiểm tra lại")

    return warnings


def _has_minimum_data(data: ParsedData) -> bool:
    return bool(data["cccd"] and _looks_like_person_name(data["fullName"]))


def ocr_cccd(image_path: Path) -> OcrResult:
    request_started = time.perf_counter()
    debug_timing = {
        "resize_time_ms": 0,
        "crop_time_ms": 0,
        "ocr_cccd_time_ms": 0,
        "ocr_cmnd_time_ms": 0,
        "ocr_name_time_ms": 0,
        "fallback_time_ms": 0,
    }
    qr_text = _decode_qr_with_opencv(image_path)
    qr_data = _parse_cccd_qr(qr_text)

    if _has_minimum_data(qr_data):
        warnings = _validate_data(qr_data)
        processing_time_ms = round((time.perf_counter() - request_started) * 1000)
        return {
            "ok": True,
            "source": "qr",
            "data": qr_data,
            "warnings": warnings,
            "message": None,
            "confidence": {"fullName": 1.0, "cccd": 1.0, "cmnd": 1.0 if qr_data["cmnd"] else 0.0},
            "method": "qr",
            "processing_time_ms": processing_time_ms,
            "debug_timing": debug_timing,
        }

    try:
        cropped_data, cropped_confidence, cropped_warnings, cropped_ok, debug_timing = _read_cropped_fields(image_path)
        if cropped_ok:
            processing_time_ms = round((time.perf_counter() - request_started) * 1000)
            logger.debug("MyBVLife OCR finished with cropped fields in %sms; timing=%s", processing_time_ms, debug_timing)
            return {
                "ok": True,
                "source": "cropped_field_ocr",
                "data": cropped_data,
                "warnings": cropped_warnings,
                "message": None,
                "confidence": cropped_confidence,
                "method": "cropped_field_ocr",
                "processing_time_ms": processing_time_ms,
                "debug_timing": debug_timing,
            }
    except Exception:
        cropped_data = _empty_data()
        cropped_confidence = {"fullName": 0.0, "cccd": 0.0, "cmnd": 0.0}
        cropped_warnings = []

    fallback_started = time.perf_counter()
    lines, tokens = _read_text_and_tokens(image_path)
    debug_timing["fallback_time_ms"] = round((time.perf_counter() - fallback_started) * 1000)
    ocr_data = _parse_ocr_data(lines, tokens)
    warnings = _validate_data(ocr_data)
    processing_time_ms = round((time.perf_counter() - request_started) * 1000)
    logger.debug("MyBVLife OCR used full-image fallback in %sms; timing=%s", processing_time_ms, debug_timing)

    if not _has_minimum_data(ocr_data):
        merged_data = {
            "fullName": ocr_data["fullName"] or cropped_data["fullName"],
            "cccd": ocr_data["cccd"] or cropped_data["cccd"],
            "cmnd": ocr_data["cmnd"] or cropped_data["cmnd"],
        }
        return {
            "ok": False,
            "source": "ocr",
            "data": merged_data,
            "warnings": list(dict.fromkeys([*cropped_warnings, *warnings])),
            "message": READ_FAILED_MESSAGE,
            "confidence": cropped_confidence,
            "method": "full_image_fallback_ocr",
            "processing_time_ms": processing_time_ms,
            "debug_timing": debug_timing,
        }

    return {
        "ok": True,
        "source": "ocr",
        "data": ocr_data,
        "warnings": warnings,
        "message": None,
        "confidence": {"fullName": 0.75, "cccd": 0.75, "cmnd": 0.75 if ocr_data["cmnd"] else 0.0},
        "method": "full_image_fallback_ocr",
        "processing_time_ms": processing_time_ms,
        "debug_timing": debug_timing,
    }
