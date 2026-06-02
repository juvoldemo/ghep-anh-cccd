from io import BytesIO
from textwrap import dedent

import cv2
import numpy as np
import streamlit as st
from PIL import Image, ImageOps


MAX_PROCESS_WIDTH = 1600
CARD_TARGET_WIDTH = 760
ZALO_TARGET_WIDTH = 760
CANVAS_PADDING = 64
ITEM_GAP = 48
UPLOAD_TYPES = ["jpg", "jpeg", "jfif", "png", "webp"]


def pil_to_cv(image: Image.Image) -> np.ndarray:
    image = ImageOps.exif_transpose(image).convert("RGB")
    return cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)


def cv_to_pil(image: np.ndarray) -> Image.Image:
    if image.ndim == 2:
        return Image.fromarray(image)
    return Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))


def order_points(points: np.ndarray) -> np.ndarray:
    points = points.reshape(4, 2).astype("float32")
    ordered = np.zeros((4, 2), dtype="float32")
    point_sum = points.sum(axis=1)
    ordered[0] = points[np.argmin(point_sum)]
    ordered[2] = points[np.argmax(point_sum)]
    point_diff = np.diff(points, axis=1)
    ordered[1] = points[np.argmin(point_diff)]
    ordered[3] = points[np.argmax(point_diff)]
    return ordered


def four_point_transform(image: np.ndarray, points: np.ndarray) -> np.ndarray:
    rect = order_points(points)
    top_left, top_right, bottom_right, bottom_left = rect
    width_a = np.linalg.norm(bottom_right - bottom_left)
    width_b = np.linalg.norm(top_right - top_left)
    max_width = int(max(width_a, width_b))
    height_a = np.linalg.norm(top_right - bottom_right)
    height_b = np.linalg.norm(top_left - bottom_left)
    max_height = int(max(height_a, height_b))

    if max_width < 80 or max_height < 80:
        return image

    destination = np.array(
        [[0, 0], [max_width - 1, 0], [max_width - 1, max_height - 1], [0, max_height - 1]],
        dtype="float32",
    )
    matrix = cv2.getPerspectiveTransform(rect, destination)
    return cv2.warpPerspective(image, matrix, (max_width, max_height))


def crop_content_fallback(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    mask_dark = cv2.threshold(blurred, 245, 255, cv2.THRESH_BINARY_INV)[1]
    edges = cv2.Canny(blurred, 40, 120)
    mask = cv2.bitwise_or(mask_dark, edges)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask = cv2.dilate(mask, kernel, iterations=1)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return image

    x, y, w, h = cv2.boundingRect(np.vstack(contours))
    pad = max(12, int(min(image.shape[:2]) * 0.02))
    x1 = max(x - pad, 0)
    y1 = max(y - pad, 0)
    x2 = min(x + w + pad, image.shape[1])
    y2 = min(y + h + pad, image.shape[0])
    return image[y1:y2, x1:x2]


def crop_card_by_saturation(image: np.ndarray) -> np.ndarray | None:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.threshold(hsv[:, :, 1], 35, 255, cv2.THRESH_BINARY)[1]
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 21))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=4)
    mask = cv2.dilate(mask, kernel, iterations=2)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return None

    image_area = image.shape[0] * image.shape[1]
    candidates = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < image_area * 0.03 or area > image_area * 0.70:
            continue
        rect = cv2.minAreaRect(contour)
        rect_width, rect_height = rect[1]
        if rect_width < 120 or rect_height < 80:
            continue
        aspect_ratio = max(rect_width, rect_height) / min(rect_width, rect_height)
        if not 1.20 <= aspect_ratio <= 2.25:
            continue
        aspect_score = 1.0 - min(abs(aspect_ratio - 1.58) / 0.9, 1.0)
        area_score = min(area / (image_area * 0.35), 1.0)
        candidates.append((area_score * 0.45 + aspect_score * 0.55, rect))

    if not candidates:
        return None

    _, best_rect = max(candidates, key=lambda item: item[0])
    card = four_point_transform(image, cv2.boxPoints(best_rect).astype("float32"))
    if card.shape[0] > card.shape[1]:
        card = cv2.rotate(card, cv2.ROTATE_90_CLOCKWISE)
    return card


def crop_card_by_background(image: np.ndarray) -> np.ndarray | None:
    height, width = image.shape[:2]
    if width < 120 or height < 80:
        return None

    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    border = max(8, int(min(width, height) * 0.04))
    border_pixels = np.vstack(
        [
            lab[:border, :, :].reshape(-1, 3),
            lab[-border:, :, :].reshape(-1, 3),
            lab[:, :border, :].reshape(-1, 3),
            lab[:, -border:, :].reshape(-1, 3),
        ]
    )
    background = np.median(border_pixels, axis=0)
    color_distance = np.linalg.norm(lab.astype("float32") - background, axis=2)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (5, 5), 0), 35, 120)
    color_mask = (color_distance > 16).astype("uint8") * 255
    saturation_mask = cv2.threshold(hsv[:, :, 1], 22, 255, cv2.THRESH_BINARY)[1]
    mask = cv2.bitwise_or(cv2.bitwise_or(color_mask, saturation_mask), edges)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (13, 13))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=3)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return None

    image_area = width * height
    candidates = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < image_area * 0.01 or area > image_area * 0.65:
            continue
        rect = cv2.minAreaRect(contour)
        rect_width, rect_height = rect[1]
        if rect_width < 90 or rect_height < 60:
            continue
        aspect_ratio = max(rect_width, rect_height) / min(rect_width, rect_height)
        if not 1.2 <= aspect_ratio <= 2.2:
            continue
        aspect_score = 1.0 - min(abs(aspect_ratio - 1.58) / 0.8, 1.0)
        area_score = min(area / (image_area * 0.18), 1.0)
        candidates.append((area_score * 0.55 + aspect_score * 0.45, rect))

    if not candidates:
        return None

    _, best_rect = max(candidates, key=lambda item: item[0])
    card = four_point_transform(image, cv2.boxPoints(best_rect).astype("float32"))
    if card.shape[0] > card.shape[1]:
        card = cv2.rotate(card, cv2.ROTATE_90_CLOCKWISE)
    return card


def crop_colored_card(image: np.ndarray) -> np.ndarray | None:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, np.array([35, 18, 45]), np.array([120, 255, 255]))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=4)
    mask = cv2.dilate(mask, kernel, iterations=2)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    if not contours:
        return None

    image_area = image.shape[0] * image.shape[1]
    useful_contours = [
        contour for contour in contours if image_area * 0.003 <= cv2.contourArea(contour) <= image_area * 0.75
    ]
    if not useful_contours:
        return None

    all_points = np.vstack(useful_contours)
    rect = cv2.minAreaRect(all_points)
    rect_width, rect_height = rect[1]
    if rect_width < 80 or rect_height < 80:
        return None
    aspect_ratio = max(rect_width, rect_height) / min(rect_width, rect_height)
    if not 1.1 <= aspect_ratio <= 2.3:
        return None

    card = four_point_transform(image, cv2.boxPoints(rect).astype("float32"))
    if card.shape[0] > card.shape[1]:
        card = cv2.rotate(card, cv2.ROTATE_90_CLOCKWISE)
    if card.shape[0] * card.shape[1] < image_area * 0.02:
        return None
    return card


def mask_center(mask: np.ndarray) -> tuple[float, float, int] | None:
    points = cv2.findNonZero(mask)
    if points is None or len(points) < 40:
        return None
    coords = points[:, 0, :]
    return float(coords[:, 0].mean()), float(coords[:, 1].mean()), len(points)


def looks_upside_down_card(image: Image.Image) -> bool:
    cv_image = pil_to_cv(image)
    height, width = cv_image.shape[:2]
    if width < 100 or height < 60:
        return False

    hsv = cv2.cvtColor(cv_image, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(cv_image, cv2.COLOR_BGR2GRAY)
    red_mask_1 = cv2.inRange(hsv, np.array([0, 60, 60]), np.array([12, 255, 255]))
    red_mask_2 = cv2.inRange(hsv, np.array([165, 60, 60]), np.array([179, 255, 255]))
    yellow_mask = cv2.inRange(hsv, np.array([15, 45, 70]), np.array([45, 255, 255]))
    warm_mask = cv2.bitwise_or(cv2.bitwise_or(red_mask_1, red_mask_2), yellow_mask)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    warm_mask = cv2.morphologyEx(warm_mask, cv2.MORPH_OPEN, kernel, iterations=1)
    warm_mask = cv2.morphologyEx(warm_mask, cv2.MORPH_CLOSE, kernel, iterations=1)

    upright_score = 0.0
    upside_score = 0.0
    warm_center = mask_center(warm_mask)
    if warm_center is not None:
        center_x, center_y, count = warm_center
        weight = 2.5 if count / float(width * height) > 0.002 else 1.2
        if center_y < height * 0.48:
            upright_score += weight
        elif center_y > height * 0.52:
            upside_score += weight
        if center_x < width * 0.48:
            upright_score += 0.7
        elif center_x > width * 0.52:
            upside_score += 0.7

    dark_mask = cv2.threshold(gray, 95, 255, cv2.THRESH_BINARY_INV)[1]
    top_dark = cv2.countNonZero(dark_mask[: height // 3, :])
    bottom_dark = cv2.countNonZero(dark_mask[height * 2 // 3 :, :])
    top_half_dark = cv2.countNonZero(dark_mask[: height // 2, :])
    bottom_half_dark = cv2.countNonZero(dark_mask[height // 2 :, :])
    if bottom_dark > top_dark * 1.25:
        upright_score += 1.2
    elif top_dark > bottom_dark * 1.25:
        upside_score += 1.2
    if bottom_half_dark > top_half_dark * 1.15:
        upright_score += 0.8
    elif top_half_dark > bottom_half_dark * 1.15:
        upside_score += 0.8
    return upside_score >= upright_score + 0.6


def auto_orient_card(image: Image.Image) -> Image.Image:
    if looks_upside_down_card(image):
        return image.rotate(180, expand=True)
    return image


def auto_crop_document(image: Image.Image, prefer_card: bool = False) -> Image.Image:
    cv_image = pil_to_cv(image)
    original = cv_image.copy()
    scale = 1.0

    if prefer_card:
        for cropper in (crop_card_by_saturation, crop_card_by_background, crop_colored_card):
            cropped_card = cropper(original)
            if cropped_card is not None:
                return auto_orient_card(cv_to_pil(cropped_card).convert("RGB"))

    height, width = cv_image.shape[:2]
    if width > MAX_PROCESS_WIDTH:
        scale = MAX_PROCESS_WIDTH / float(width)
        cv_image = cv2.resize(
            cv_image,
            (MAX_PROCESS_WIDTH, int(height * scale)),
            interpolation=cv2.INTER_AREA,
        )

    gray = cv2.cvtColor(cv_image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    edges = cv2.dilate(edges, kernel, iterations=1)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = sorted(contours, key=cv2.contourArea, reverse=True)
    image_area = cv_image.shape[0] * cv_image.shape[1]
    document_points = None

    for contour in contours[:10]:
        area = cv2.contourArea(contour)
        if area < image_area * 0.08:
            continue
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            document_points = approx
            break

    if document_points is not None:
        if scale != 1.0:
            document_points = document_points.astype("float32") / scale
        cropped = four_point_transform(original, document_points)
    else:
        cropped = crop_content_fallback(original)

    result = cv_to_pil(cropped).convert("RGB")
    if prefer_card:
        result = auto_orient_card(result)
    return result


def resize_keep_ratio(image: Image.Image, target_width: int) -> Image.Image:
    image = image.convert("RGB")
    if image.width == target_width:
        return image
    ratio = target_width / float(image.width)
    target_height = max(1, int(image.height * ratio))
    return image.resize((target_width, target_height), Image.Resampling.LANCZOS)


def create_final_canvas(front: Image.Image, back: Image.Image, zalo: Image.Image) -> Image.Image:
    front = resize_keep_ratio(front, CARD_TARGET_WIDTH)
    back = resize_keep_ratio(back, CARD_TARGET_WIDTH)
    zalo = resize_keep_ratio(zalo, ZALO_TARGET_WIDTH)
    top_height = max(front.height, back.height)
    canvas_width = CANVAS_PADDING * 2 + CARD_TARGET_WIDTH * 2 + ITEM_GAP
    canvas_height = CANVAS_PADDING * 2 + top_height + ITEM_GAP + zalo.height
    canvas = Image.new("RGB", (canvas_width, canvas_height), "white")
    canvas.paste(front, (CANVAS_PADDING, CANVAS_PADDING))
    canvas.paste(back, (CANVAS_PADDING + CARD_TARGET_WIDTH + ITEM_GAP, CANVAS_PADDING))
    canvas.paste(zalo, (CANVAS_PADDING, CANVAS_PADDING + top_height + ITEM_GAP))
    return canvas


def image_to_bytes(image: Image.Image, output_format: str) -> BytesIO:
    buffer = BytesIO()
    save_kwargs = {"quality": 95, "optimize": True} if output_format == "JPEG" else {}
    image.save(buffer, format=output_format, **save_kwargs)
    buffer.seek(0)
    return buffer


def load_uploaded_image(uploaded_file) -> Image.Image | None:
    if uploaded_file is None:
        return None
    return ImageOps.exif_transpose(Image.open(uploaded_file)).convert("RGB")


def mobile_html(html: str) -> None:
    st.markdown(dedent(html).strip(), unsafe_allow_html=True)


def ensure_mobile_state() -> None:
    defaults = {
        "final_image": None,
        "result_bytes": None,
        "result_mime": None,
        "result_filename": None,
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def inject_mobile_style() -> None:
    mobile_html(
        """
        <style>
        :root {
            --bv-blue: #005BAC;
            --bv-dark: #003B7A;
            --bv-text: #12395F;
            --bv-body: #35516D;
            --bv-muted: #516A83;
            --bv-soft: #EAF6FF;
            --bv-border: #B7DFFF;
            --bv-gold: #D4A017;
        }

        html, body, .stApp {
            overflow-x: hidden !important;
            background: linear-gradient(180deg, #F4FBFF 0%, #EAF6FF 100%) !important;
            color: var(--bv-text);
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        header[data-testid="stHeader"],
        div[data-testid="stToolbar"] {
            display: none !important;
        }

        .main .block-container {
            width: 100%;
            max-width: 430px;
            margin: 0 auto;
            padding: 16px 16px 28px;
            box-sizing: border-box;
        }

        .mobile-app {
            width: 100%;
            max-width: 430px;
            margin: 0 auto;
        }

        .mini-brand {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 16px;
        }

        .brand-main {
            display: flex;
            align-items: baseline;
            gap: 6px;
            line-height: 1;
        }

        .brand-baoviet {
            color: var(--bv-blue);
            font-size: 24px;
            font-weight: 900;
        }

        .brand-life {
            color: var(--bv-gold);
            font-size: 22px;
            font-weight: 900;
        }

        .brand-sub {
            margin-top: 4px;
            color: var(--bv-dark);
            font-size: 13px;
            font-weight: 800;
        }

        .page-title {
            margin: 14px 0 8px;
            color: var(--bv-dark);
            font-size: 26px;
            line-height: 1.16;
            font-weight: 800;
            letter-spacing: 0;
        }

        .privacy-note {
            margin: 12px 0 16px;
            padding: 12px 14px;
            border: 1px solid var(--bv-border);
            border-radius: 14px;
            background: var(--bv-soft);
            color: var(--bv-dark);
            font-size: 13px;
            line-height: 1.42;
            font-weight: 700;
        }

        .mobile-card {
            width: 100%;
            box-sizing: border-box;
            margin-top: 12px;
            padding: 14px;
            background: #FFFFFF;
            border: 1px solid var(--bv-border);
            border-radius: 16px;
            box-shadow: 0 8px 24px rgba(0, 91, 172, 0.08);
        }

        .section-title {
            margin: 0 0 10px;
            color: var(--bv-dark);
            font-size: 18px;
            font-weight: 800;
        }

        .upload-row {
            padding: 12px;
            margin-top: 10px;
            border: 1px solid var(--bv-border);
            border-radius: 14px;
            background: #FFFFFF;
        }

        .upload-heading {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
            color: var(--bv-text);
            font-size: 15px;
            font-weight: 700;
        }

        .step-dot {
            width: 28px;
            height: 28px;
            min-width: 28px;
            border-radius: 50%;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: var(--bv-blue);
            color: #FFFFFF;
            font-size: 13px;
            font-weight: 800;
        }

        .file-status {
            margin-top: 8px;
            padding: 9px 10px;
            border-radius: 10px;
            background: #F4FBFF;
            color: var(--bv-muted);
            font-size: 13px;
            font-weight: 600;
        }

        .file-status.done {
            background: #EAF6FF;
            color: var(--bv-dark);
            font-weight: 800;
        }

        div[data-testid="stFileUploader"] label {
            display: none !important;
        }

        [data-testid="stFileUploader"] section {
            min-height: 48px !important;
            padding: 0 !important;
            border: 0 !important;
            background: transparent !important;
        }

        [data-testid="stFileUploader"] section > div {
            padding: 0 !important;
            background: transparent !important;
        }

        [data-testid="stFileUploader"] small,
        [data-testid="stFileUploader"] span {
            color: var(--bv-muted) !important;
            font-weight: 600 !important;
        }

        [data-testid="stFileUploader"] button,
        [data-testid="stFileUploader"] [role="button"],
        [data-testid="stFileUploader"] [data-testid="baseButton-secondary"] {
            width: 100% !important;
            min-height: 44px !important;
            border: 0 !important;
            border-radius: 12px !important;
            background: var(--bv-blue) !important;
            color: #FFFFFF !important;
            font-weight: 800 !important;
            box-shadow: none !important;
            opacity: 1 !important;
        }

        [data-testid="stFileUploader"] button *,
        [data-testid="stFileUploader"] button svg,
        [data-testid="stFileUploader"] button path {
            color: #FFFFFF !important;
            fill: #FFFFFF !important;
            stroke: #FFFFFF !important;
        }

        [data-testid="stFileUploaderFile"] {
            display: none !important;
        }

        .format-label {
            margin: 14px 0 6px;
            color: var(--bv-text);
            font-size: 15px;
            font-weight: 800;
        }

        .stRadio label {
            color: var(--bv-text) !important;
            font-weight: 700 !important;
        }

        .stButton > button,
        .stDownloadButton > button {
            width: 100% !important;
            min-height: 50px !important;
            border: 0 !important;
            border-radius: 14px !important;
            font-size: 15px !important;
            font-weight: 800 !important;
        }

        .stButton > button {
            margin-top: 12px;
            background: linear-gradient(135deg, #F2C94C, var(--bv-gold)) !important;
            color: var(--bv-dark) !important;
            box-shadow: 0 10px 20px rgba(212, 160, 23, 0.20);
        }

        .stDownloadButton > button {
            margin-top: 12px;
            background: var(--bv-blue) !important;
            color: #FFFFFF !important;
        }

        .result-empty {
            min-height: 120px;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            color: var(--bv-body);
            font-size: 14px;
            font-weight: 600;
            border: 1px dashed var(--bv-border);
            border-radius: 12px;
            background: #FFFFFF;
        }

        .result-frame {
            width: 100%;
            max-width: 100%;
            max-height: 420px;
            overflow: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--bv-border);
            border-radius: 12px;
            background: #FFFFFF;
            box-sizing: border-box;
        }

        .result-frame img,
        .result-frame [data-testid="stImage"] img {
            max-width: 100% !important;
            max-height: 420px !important;
            width: auto !important;
            height: auto !important;
            object-fit: contain !important;
            border-radius: 12px;
        }

        [data-testid="stImage"] {
            max-width: 100% !important;
        }

        [data-testid="stImage"] img {
            max-width: 100% !important;
            height: auto !important;
        }

        div[data-testid="stAlert"] {
            border-radius: 12px;
            font-weight: 700;
        }

        @media (min-width: 431px) {
            .main .block-container {
                padding-top: 24px;
            }
        }

        @media (max-width: 768px) {
            .main .block-container {
                padding-left: 16px;
                padding-right: 16px;
            }
        }

        @media (max-width: 480px) {
            .page-title {
                font-size: 24px;
            }
            .mobile-card {
                padding: 12px;
            }
        }
        </style>
        """
    )


def short_file_name(uploaded_file) -> str:
    if not uploaded_file:
        return "Chưa chọn"
    name = uploaded_file.name
    return name if len(name) <= 28 else f"{name[:18]}...{name[-7:]}"


def render_upload_status(index: int, title: str, uploaded_file) -> None:
    status_class = "done" if uploaded_file else ""
    status_text = f"Đã chọn ảnh: {short_file_name(uploaded_file)}" if uploaded_file else "Chưa chọn"
    mobile_html(
        f"""
        <div class="upload-heading">
            <span class="step-dot">{index}</span>
            <span>{title}</span>
        </div>
        <div class="file-status {status_class}">{status_text}</div>
        """
    )


st.set_page_config(page_title="Ghép ảnh giấy tờ tùy thân", page_icon="ID", layout="centered")
ensure_mobile_state()
inject_mobile_style()

mobile_html(
    """
    <div class="mobile-app">
        <div class="mini-brand">
            <div>
                <div class="brand-main">
                    <span class="brand-baoviet">BAOVIET</span>
                    <span class="brand-life">Life</span>
                </div>
                <div class="brand-sub">Ghép ảnh giấy tờ tùy thân</div>
            </div>
        </div>
        <h1 class="page-title">Ghép ảnh giấy tờ tùy thân</h1>
        <div class="privacy-note">Ảnh chỉ xử lý cục bộ, không OCR, không lưu dữ liệu.</div>
    </div>
    """
)

mobile_html('<div class="mobile-card"><div class="section-title">Upload ảnh</div>')

mobile_html('<div class="upload-row">')
front_upload = st.file_uploader("Mặt trước CCCD", type=UPLOAD_TYPES, key="front_upload", label_visibility="collapsed")
render_upload_status(1, "Mặt trước CCCD", front_upload)
mobile_html("</div>")

mobile_html('<div class="upload-row">')
back_upload = st.file_uploader("Mặt sau CCCD", type=UPLOAD_TYPES, key="back_upload", label_visibility="collapsed")
render_upload_status(2, "Mặt sau CCCD", back_upload)
mobile_html("</div>")

mobile_html('<div class="upload-row">')
zalo_upload = st.file_uploader("Ảnh thông tin Zalo", type=UPLOAD_TYPES, key="zalo_upload", label_visibility="collapsed")
render_upload_status(3, "Ảnh thông tin Zalo", zalo_upload)
mobile_html("</div>")

mobile_html('<div class="format-label">Định dạng xuất ảnh</div>')
output_format_label = st.radio("Định dạng", ["JPG", "PNG"], index=0, horizontal=True, label_visibility="collapsed")
create_clicked = st.button("Tạo ảnh hoàn chỉnh", type="primary", use_container_width=True)
mobile_html("</div>")

if create_clicked:
    if not front_upload or not back_upload or not zalo_upload:
        st.error("Vui lòng upload đủ 3 ảnh trước khi tạo ảnh hoàn chỉnh.")
    else:
        try:
            with st.spinner("Đang xử lý ảnh..."):
                front_image = auto_crop_document(load_uploaded_image(front_upload), prefer_card=True)
                back_image = auto_crop_document(load_uploaded_image(back_upload), prefer_card=True)
                zalo_image = auto_crop_document(load_uploaded_image(zalo_upload), prefer_card=False)
                final_image = create_final_canvas(front_image, back_image, zalo_image)
                output_format = "JPEG" if output_format_label == "JPG" else "PNG"
                file_extension = "jpg" if output_format == "JPEG" else "png"
                result_bytes = image_to_bytes(final_image, output_format)

            st.session_state.final_image = final_image
            st.session_state.result_bytes = result_bytes
            st.session_state.result_mime = f"image/{'jpeg' if output_format == 'JPEG' else 'png'}"
            st.session_state.result_filename = f"anh_giay_to_hoan_chinh.{file_extension}"
            st.success("Đã tạo ảnh hoàn chỉnh.")
        except Exception as exc:
            st.error(f"Không thể xử lý ảnh. Vui lòng thử ảnh khác. Lỗi: {exc}")

mobile_html('<div class="mobile-card"><div class="section-title">Kết quả</div>')
if st.session_state.final_image is None:
    mobile_html('<div class="result-empty">Ảnh hoàn chỉnh sẽ hiển thị tại đây</div>')
else:
    mobile_html('<div class="result-frame">')
    st.image(st.session_state.final_image, use_container_width=False)
    mobile_html("</div>")
    st.download_button(
        "Tải ảnh về",
        data=st.session_state.result_bytes,
        file_name=st.session_state.result_filename,
        mime=st.session_state.result_mime,
        use_container_width=True,
    )
mobile_html("</div>")

st.stop()


def render_html(html: str) -> None:
    st.markdown(dedent(html).strip(), unsafe_allow_html=True)


def ensure_result_state() -> None:
    defaults = {
        "final_image": None,
        "result_bytes": None,
        "result_mime": None,
        "result_filename": None,
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def render_logo(size: str = "large") -> str:
    return dedent(
        f"""
        <div class="bv-logo logo-{size}">
            <div class="bv-logo-line">
                <span class="bv-baoviet">BAOVIET</span>
                <svg class="bv-globe" viewBox="0 0 64 64" aria-hidden="true">
                    <defs>
                        <radialGradient id="goldGlobe-{size}" cx="35%" cy="25%" r="70%">
                            <stop offset="0%" stop-color="#fff4b6"/>
                            <stop offset="42%" stop-color="#D4A017"/>
                            <stop offset="100%" stop-color="#9c7300"/>
                        </radialGradient>
                    </defs>
                    <circle cx="32" cy="32" r="28" fill="url(#goldGlobe-{size})"/>
                    <path d="M6 33c10-9 22-12 38-9M10 46c12-7 25-9 46-6M18 9c-5 15-4 34 6 52M43 7c8 13 8 34-1 55M6 30h56M32 4v58" fill="none" stroke="rgba(255,255,255,.82)" stroke-width="2"/>
                </svg>
                <span class="bv-life">Life</span>
            </div>
            <div class="bv-logo-sub">BẢO VIỆT NHÂN THỌ</div>
        </div>
        """
    ).strip()


def svg_icon(name: str) -> str:
    icons = {
        "shield": '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 3v5c0 5-3.4 8.5-7 10-3.6-1.5-7-5-7-10V6l7-3z" stroke="currentColor" stroke-width="2"/><path d="M9 12l2 2 4-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        "lock": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 10V7a4 4 0 018 0v3" stroke="currentColor" stroke-width="2"/></svg>',
        "card": '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 10h5M7 14h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        "qr": '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M4 4h7v7H4zM15 4h5v5h-5zM4 15h5v5H4zM14 14h2v2h-2zM18 14h2v6h-4v-2h2zM12 18h2v2h-2z" stroke="currentColor" stroke-width="2"/></svg>',
        "phone": '<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect x="7" y="2" width="10" height="20" rx="2" stroke="currentColor" stroke-width="2"/><path d="M11 18h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        "image": '<svg width="48" height="48" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.7"/><path d="M8 13l2.5-2.5L15 15l2-2 3 3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="9" r="1" fill="currentColor"/></svg>',
        "spark": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
        "check": '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    }
    return icons[name]


def inject_style() -> None:
    render_html(
        """
        <style>
        :root {
            --blue: #005BAC;
            --blue-dark: #003B7A;
            --text-blue: #12395F;
            --soft-blue: #EAF6FF;
            --border-blue: #B7DFFF;
            --gold: #D4A017;
            --body-text: #35516D;
            --small-text: #516A83;
        }
        html, body, .stApp {
            width: 100%;
            max-width: 100%;
            overflow-x: hidden;
            background: linear-gradient(180deg, #F4FBFF 0%, #EAF6FF 100%) !important;
            color: var(--body-text);
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .main .block-container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 24px 40px;
        }
        header[data-testid="stHeader"], div[data-testid="stToolbar"] {
            display: none;
        }
        h1, h2, h3, .section-title, .hero-title {
            color: var(--text-blue);
            font-weight: 800;
        }
        p, .section-sub, .hero-sub, .privacy-box, .benefit-sub {
            color: var(--body-text);
            font-weight: 500;
        }
        .bv-header {
            width: 100vw;
            margin-left: calc(50% - 50vw);
            background: linear-gradient(135deg, var(--blue) 0%, var(--blue-dark) 100%);
            color: #fff;
            box-shadow: 0 12px 32px rgba(0, 59, 122, 0.18);
        }
        .bv-header-inner {
            max-width: 1200px;
            min-height: 86px;
            margin: 0 auto;
            padding: 14px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 24px;
        }
        .bv-gold-line {
            width: 100vw;
            height: 4px;
            margin-left: calc(50% - 50vw);
            background: var(--gold);
        }
        .bv-logo-line {
            display: flex;
            align-items: center;
            gap: 8px;
            line-height: 1;
            white-space: nowrap;
        }
        .bv-baoviet {
            color: #fff;
            font-size: 30px;
            font-weight: 900;
        }
        .bv-life {
            color: #F4CE61;
            font-size: 28px;
            font-weight: 800;
        }
        .bv-globe {
            width: 40px;
            height: 40px;
        }
        .bv-logo-sub {
            margin-top: 6px;
            color: #FFFFFF;
            font-size: 14px;
            font-weight: 700;
            letter-spacing: 0.4px;
        }
        .security-pill {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 11px 15px;
            border: 1px solid rgba(255,255,255,0.28);
            border-radius: 16px;
            background: rgba(255,255,255,0.13);
            color: #fff;
        }
        .security-title {
            color: #fff;
            font-size: 14px;
            font-weight: 800;
            line-height: 1.2;
        }
        .security-sub {
            color: #EAF6FF;
            font-size: 13px;
            font-weight: 600;
            line-height: 1.25;
            margin-top: 3px;
        }
        .hero {
            text-align: center;
            padding: 46px 0 22px;
        }
        .hero-title {
            margin: 0;
            color: var(--text-blue);
            font-size: 44px;
            line-height: 1.12;
            font-weight: 800;
        }
        .hero-sub {
            margin: 14px auto 0;
            max-width: 760px;
            color: var(--body-text);
            font-size: 17px;
            line-height: 1.6;
        }
        .privacy-box {
            max-width: 860px;
            margin: 22px auto 0;
            padding: 13px 16px;
            border: 1px solid var(--border-blue);
            border-radius: 14px;
            background: rgba(234, 246, 255, 0.92);
            color: var(--body-text);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            font-size: 14px;
            font-weight: 500;
        }
        .app-card, .upload-card, .benefit, .result-image-wrap, .empty-state {
            background: #FFFFFF;
            border: 1px solid #B7DFFF;
            border-radius: 18px;
            box-shadow: 0 8px 24px rgba(0, 91, 172, 0.08);
        }
        .app-card {
            margin-top: 22px;
            padding: 26px;
        }
        .section-title {
            margin: 0;
            color: var(--text-blue);
            font-size: 22px;
            font-weight: 800;
        }
        .section-sub {
            margin: 5px 0 0;
            color: var(--body-text);
            font-size: 14px;
            font-weight: 500;
        }
        .upload-card {
            min-height: 260px;
            padding: 18px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            border-style: dashed;
            box-shadow: none;
        }
        .upload-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 14px;
        }
        .upload-title {
            display: flex;
            align-items: center;
            gap: 10px;
            color: var(--blue-dark);
            font-size: 15px;
            font-weight: 700;
        }
        .step-dot {
            width: 30px;
            height: 30px;
            border-radius: 999px;
            background: var(--blue);
            color: #fff;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-weight: 800;
            font-size: 13px;
        }
        .upload-icon {
            width: 46px;
            height: 46px;
            border-radius: 14px;
            background: var(--soft-blue);
            color: var(--blue);
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .upload-note {
            margin-top: 10px;
            color: var(--small-text);
            font-size: 12px;
            font-weight: 600;
        }
        .empty-preview {
            min-height: 92px;
            margin-top: 12px;
            border-radius: 14px;
            border: 1px solid rgba(183, 223, 255, 0.75);
            background: #F6FBFF;
            display: flex;
            align-items: center;
            justify-content: center;
            color: var(--small-text);
            font-size: 13px;
            font-weight: 600;
        }
        .preview-box {
            margin-top: 12px;
            overflow: hidden;
            border-radius: 14px;
            border: 1px solid rgba(183, 223, 255, 0.95);
            background: #fff;
        }
        div[data-testid="stFileUploader"] label {
            display: none;
        }
        [data-testid="stFileUploader"] section {
            min-height: 62px !important;
            padding: 0 !important;
            border: 0 !important;
            background: transparent !important;
        }
        [data-testid="stFileUploader"] section > div {
            padding: 0 !important;
            background: transparent !important;
        }
        [data-testid="stFileUploader"] small,
        [data-testid="stFileUploader"] span {
            color: var(--small-text) !important;
            font-weight: 600 !important;
        }
        [data-testid="stFileUploader"] button,
        [data-testid="stFileUploader"] [role="button"],
        [data-testid="stFileUploader"] [data-testid="baseButton-secondary"] {
            min-height: 42px !important;
            margin: 6px 0 !important;
            border: 0 !important;
            border-radius: 999px !important;
            background: linear-gradient(135deg, var(--blue), #0A78D2) !important;
            color: #fff !important;
            font-weight: 800 !important;
            box-shadow: 0 10px 22px rgba(0, 91, 172, 0.20) !important;
            opacity: 1 !important;
        }
        [data-testid="stFileUploader"] button *,
        [data-testid="stFileUploader"] button svg,
        [data-testid="stFileUploader"] button path {
            color: #fff !important;
            fill: #fff !important;
            stroke: #fff !important;
            opacity: 1 !important;
        }
        [data-testid="stFileUploaderFile"] {
            border-radius: 12px !important;
            border: 1px solid rgba(183, 223, 255, 0.95) !important;
            background: var(--soft-blue) !important;
        }
        [data-testid="stFileUploaderFile"] * {
            color: var(--blue-dark) !important;
            font-weight: 700 !important;
        }
        .format-action-row {
            margin-top: 24px;
            padding-top: 22px;
            border-top: 1px solid rgba(183, 223, 255, 0.75);
        }
        .stRadio > div {
            gap: 14px;
        }
        .stRadio label {
            color: var(--text-blue) !important;
            font-weight: 700 !important;
        }
        .stButton > button {
            min-height: 52px;
            border: 0 !important;
            border-radius: 999px !important;
            background: linear-gradient(135deg, #F2C94C, var(--gold)) !important;
            color: #1F2937 !important;
            font-weight: 900 !important;
            box-shadow: 0 14px 30px rgba(212, 160, 23, 0.30);
        }
        .action-sub {
            margin-top: 8px;
            color: var(--small-text);
            font-size: 13px;
            font-weight: 600;
            text-align: right;
        }
        .result-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 16px;
        }
        .result-actions {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .ghost-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 40px;
            padding: 0 16px;
            border-radius: 999px;
            border: 1px solid var(--border-blue);
            background: var(--soft-blue);
            color: var(--blue);
            font-size: 14px;
            font-weight: 800;
        }
        .empty-state {
            min-height: 260px;
            border-style: dashed;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 28px;
            color: var(--small-text);
            font-weight: 600;
        }
        .empty-state strong {
            display: block;
            margin: 10px 0 4px;
            color: var(--text-blue);
            font-size: 17px;
            font-weight: 800;
        }
        .result-image-wrap {
            padding: 14px;
            overflow: hidden;
        }
        .stDownloadButton > button {
            border-radius: 999px !important;
            background: linear-gradient(135deg, var(--blue), #0A78D2) !important;
            color: #fff !important;
            font-weight: 800 !important;
        }
        .benefits {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
            margin: 26px 0;
        }
        .benefit {
            display: flex;
            gap: 12px;
            padding: 18px;
        }
        .benefit-icon {
            width: 42px;
            height: 42px;
            flex: 0 0 42px;
            border-radius: 999px;
            background: var(--blue);
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .benefit-title {
            color: var(--text-blue);
            font-weight: 800;
        }
        .benefit-sub {
            margin-top: 4px;
            color: var(--body-text);
            font-size: 13px;
            font-weight: 500;
        }
        .bv-footer {
            width: 100vw;
            margin-left: calc(50% - 50vw);
            margin-top: 24px;
            background: var(--blue-dark);
        }
        .bv-footer-inner {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px 24px;
            display: grid;
            grid-template-columns: 1fr auto 1fr;
            align-items: center;
            gap: 16px;
        }
        .footer-copy {
            color: #EAF6FF;
            text-align: center;
            font-size: 13px;
            font-weight: 600;
        }
        div[data-testid="stAlert"] {
            border-radius: 14px;
            border: 1px solid rgba(183, 223, 255, 0.95);
        }
        @media (max-width: 1023px) {
            .main .block-container {
                padding-left: 20px;
                padding-right: 20px;
            }
        }
        @media (max-width: 768px) {
            .main .block-container {
                padding: 0 16px 34px;
            }
            .bv-header-inner {
                min-height: auto;
                flex-direction: column;
                align-items: flex-start;
                gap: 12px;
                padding: 16px;
            }
            .security-pill {
                width: 100%;
                box-sizing: border-box;
            }
            .hero {
                padding: 34px 0 16px;
                text-align: left;
            }
            .hero-title {
                font-size: 32px;
            }
            .privacy-box {
                align-items: flex-start;
                justify-content: flex-start;
            }
            .app-card {
                padding: 18px;
                border-radius: 18px;
            }
            .upload-card {
                min-height: 260px;
            }
            .action-sub {
                text-align: left;
            }
            .stButton > button,
            .stDownloadButton > button {
                width: 100% !important;
            }
            .result-top {
                flex-direction: column;
                align-items: stretch;
            }
            .result-actions {
                flex-direction: column;
                align-items: stretch;
            }
            .ghost-btn {
                width: 100%;
                box-sizing: border-box;
            }
            .benefits {
                grid-template-columns: 1fr;
            }
            .bv-footer-inner {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                padding: 18px 16px;
            }
            .footer-copy {
                text-align: left;
            }
        }
        @media (max-width: 480px) {
            .bv-baoviet {
                font-size: 24px;
            }
            .bv-life {
                font-size: 22px;
            }
            .bv-globe {
                width: 34px;
                height: 34px;
            }
            .bv-logo-sub {
                font-size: 12px;
            }
            .hero-title {
                font-size: 28px;
            }
            .hero-sub {
                font-size: 15px;
            }
            .section-title {
                font-size: 20px;
            }
        }
        </style>
        """
    )


def render_upload_card(index: int, title: str, icon: str, key: str):
    render_html(
        f"""
        <div class="upload-card">
            <div class="upload-top">
                <div class="upload-title"><span class="step-dot">{index}</span><span>{title}</span></div>
                <div class="upload-icon">{svg_icon(icon)}</div>
            </div>
        """
    )
    uploaded = st.file_uploader("Chọn ảnh", type=UPLOAD_TYPES, key=key, label_visibility="collapsed")
    render_html('<div class="upload-note">JPG, PNG tối đa 10MB</div>')
    if uploaded:
        render_html('<div class="preview-box">')
        st.caption("Đã chọn ảnh")
        render_html("</div>")
    else:
        render_html(f'<div class="empty-preview">{svg_icon("image")}</div>')
    render_html("</div>")
    return uploaded


st.set_page_config(page_title="Ghép ảnh giấy tờ tùy thân", page_icon="ID", layout="wide")
ensure_result_state()
inject_style()

render_html(
    f"""
    <div class="bv-header">
        <div class="bv-header-inner">
            {render_logo("large")}
            <div class="security-pill">
                <div>{svg_icon("shield")}</div>
                <div>
                    <div class="security-title">Bảo mật tuyệt đối</div>
                    <div class="security-sub">Xử lý cục bộ, không lưu dữ liệu</div>
                </div>
            </div>
        </div>
    </div>
    <div class="bv-gold-line"></div>
    """
)

render_html(
    f"""
    <section class="hero">
        <h1 class="hero-title">Ghép ảnh giấy tờ tùy thân</h1>
        <p class="hero-sub">Upload 3 ảnh, hệ thống tự cắt sát CCCD, tự xoay nếu bị lệch và ghép thành một ảnh nền trắng.</p>
        <div class="privacy-box">{svg_icon("lock")}<span>Ảnh chỉ xử lý cục bộ trong phiên làm việc. Không OCR, không lưu ảnh, không gửi dữ liệu CCCD đi nơi khác.</span></div>
    </section>
    """
)

render_html(
    """
    <section class="app-card">
        <div>
            <h2 class="section-title">Ảnh cần ghép</h2>
            <p class="section-sub">Chọn đủ 3 ảnh để hệ thống tự xử lý và ghép vào bố cục chuẩn.</p>
        </div>
    """
)

col1, col2, col3 = st.columns(3)
with col1:
    front_upload = render_upload_card(1, "Mặt trước CCCD", "card", "front_upload")
with col2:
    back_upload = render_upload_card(2, "Mặt sau CCCD", "qr", "back_upload")
with col3:
    zalo_upload = render_upload_card(3, "Ảnh thông tin Zalo", "phone", "zalo_upload")

render_html('<div class="format-action-row">')
fmt_col, action_col = st.columns([1.2, 1])
with fmt_col:
    render_html('<h3 class="section-title" style="font-size:18px;">Định dạng xuất ảnh</h3>')
    output_format_label = st.radio(
        "Định dạng xuất ảnh",
        ["JPG - Khuyến nghị", "PNG - Chất lượng cao"],
        index=0,
        horizontal=True,
        label_visibility="collapsed",
    )
with action_col:
    create_clicked = st.button("Tạo ảnh hoàn chỉnh", type="primary", use_container_width=True)
    render_html('<div class="action-sub">Hệ thống sẽ tự động xử lý và ghép ảnh</div>')
render_html("</div></section>")

if create_clicked:
    if not front_upload or not back_upload or not zalo_upload:
        st.error("Vui lòng upload đủ 3 ảnh trước khi tạo ảnh hoàn chỉnh.")
    else:
        try:
            with st.spinner("Đang xử lý ảnh..."):
                front_image = auto_crop_document(load_uploaded_image(front_upload), prefer_card=True)
                back_image = auto_crop_document(load_uploaded_image(back_upload), prefer_card=True)
                zalo_image = auto_crop_document(load_uploaded_image(zalo_upload), prefer_card=False)
                final_image = create_final_canvas(front_image, back_image, zalo_image)
                output_format = "JPEG" if output_format_label.startswith("JPG") else "PNG"
                file_extension = "jpg" if output_format == "JPEG" else "png"
                result_bytes = image_to_bytes(final_image, output_format)

            st.session_state.final_image = final_image
            st.session_state.result_bytes = result_bytes
            st.session_state.result_mime = f"image/{'jpeg' if output_format == 'JPEG' else 'png'}"
            st.session_state.result_filename = f"anh_giay_to_hoan_chinh.{file_extension}"
            st.success("Đã tạo ảnh hoàn chỉnh.")
        except Exception as exc:
            st.error(f"Không thể xử lý ảnh. Vui lòng thử ảnh khác. Lỗi: {exc}")

render_html(
    """
    <section class="app-card">
        <div class="result-top">
            <div>
                <h2 class="section-title">Ảnh kết quả</h2>
                <p class="section-sub">Ảnh sau khi cắt, xoay và ghép sẽ hiển thị tại đây.</p>
            </div>
            <div class="result-actions"><span class="ghost-btn">Xem trước</span></div>
        </div>
    """
)

if st.session_state.final_image is None:
    render_html(
        f"""
        <div class="empty-state">
            <div>
                <div style="color:#B7DFFF;">{svg_icon("image")}</div>
                <strong>Kết quả sẽ hiển thị ở đây</strong>
                <div>Vui lòng upload 3 ảnh và nhấn ‘Tạo ảnh hoàn chỉnh’</div>
            </div>
        </div>
        """
    )
else:
    render_html('<div class="result-image-wrap">')
    st.image(st.session_state.final_image, use_container_width=True)
    render_html("</div>")
    st.download_button(
        "Tải ảnh về",
        data=st.session_state.result_bytes,
        file_name=st.session_state.result_filename,
        mime=st.session_state.result_mime,
        use_container_width=False,
    )
render_html("</section>")

render_html(
    f"""
    <section class="benefits">
        <div class="benefit">
            <div class="benefit-icon">{svg_icon("shield")}</div>
            <div><div class="benefit-title">Bảo mật tuyệt đối</div><div class="benefit-sub">Xử lý cục bộ, không lưu trữ</div></div>
        </div>
        <div class="benefit">
            <div class="benefit-icon">{svg_icon("spark")}</div>
            <div><div class="benefit-title">Nhanh chóng, chính xác</div><div class="benefit-sub">Tự cắt, tự xoay, tự ghép</div></div>
        </div>
        <div class="benefit">
            <div class="benefit-icon">{svg_icon("check")}</div>
            <div><div class="benefit-title">Chất lượng cao</div><div class="benefit-sub">Ảnh rõ nét, bố cục chuẩn</div></div>
        </div>
    </section>
    """
)

render_html(
    f"""
    <footer class="bv-footer">
        <div class="bv-footer-inner">
            {render_logo("small")}
            <div class="footer-copy">© 2024 Bảo Việt Nhân Thọ. Tất cả quyền được bảo lưu.</div>
            <div></div>
        </div>
    </footer>
    """
)
