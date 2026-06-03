import argparse
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps


MAX_PROCESS_WIDTH = 1600
CARD_TARGET_WIDTH = 760
ZALO_TARGET_WIDTH = 760
CANVAS_PADDING = 64
ITEM_GAP = 48


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
        cv_image = cv2.resize(cv_image, (MAX_PROCESS_WIDTH, int(height * scale)), interpolation=cv2.INTER_AREA)

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


def load_image(path: str) -> Image.Image:
    return ImageOps.exif_transpose(Image.open(path)).convert("RGB")


def save_image(image: Image.Image, output: str, output_format: str) -> None:
    save_format = "JPEG" if output_format == "jpeg" else "PNG"
    kwargs = {"quality": 95, "optimize": True} if save_format == "JPEG" else {}
    image.save(output, format=save_format, **kwargs)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--front", required=True)
    parser.add_argument("--back", required=True)
    parser.add_argument("--zalo", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--format", choices=["jpeg", "png"], default="jpeg")
    args = parser.parse_args()

    front = auto_crop_document(load_image(args.front), prefer_card=True)
    back = auto_crop_document(load_image(args.back), prefer_card=True)
    zalo = auto_crop_document(load_image(args.zalo), prefer_card=False)
    final_image = create_final_canvas(front, back, zalo)
    save_image(final_image, args.output, args.format)


if __name__ == "__main__":
    main()
