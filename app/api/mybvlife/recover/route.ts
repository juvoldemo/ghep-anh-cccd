import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const myBVLifeUrl = "https://mybvlapi.baovietnhantho.com.vn/eposws/api/user/forgotPasswordValid";
const rateLimitPerMinute = 10;
const buckets = new Map<string, number[]>();

function maskIdentityNo(identityNo: string) {
  const digits = identityNo.replace(/\D/g, "");
  if (digits.length <= 6) return "*".repeat(digits.length);
  return `${digits.slice(0, 4)}${"*".repeat(Math.max(digits.length - 6, 0))}${digits.slice(-2)}`;
}

function clientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
}

function checkRateLimit(ip: string) {
  const now = Date.now();
  const windowStart = now - 60_000;
  const entries = (buckets.get(ip) || []).filter((stamp) => stamp >= windowStart);
  if (entries.length >= rateLimitPerMinute) return false;
  entries.push(now);
  buckets.set(ip, entries);
  return true;
}

function coerceResponseStatus(value: unknown) {
  if (value === null || value === undefined) return null;
  const status = Number(value);
  return Number.isFinite(status) ? status : null;
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ detail: "Bạn thao tác quá nhanh, vui lòng thử lại sau." }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as { full_name?: string; identity_no?: string } | null;
  const fullName = body?.full_name?.trim() || "";
  const identityNo = (body?.identity_no || "").replace(/\D/g, "");

  if (!fullName) {
    return NextResponse.json({ detail: "Họ và tên không được để trống." }, { status: 400 });
  }

  if (![9, 12].includes(identityNo.length)) {
    return NextResponse.json({ detail: "Số CCCD/GTTT phải gồm 9 hoặc 12 chữ số." }, { status: 400 });
  }

  try {
    const response = await fetch(myBVLifeUrl, {
      method: "POST",
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=utf-8",
        Origin: "https://mybvlife.baovietnhantho.com.vn",
        Referer: "https://mybvlife.baovietnhantho.com.vn/",
        "User-Agent": "Mozilla/5.0"
      },
      body: JSON.stringify({ strIdenti: identityNo, strName: fullName })
    });

    const raw = (await response.json().catch(() => ({}))) as { responseStatus?: number | string; responseMessage?: string };
    const responseStatus = coerceResponseStatus(raw.responseStatus);
    const message =
      raw.responseMessage ||
      (responseStatus === 220
        ? "Khôi phục thành công."
        : responseStatus === 412
          ? "Không tìm thấy thông tin phù hợp."
          : response.status === 403
            ? "API MyBVLife đang từ chối truy cập từ môi trường hiện tại (HTTP 403). Vui lòng kiểm tra VPN nội bộ, whitelist IP hoặc quyền tích hợp API."
          : `MyBVLife trả về trạng thái không xác định (HTTP ${response.status}).`);

    return NextResponse.json({
      success: responseStatus === 220,
      http_status: response.status,
      response_status: responseStatus,
      message,
      masked_identity_no: maskIdentityNo(identityNo),
      raw
    });
  } catch {
    return NextResponse.json({ detail: "Có lỗi xảy ra, vui lòng thử lại sau." }, { status: 502 });
  }
}
