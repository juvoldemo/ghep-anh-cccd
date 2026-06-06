import functools
import re
import unicodedata
from pathlib import Path
from typing import Any, Literal, TypedDict


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
    source: Literal["qr", "ocr"]
    data: ParsedData
    warnings: list[str]
    message: str | None


def _strip_accents(value: str) -> str:
    normalized = unicodedata.normalize("NFD", value)
    without_marks = "".join(ch for ch in normalized if unicodedata.category(ch) != "Mn")
    return without_marks.replace("đ", "d").replace("Đ", "D").lower()


def _clean_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _digits_only(value: str) -> str:
    return re.sub(r"\D", "", value or "")


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
    from paddleocr import PaddleOCR  # type: ignore

    ocr = PaddleOCR(use_angle_cls=True, lang="vi", show_log=False)
    result = ocr.ocr(str(image_path), cls=True)
    lines: list[str] = []
    for page in result or []:
        for item in page or []:
            text = item[1][0] if item and len(item) > 1 else ""
            if text:
                lines.append(str(text).strip())
    return lines


def _extract_paddleocr_tokens(image_path: Path) -> list[OcrToken]:
    from paddleocr import PaddleOCR  # type: ignore

    ocr = PaddleOCR(use_angle_cls=True, lang="vi", show_log=False)
    result = ocr.ocr(str(image_path), cls=True)
    tokens: list[OcrToken] = []
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
    qr_text = _decode_qr_with_opencv(image_path)
    qr_data = _parse_cccd_qr(qr_text)

    if _has_minimum_data(qr_data):
        warnings = _validate_data(qr_data)
        return {
            "ok": True,
            "source": "qr",
            "data": qr_data,
            "warnings": warnings,
            "message": None,
        }

    lines, tokens = _read_text_and_tokens(image_path)
    ocr_data = _parse_ocr_data(lines, tokens)
    warnings = _validate_data(ocr_data)

    if not _has_minimum_data(ocr_data):
        return {
            "ok": False,
            "source": "ocr",
            "data": ocr_data,
            "warnings": warnings,
            "message": READ_FAILED_MESSAGE,
        }

    return {
        "ok": True,
        "source": "ocr",
        "data": ocr_data,
        "warnings": warnings,
        "message": None,
    }
