import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const maxFileSize = 10 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png"]);
const backendTimeoutMs = 52_000;

function getBackendOcrUrl() {
  const base = (process.env.MYBVLIFE_API_BASE || process.env.NEXT_PUBLIC_MYBVLIFE_API_BASE || "http://127.0.0.1:8000").replace(/\/$/, "");
  return `${base}/api/ocr-cccd`;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ detail: "Vui lòng tải ảnh CCCD hoặc ảnh thông tin CCCD từ Zalo." }, { status: 400 });
  }
  if (!allowedTypes.has(file.type)) {
    return NextResponse.json({ detail: "Vui lòng tải ảnh JPG, JPEG hoặc PNG." }, { status: 400 });
  }
  if (file.size > maxFileSize) {
    return NextResponse.json({ detail: "Dung lượng ảnh tối đa 10MB." }, { status: 400 });
  }

  const proxyForm = new FormData();
  proxyForm.append("file", file, file.name || "zalo-cccd.png");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), backendTimeoutMs);

  try {
    const response = await fetch(getBackendOcrUrl(), {
      method: "POST",
      body: proxyForm,
      signal: controller.signal
    });
    const data = await response.json().catch(() => null);
    return NextResponse.json(data || { detail: "Backend OCR trả về dữ liệu không hợp lệ." }, { status: response.status });
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? "Backend OCR phản hồi quá lâu. Render có thể đang cold start hoặc đang tải model PaddleOCR lần đầu, vui lòng chờ 1-2 phút rồi thử lại."
        : "Chưa kết nối được backend OCR. Vui lòng chạy FastAPI backend hoặc cấu hình MYBVLIFE_API_BASE.";

    return NextResponse.json(
      {
        ok: false,
        source: "cropped_field_ocr",
        data: { fullName: "", cccd: "", cmnd: "" },
        warnings: [],
        message
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
