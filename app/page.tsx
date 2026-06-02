"use client";

import { ChangeEvent, useMemo, useState } from "react";

type OutputFormat = "jpeg" | "png";
type UploadKey = "front" | "back" | "zalo";

type UploadItem = {
  key: UploadKey;
  label: string;
};

const uploadItems: UploadItem[] = [
  { key: "front", label: "Mặt trước CCCD" },
  { key: "back", label: "Mặt sau CCCD" },
  { key: "zalo", label: "Ảnh thông tin Zalo" }
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

function cropCanvas(canvas: HTMLCanvasElement, preferCard: boolean) {
  const box = findContentBox(canvas, preferCard);
  if (!box) return canvas;

  const cropped = document.createElement("canvas");
  cropped.width = box.width;
  cropped.height = box.height;
  const ctx = cropped.getContext("2d");
  if (!ctx) throw new Error("Trình duyệt không hỗ trợ Canvas.");
  ctx.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
  return cropped;
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

function canvasToBlob(canvas: HTMLCanvasElement, format: OutputFormat) {
  const mime = format === "jpeg" ? "image/jpeg" : "image/png";
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Không thể xuất ảnh."));
        else resolve(blob);
      },
      mime,
      format === "jpeg" ? 0.95 : undefined
    );
  });
}

export default function Page() {
  const [files, setFiles] = useState<Record<UploadKey, File | null>>({
    front: null,
    back: null,
    zalo: null
  });
  const [format, setFormat] = useState<OutputFormat>("jpeg");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState("anh_giay_to_hoan_chinh.jpg");
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const allSelected = useMemo(() => files.front && files.back && files.zalo, [files]);

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
      const [front, back, zalo] = await Promise.all([
        processFile(files.front, true),
        processFile(files.back, true),
        processFile(files.zalo, false)
      ]);
      const finalCanvas = createFinalCanvas(front, back, zalo);
      const blob = await canvasToBlob(finalCanvas, format);
      const url = URL.createObjectURL(blob);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(url);
      setDownloadName(`anh_giay_to_hoan_chinh.${format === "jpeg" ? "jpg" : "png"}`);
      setMessage("Đã tạo ảnh hoàn chỉnh.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể xử lý ảnh.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <main className="page">
      <div className="phoneShell">
        <header>
          <div className="brand">
            <span className="brandPrimary">BAOVIET</span>
            <span className="brandLife">Life</span>
          </div>
          <div className="brandSub">Ghép ảnh giấy tờ tùy thân</div>
        </header>

        <h1 className="title">Ghép ảnh giấy tờ tùy thân</h1>
        <div className="privacy">Ảnh chỉ xử lý cục bộ, không OCR, không lưu dữ liệu.</div>

        <section className="card">
          <h2 className="sectionTitle">Upload ảnh</h2>
          {uploadItems.map((item, index) => (
            <div className="uploadItem" key={item.key}>
              <div className="uploadHeading">
                <span className="step">{index + 1}</span>
                <span>{item.label}</span>
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
              <div className={files[item.key] ? "fileStatus fileStatusDone" : "fileStatus"}>
                {files[item.key] ? `Đã chọn ảnh: ${shortName(files[item.key])}` : "Chưa chọn"}
              </div>
            </div>
          ))}

          <div className="formatTitle">Định dạng xuất ảnh</div>
          <div className="radioRow">
            <label className="radioLabel">
              <input
                type="radio"
                checked={format === "jpeg"}
                onChange={() => setFormat("jpeg")}
              />
              JPG
            </label>
            <label className="radioLabel">
              <input
                type="radio"
                checked={format === "png"}
                onChange={() => setFormat("png")}
              />
              PNG
            </label>
          </div>

          <button className="primaryButton" type="button" onClick={generateImage} disabled={isProcessing}>
            {isProcessing ? "Đang xử lý..." : "Tạo ảnh hoàn chỉnh"}
          </button>

          {error && <div className="error">{error}</div>}
          {message && <div className="success">{message}</div>}
          {!allSelected && !error && <div className="fileStatus">Chọn đủ 3 ảnh để bắt đầu xử lý.</div>}
        </section>

        <section className="card">
          <h2 className="sectionTitle">Kết quả</h2>
          {!resultUrl ? (
            <div className="resultEmpty">Ảnh hoàn chỉnh sẽ hiển thị tại đây</div>
          ) : (
            <>
              <div className="resultFrame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="resultImage" src={resultUrl} alt="Ảnh kết quả" />
              </div>
              <a className="downloadButton" href={resultUrl} download={downloadName}>
                Tải ảnh về
              </a>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
