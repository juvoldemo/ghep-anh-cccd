export type OcrResult = {
  ok: boolean;
  source: "ai_vision" | "qr" | "ocr" | "cropped_field_ocr";
  data: {
    fullName: string;
    cccd: string;
    cmnd: string;
  };
  warnings: string[];
  message: string | null;
  confidence?: {
    fullName?: number;
    cccd?: number;
    cmnd?: number;
  };
  method?: "ai_vision" | "qr" | "cropped_field_ocr" | "full_image_fallback_ocr";
  processing_time_ms?: number;
  debug_timing?: {
    resize_time_ms?: number;
    crop_time_ms?: number;
    ocr_cccd_time_ms?: number;
    ocr_cmnd_time_ms?: number;
    ocr_name_time_ms?: number;
    fallback_time_ms?: number;
  };
  full_name?: string;
  identity_no?: string;
  old_id_no?: string;
};

export type RecoveryResult = {
  success: boolean;
  http_status: number;
  response_status: number | null;
  message: string;
  masked_identity_no: string;
  raw?: unknown;
};

const apiBase = (process.env.NEXT_PUBLIC_MYBVLIFE_API_BASE || "").replace(/\/$/, "");
const myBVLifeValidateUrl = "https://mybvlapi.baovietnhantho.com.vn/eposws/api/user/forgotPasswordValid";
const myBVLifeConfirmUrl = "https://mybvlapi.baovietnhantho.com.vn/eposws/api/user/forgotPassword";

function getOcrUrl() {
  if (!apiBase) return "/api/mybvlife/ocr";
  if (typeof window !== "undefined") {
    const isLocalPage = ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const isLocalApi = /\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(apiBase);
    if (!isLocalPage && isLocalApi) return "/api/mybvlife/ocr";
  }
  return `${apiBase}/api/ocr-cccd`;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as (T & { detail?: string; message?: string }) | null;
  if (!response.ok) {
    throw new Error(data?.detail || data?.message || "Có lỗi xảy ra, vui lòng thử lại sau.");
  }
  return data as T;
}

export async function ocrCccd(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(getOcrUrl(), {
    method: "POST",
    body: formData
  });
  return readJson<OcrResult>(response);
}

export async function recoverMyBVLife(full_name: string, identity_no: string) {
  const response = await fetch(myBVLifeValidateUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=utf-8"
    },
    body: JSON.stringify({ strIdenti: identity_no, strName: full_name })
  });
  const raw = (await response.json().catch(() => ({}))) as { responseStatus?: number | string; responseMessage?: string; message?: string };
  const responseStatus = raw.responseStatus === undefined || raw.responseStatus === null ? null : Number(raw.responseStatus);
  const message =
    raw.responseMessage ||
    raw.message ||
    (responseStatus === 220
      ? "Khôi phục thành công."
      : responseStatus === 412
        ? "Không tìm thấy thông tin phù hợp."
        : `MyBVLife trả về trạng thái không xác định (HTTP ${response.status}).`);

  if (!response.ok && !responseStatus) {
    throw new Error(message);
  }

  return {
    success: responseStatus === 220,
    http_status: response.status,
    response_status: Number.isFinite(responseStatus) ? responseStatus : null,
    message,
    masked_identity_no: identity_no.length > 6 ? `${identity_no.slice(0, 4)}${"*".repeat(Math.max(identity_no.length - 6, 0))}${identity_no.slice(-2)}` : "*".repeat(identity_no.length),
    raw
  } satisfies RecoveryResult;
}

export async function confirmMyBVLifeRecovery(full_name: string, identity_no: string) {
  const response = await fetch(myBVLifeConfirmUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=utf-8"
    },
    body: JSON.stringify({ strIdenti: identity_no, strName: full_name })
  });
  const raw = (await response.json().catch(() => ({}))) as { responseStatus?: number | string; responseMessage?: string; message?: string };
  const responseStatus = raw.responseStatus === undefined || raw.responseStatus === null ? null : Number(raw.responseStatus);
  const message =
    raw.responseMessage ||
    raw.message ||
    (responseStatus === 200 ? "Thông tin tài khoản đã được gửi thành công." : `MyBVLife trả về trạng thái không xác định (HTTP ${response.status}).`);

  if (!response.ok && !responseStatus) {
    throw new Error(message);
  }

  return {
    success: responseStatus === 200,
    http_status: response.status,
    response_status: Number.isFinite(responseStatus) ? responseStatus : null,
    message,
    masked_identity_no: identity_no.length > 6 ? `${identity_no.slice(0, 4)}${"*".repeat(Math.max(identity_no.length - 6, 0))}${identity_no.slice(-2)}` : "*".repeat(identity_no.length),
    raw
  } satisfies RecoveryResult;
}
