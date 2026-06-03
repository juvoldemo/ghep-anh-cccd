"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { PortalShell } from "@/components/PortalShell";

type UploadKey = "front" | "back" | "zalo";

type UploadItem = {
  key: UploadKey;
  label: string;
};

type CropBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const uploadItems: UploadItem[] = [
  { key: "front", label: "Mặt trước CCCD" },
  { key: "back", label: "Mặt sau CCCD" },
  { key: "zalo", label: "Ảnh quét mã QR" }
];

const MAX_PROCESS_WIDTH = 1600;
const CARD_TARGET_WIDTH = 760;
const ZALO_TARGET_WIDTH = 760;
const CANVAS_PADDING = 64;
const ITEM_GAP = 48;

function shortName(file?: File | null) {
  if (!file) return "Chưa chọn";
  return file.name.length <= 28 ? file.name : `${file.name.slice(0, 18)}...${file.name.slice(-7)}`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Không thể đọc ảnh."));
    };
    image.src = url;
  });
}

function imageToCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const scale = image.naturalWidth > MAX_PROCESS_WIDTH ? MAX_PROCESS_WIDTH / image.naturalWidth : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Trình duyệt không hỗ trợ Canvas.");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function getCanvasImageData(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Trình duyệt không hỗ trợ Canvas.");
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function saturation(r: number, g: number, b: number) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

function colorDistance(a: number[], b: number[]) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function estimateBorderColor(imageData: ImageData) {
  const { data, width, height } = imageData;
  const border = Math.max(4, Math.round(Math.min(width, height) * 0.04));
  const total = [0, 0, 0];
  let count = 0;

  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    total[0] += data[i];
    total[1] += data[i + 1];
    total[2] += data[i + 2];
    count += 1;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < border || x >= width - border || y < border || y >= height - border) {
        add(x, y);
      }
    }
  }

  return total.map((value) => value / Math.max(count, 1));
}

function findContentBox(canvas: HTMLCanvasElement, preferCard: boolean) {
  const imageData = getCanvasImageData(canvas);
  const { data, width, height } = imageData;
  const background = estimateBorderColor(imageData);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const sat = saturation(r, g, b);
      const dist = colorDistance([r, g, b], background);
      const isContent = preferCard ? sat > 0.12 || dist > 32 : dist > 24 || sat > 0.08;

      if (isContent) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        count += 1;
      }
    }
  }

  if (count < width * height * 0.005) return null;

  const pad = Math.max(8, Math.round(Math.min(width, height) * 0.02));
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  if (preferCard) {
    const ratio = Math.max(boxWidth, boxHeight) / Math.max(1, Math.min(boxWidth, boxHeight));
    const areaRatio = (boxWidth * boxHeight) / (width * height);
    if (ratio < 1.05 || ratio > 3.2 || areaRatio > 0.85) return null;
  }

  return { x: minX, y: minY, width: boxWidth, height: boxHeight };
}

function expandBoxToCardShape(box: CropBox, canvasWidth: number, canvasHeight: number): CropBox {
  const targetRatio = 1.585;
  let x = box.x;
  let y = box.y;
  let width = box.width;
  let height = box.height;
  const currentRatio = width / Math.max(1, height);

  if (currentRatio > targetRatio) {
    const nextHeight = Math.round(width / targetRatio);
    y -= Math.round((nextHeight - height) / 2);
    height = nextHeight;
  } else {
    const nextWidth = Math.round(height * targetRatio);
    x -= Math.round((nextWidth - width) / 2);
    width = nextWidth;
  }

  const padX = Math.round(width * 0.025);
  const padY = Math.round(height * 0.025);
  x -= padX;
  y -= padY;
  width += padX * 2;
  height += padY * 2;

  const x1 = Math.max(0, x);
  const y1 = Math.max(0, y);
  const x2 = Math.min(canvasWidth, x + width);
  const y2 = Math.min(canvasHeight, y + height);
  return { x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) };
}

function findCardBoxByColorCluster(canvas: HTMLCanvasElement) {
  const imageData = getCanvasImageData(canvas);
  const { data, width, height } = imageData;
  const background = estimateBorderColor(imageData);
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let count = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const sat = saturation(r, g, b);
      const brightness = (r + g + b) / 3;
      const dist = colorDistance([r, g, b], background);
      const coolOrNeutralCard =
        brightness > 55 &&
        dist > 16 &&
        g > 58 &&
        b > 54 &&
        (b >= r - 14 || g > r + 6 || (b >= r - 28 && Math.abs(r - g) < 24 && Math.abs(g - b) < 30));
      const darkInk = brightness < 105 && dist > 34 && Math.max(r, g, b) - Math.min(r, g, b) < 95;
      const redStamp = brightness > 45 && sat > 0.2 && dist > 24 && r > 130 && r > g + 30 && r > b + 30;
      const yellowMark =
        brightness > 65 && sat > 0.22 && dist > 30 && r > 145 && g > 105 && b < 105 && Math.abs(r - g) < 85;

      if (coolOrNeutralCard || darkInk || redStamp || yellowMark) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        count += 1;
      }
    }
  }

  const imageArea = width * height;
  if (count < imageArea * 0.003) return null;

  const rawBox = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const rawRatio = Math.max(rawBox.width, rawBox.height) / Math.max(1, Math.min(rawBox.width, rawBox.height));
  const rawAreaRatio = (rawBox.width * rawBox.height) / imageArea;
  if (rawRatio < 1.05 || rawRatio > 3.4 || rawAreaRatio > 0.75) return null;

  const box = expandBoxToCardShape(rawBox, width, height);
  const ratio = Math.max(box.width, box.height) / Math.max(1, Math.min(box.width, box.height));
  const areaRatio = (box.width * box.height) / imageArea;
  if (ratio < 1.15 || ratio > 2.45 || areaRatio > 0.82) return null;
  return box;
}

function findCardBoxByComponents(canvas: HTMLCanvasElement) {
  const imageData = getCanvasImageData(canvas);
  const { data, width, height } = imageData;
  const background = estimateBorderColor(imageData);
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const sat = saturation(r, g, b);
      const dist = colorDistance([r, g, b], background);
      const brightness = (r + g + b) / 3;
      const coolOrNeutralCard =
        brightness > 55 &&
        dist > 16 &&
        g > 58 &&
        b > 54 &&
        (b >= r - 14 || g > r + 6 || (b >= r - 28 && Math.abs(r - g) < 24 && Math.abs(g - b) < 30));
      const darkInk = brightness < 105 && dist > 34 && Math.max(r, g, b) - Math.min(r, g, b) < 95;
      const redYellowStamp =
        sat > 0.2 &&
        dist > 24 &&
        ((r > 130 && r > g + 30 && r > b + 30) || (r > 145 && g > 105 && b < 105 && Math.abs(r - g) < 85));

      if (coolOrNeutralCard || darkInk || redYellowStamp) {
        mask[y * width + x] = 1;
      }
    }
  }

  const visited = new Uint8Array(width * height);
  const imageArea = width * height;
  const candidates: Array<{ score: number; x: number; y: number; width: number; height: number }> = [];
  const queue = new Int32Array(imageArea);

  for (let start = 0; start < imageArea; start += 1) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    let count = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    visited[start] = 1;
    queue[tail] = start;
    tail += 1;

    while (head < tail) {
      const index = queue[head];
      head += 1;
      count += 1;
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const next of neighbors) {
        if (next < 0 || next >= imageArea || visited[next] || !mask[next]) continue;
        if ((next === index - 1 && x === 0) || (next === index + 1 && x === width - 1)) continue;
        visited[next] = 1;
        queue[tail] = next;
        tail += 1;
      }
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const boxArea = boxWidth * boxHeight;
    const fillRatio = count / Math.max(1, boxArea);
    const imageRatio = boxArea / imageArea;
    const aspectRatio = Math.max(boxWidth, boxHeight) / Math.max(1, Math.min(boxWidth, boxHeight));

    if (
      count < imageArea * 0.002 ||
      imageRatio < 0.012 ||
      imageRatio > 0.72 ||
      boxWidth < 90 ||
      boxHeight < 55 ||
      aspectRatio < 1.18 ||
      aspectRatio > 2.35 ||
      fillRatio < 0.08
    ) {
      continue;
    }

    const aspectScore = 1 - Math.min(Math.abs(aspectRatio - 1.58) / 0.9, 1);
    const areaScore = Math.min(imageRatio / 0.22, 1);
    const fillScore = Math.min(fillRatio / 0.35, 1);
    const pad = Math.max(3, Math.round(Math.min(width, height) * 0.006));
    const box = expandBoxToCardShape(
      {
        x: minX,
        y: minY,
        width: boxWidth,
        height: boxHeight
      },
      width,
      height
    );
    candidates.push({
      score: aspectScore * 0.45 + areaScore * 0.35 + fillScore * 0.2,
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: Math.min(width, box.x + box.width + pad) - Math.max(0, box.x - pad),
      height: Math.min(height, box.y + box.height + pad) - Math.max(0, box.y - pad)
    });
  }

  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.score - a.score)[0];
}

function cropCanvas(canvas: HTMLCanvasElement, preferCard: boolean) {
  const fallbackBox = preferCard ? findContentBox(canvas, preferCard) : null;
  const canUseFallback =
    fallbackBox !== null && (fallbackBox.width * fallbackBox.height) / (canvas.width * canvas.height) < 0.62;
  const box = preferCard
    ? findCardBoxByColorCluster(canvas) ?? findCardBoxByComponents(canvas) ?? (canUseFallback ? fallbackBox : null)
    : findContentBox(canvas, preferCard);
  if (!box) return canvas;

  const cropped = document.createElement("canvas");
  cropped.width = box.width;
  cropped.height = box.height;
  const ctx = cropped.getContext("2d");
  if (!ctx) throw new Error("Trình duyệt không hỗ trợ Canvas.");
  ctx.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  return preferCard ? trimOuterCardBackground(cropped) : cropped;
}

function trimOuterCardBackground(canvas: HTMLCanvasElement) {
  const imageData = getCanvasImageData(canvas);
  const { data, width, height } = imageData;
  const background = estimateBorderColor(imageData);
  const isDifferentFromTable = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const sat = saturation(r, g, b);
    const dist = colorDistance([r, g, b], background);
    const brightness = (r + g + b) / 3;
    const coolPaper = brightness > 50 && g > 55 && b > 52 && (b >= r - 32 || g > r + 4);
    const darkOrPrinted = brightness < 120 && dist > 26;
    return (dist > 16 && coolPaper) || (sat > 0.11 && dist > 20) || darkOrPrinted;
  };

  const columnHits = (x: number) => {
    let hits = 0;
    for (let y = 0; y < height; y += 1) {
      if (isDifferentFromTable(x, y)) hits += 1;
    }
    return hits;
  };

  const rowHits = (y: number) => {
    let hits = 0;
    for (let x = 0; x < width; x += 1) {
      if (isDifferentFromTable(x, y)) hits += 1;
    }
    return hits;
  };

  const columnThreshold = Math.max(4, Math.round(height * 0.28));
  const rowThreshold = Math.max(4, Math.round(width * 0.28));
  const hasColumnEdge = (x: number) => {
    const from = Math.max(0, x - 1);
    const to = Math.min(width - 1, x + 1);
    let total = 0;
    for (let i = from; i <= to; i += 1) total += columnHits(i);
    return total / (to - from + 1) >= columnThreshold;
  };
  const hasRowEdge = (y: number) => {
    const from = Math.max(0, y - 1);
    const to = Math.min(height - 1, y + 1);
    let total = 0;
    for (let i = from; i <= to; i += 1) total += rowHits(i);
    return total / (to - from + 1) >= rowThreshold;
  };

  let left = 0;
  let right = width - 1;
  let top = 0;
  let bottom = height - 1;

  while (left < right && !hasColumnEdge(left)) left += 1;
  while (right > left && !hasColumnEdge(right)) right -= 1;
  while (top < bottom && !hasRowEdge(top)) top += 1;
  while (bottom > top && !hasRowEdge(bottom)) bottom -= 1;

  const pad = Math.max(1, Math.round(Math.min(width, height) * 0.004));
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad);
  bottom = Math.min(height - 1, bottom + pad);

  const nextWidth = right - left + 1;
  const nextHeight = bottom - top + 1;
  const removedArea = 1 - (nextWidth * nextHeight) / (width * height);
  const nextRatio = Math.max(nextWidth, nextHeight) / Math.max(1, Math.min(nextWidth, nextHeight));
  if (removedArea < 0.015 || nextWidth < 80 || nextHeight < 50 || nextRatio < 1.15 || nextRatio > 2.45) {
    return canvas;
  }

  const trimmed = document.createElement("canvas");
  trimmed.width = nextWidth;
  trimmed.height = nextHeight;
  const ctx = trimmed.getContext("2d");
  if (!ctx) throw new Error("Trình duyệt không hỗ trợ Canvas.");
  ctx.drawImage(canvas, left, top, nextWidth, nextHeight, 0, 0, nextWidth, nextHeight);
  return trimmed;
}

function looksUpsideDown(canvas: HTMLCanvasElement) {
  const imageData = getCanvasImageData(canvas);
  const { data, width, height } = imageData;
  let warmX = 0;
  let warmY = 0;
  let warmCount = 0;
  let topDark = 0;
  let bottomDark = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const isRed = r > 135 && g < 115 && b < 115;
      const isYellow = r > 150 && g > 110 && b < 95;
      if (isRed || isYellow) {
        warmX += x;
        warmY += y;
        warmCount += 1;
      }
      const brightness = (r + g + b) / 3;
      if (brightness < 85) {
        if (y < height / 2) topDark += 1;
        else bottomDark += 1;
      }
    }
  }

  let uprightScore = 0;
  let upsideScore = 0;
  if (warmCount > 40) {
    const cx = warmX / warmCount;
    const cy = warmY / warmCount;
    if (cy < height * 0.48) uprightScore += 2;
    if (cy > height * 0.52) upsideScore += 2;
    if (cx < width * 0.48) uprightScore += 0.7;
    if (cx > width * 0.52) upsideScore += 0.7;
  }

  if (bottomDark > topDark * 1.15) uprightScore += 0.8;
  if (topDark > bottomDark * 1.15) upsideScore += 0.8;
  return upsideScore >= uprightScore + 0.6;
}

function rotate180(canvas: HTMLCanvasElement) {
  const rotated = document.createElement("canvas");
  rotated.width = canvas.width;
  rotated.height = canvas.height;
  const ctx = rotated.getContext("2d");
  if (!ctx) throw new Error("Trình duyệt không hỗ trợ Canvas.");
  ctx.translate(rotated.width, rotated.height);
  ctx.rotate(Math.PI);
  ctx.drawImage(canvas, 0, 0);
  return rotated;
}

async function processFile(file: File, preferCard: boolean) {
  const image = await loadImage(file);
  let canvas = imageToCanvas(image);
  canvas = cropCanvas(canvas, preferCard);
  if (preferCard && looksUpsideDown(canvas)) {
    canvas = rotate180(canvas);
  }
  return canvas;
}

function resizeCanvasKeepRatio(source: HTMLCanvasElement, targetWidth: number) {
  const targetHeight = Math.max(1, Math.round((source.height * targetWidth) / source.width));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Trình duyệt không hỗ trợ Canvas.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
  return canvas;
}

function createFinalCanvas(frontSource: HTMLCanvasElement, backSource: HTMLCanvasElement, zaloSource: HTMLCanvasElement) {
  const front = resizeCanvasKeepRatio(frontSource, CARD_TARGET_WIDTH);
  const back = resizeCanvasKeepRatio(backSource, CARD_TARGET_WIDTH);
  const zalo = resizeCanvasKeepRatio(zaloSource, ZALO_TARGET_WIDTH);
  const topHeight = Math.max(front.height, back.height);
  const width = CANVAS_PADDING * 2 + CARD_TARGET_WIDTH * 2 + ITEM_GAP;
  const height = CANVAS_PADDING * 2 + topHeight + ITEM_GAP + zalo.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Trình duyệt không hỗ trợ Canvas.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(front, CANVAS_PADDING, CANVAS_PADDING);
  ctx.drawImage(back, CANVAS_PADDING + CARD_TARGET_WIDTH + ITEM_GAP, CANVAS_PADDING);
  ctx.drawImage(zalo, CANVAS_PADDING, CANVAS_PADDING + topHeight + ITEM_GAP);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Không thể xuất ảnh."));
        else resolve(blob);
      },
      "image/jpeg",
      0.95
    );
  });
}

export default function Page() {
  const [files, setFiles] = useState<Record<UploadKey, File | null>>({
    front: null,
    back: null,
    zalo: null
  });
  const [mergeNote, setMergeNote] = useState("Ảnh chỉ xử lý cục bộ, không OCR, không lưu dữ liệu.");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [downloadName, setDownloadName] = useState("anh_giay_to_hoan_chinh.jpg");
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allSelected = useMemo(() => files.front && files.back && files.zalo, [files]);

  useEffect(() => {
    fetch("/api/content?key=settings")
      .then((response) => response.json())
      .then((settings: { mergeNote?: string }) => {
        if (settings.mergeNote) setMergeNote(settings.mergeNote);
      })
      .catch(() => undefined);
  }, []);

  const onFileChange = (key: UploadKey) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setFiles((current) => ({ ...current, [key]: file }));
    setMessage(null);
    setError(null);
  };

  const generateImage = async () => {
    setError(null);
    setMessage(null);
    if (!files.front || !files.back || !files.zalo) {
      setError("Vui lòng chọn đủ 3 ảnh.");
      return;
    }

    setIsProcessing(true);
    try {
      let blob: Blob;

      try {
        const formData = new FormData();
        formData.append("front", files.front);
        formData.append("back", files.back);
        formData.append("zalo", files.zalo);
        formData.append("format", "jpeg");

        const endpoint = window.location.hostname.endsWith("vercel.app") ? "/api/compose-python" : "/api/compose";
        const response = await fetch(endpoint, {
          method: "POST",
          body: formData
        });

        if (!response.ok) {
          throw new Error("Bộ xử lý ảnh trên server chưa sẵn sàng.");
        }

        blob = await response.blob();
      } catch (serverError) {
        console.warn("Chuyển sang xử lý ảnh trên trình duyệt:", serverError);
        const [front, back, zalo] = await Promise.all([
          processFile(files.front, true),
          processFile(files.back, true),
          processFile(files.zalo, false)
        ]);
        const finalCanvas = createFinalCanvas(front, back, zalo);
        blob = await canvasToBlob(finalCanvas);
      }

      const url = URL.createObjectURL(blob);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(url);
      setResultBlob(blob);
      setDownloadName("anh_giay_to_hoan_chinh.jpg");
      setMessage("Đã tạo ảnh hoàn chỉnh.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể xử lý ảnh.");
    } finally {
      setIsProcessing(false);
    }
  };

  const saveResultImage = async () => {
    if (!resultUrl || !resultBlob) return;

    const file = new File([resultBlob], downloadName, {
      type: resultBlob.type || (downloadName.endsWith(".png") ? "image/png" : "image/jpeg")
    });

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: "Ảnh giấy tờ hoàn chỉnh"
        });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }

    const link = document.createElement("a");
    link.href = resultUrl;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <PortalShell title="Ghép ảnh" showBack>
      <h2 className="sectionTitle">Ghép ảnh giấy tờ tùy thân</h2>
      <div className="privacy">{mergeNote}</div>

      <section className="card mergeCard">
        <h2 className="sectionTitle">Tải ảnh lên</h2>
        {uploadItems.map((item, index) => (
          <div className="uploadItem" key={item.key}>
            <div className="uploadText">
              <div className="uploadHeading">
                <span className="step">{index + 1}</span>
                <span className="uploadLabel">{item.label}</span>
              </div>
              <div className={files[item.key] ? "fileStatus fileStatusDone" : "fileStatus"}>
                {files[item.key] ? `Đã chọn ảnh: ${shortName(files[item.key])}` : "Chưa chọn"}
              </div>
            </div>
            <label className="chooseButton">
              Chọn ảnh
              <input
                className="fileInput"
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp,.jfif"
                onChange={onFileChange(item.key)}
              />
            </label>
          </div>
        ))}

        <button className="primaryButton mergeCreateButton" type="button" onClick={generateImage} disabled={isProcessing}>
          {isProcessing ? "Đang xử lý..." : "Tạo ảnh hoàn chỉnh"}
        </button>

        {error && <div className="error">{error}</div>}
        {message && <div className="success">{message}</div>}
      </section>

      <section className="card mergeCard">
        <h2 className="sectionTitle">Kết quả</h2>
        {!resultUrl ? (
          <div className="resultEmpty">Ảnh hoàn chỉnh sẽ hiển thị tại đây</div>
        ) : (
          <>
            <div className="resultFrame">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="resultImage" src={resultUrl} alt="Ảnh kết quả" />
            </div>
            <button className="downloadButton" type="button" onClick={saveResultImage}>
              Lưu ảnh / Tải ảnh về
            </button>
          </>
        )}
      </section>
    </PortalShell>
  );
}

