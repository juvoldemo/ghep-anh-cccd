import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type AiOcrData = {
  fullName: string;
  cccd: string;
  cmnd: string;
};

const maxFileSize = 10 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png"]);
const defaultAiBaseUrl = "https://api.openai.com/v1";
const defaultAiModel = "gpt-4o-mini";

const systemPrompt =
  "Bạn là hệ thống OCR chuyên trích xuất dữ liệu từ ảnh kết quả quét QR CCCD trên Zalo hoặc ảnh CCCD Việt Nam. Chỉ trả về JSON hợp lệ, không giải thích.";

const userPrompt =
  'Đọc ảnh và trả về đúng JSON theo schema {"fullName":"","cccd":"","cmnd":""}. ' +
  "Lấy Họ và tên, Số CCCD, Số CMND. Giữ nguyên dấu tiếng Việt của họ tên. " +
  "Số CCCD và CMND chỉ giữ chữ số. Không lấy ngày sinh, giới tính, địa chỉ, ngày cấp. " +
  "Nếu không thấy Số CMND thì để cmnd rỗng.";

function getAiConfig() {
  const baseUrl = (process.env.AI_API_BASE_URL || process.env.OPENAI_BASE_URL || defaultAiBaseUrl).replace(/\/$/, "");
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
  const model = process.env.AI_MODEL || process.env.OPENAI_MODEL || defaultAiModel;
  return { baseUrl, apiKey, model };
}

function digitsOnly(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function cleanName(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractJsonObject(text: string) {
  const withoutFence = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(withoutFence);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(withoutFence.slice(start, end + 1));
        return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
      } catch {
        return {};
      }
    }
    return {};
  }
}

function normalizeAiData(raw: Record<string, unknown>): AiOcrData {
  return {
    fullName: cleanName(raw.fullName || raw.full_name || raw.name),
    cccd: digitsOnly(raw.cccd || raw.identity_no || raw.identityNo),
    cmnd: digitsOnly(raw.cmnd || raw.old_id_no || raw.oldIdentityNo)
  };
}

function validateData(data: AiOcrData) {
  const warnings: string[] = [];
  if (!data.fullName || data.fullName.split(/\s+/).length < 2 || /\d/.test(data.fullName)) {
    warnings.push("Không đọc được họ tên hợp lệ, vui lòng kiểm tra lại.");
  }
  if (data.cccd.length !== 12) {
    warnings.push("Không đọc được số CCCD/GTTT hợp lệ, vui lòng kiểm tra lại.");
  }
  if (data.cmnd && ![9, 12].includes(data.cmnd.length)) {
    warnings.push("Số CMND không hợp lệ, vui lòng kiểm tra lại.");
  }
  return { ok: Boolean(data.fullName && data.cccd.length === 12), warnings };
}

function responseFromData(data: AiOcrData, warnings: string[], ok: boolean) {
  return {
    ok,
    source: "ai_vision",
    data,
    warnings,
    message: ok ? null : "AI chưa đọc đủ thông tin CCCD. Vui lòng kiểm tra ảnh hoặc nhập thủ công.",
    confidence: { fullName: ok ? 0.9 : 0, cccd: data.cccd.length === 12 ? 0.9 : 0, cmnd: data.cmnd ? 0.9 : 0 },
    method: "ai_vision",
    processing_time_ms: 0,
    debug_timing: {},
    full_name: data.fullName,
    identity_no: data.cccd,
    old_id_no: data.cmnd
  };
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const { baseUrl, apiKey, model } = getAiConfig();

  if (!apiKey) {
    return NextResponse.json({ detail: "Chưa cấu hình AI_API_KEY hoặc OPENAI_API_KEY trên Vercel." }, { status: 500 });
  }

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

  const imageBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const imageUrl = `data:${file.type};base64,${imageBase64}`;

  try {
    const requestBody = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }
      ],
      temperature: 0,
      response_format: { type: "json_object" }
    };
    let aiResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    let rawAiData = await aiResponse.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
    if (!aiResponse.ok && rawAiData?.error?.message?.toLowerCase().includes("response_format")) {
      const { response_format: _responseFormat, ...fallbackBody } = requestBody;
      aiResponse = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(fallbackBody)
      });
      rawAiData = await aiResponse.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } } | null;
    }

    if (!aiResponse.ok) {
      return NextResponse.json({ detail: rawAiData?.error?.message || "AI OCR trả về lỗi, vui lòng thử lại." }, { status: 502 });
    }

    const content = rawAiData?.choices?.[0]?.message?.content || "";
    const data = normalizeAiData(extractJsonObject(content));
    const validation = validateData(data);
    const response = responseFromData(data, validation.warnings, validation.ok);

    return NextResponse.json({ ...response, processing_time_ms: Date.now() - startedAt });
  } catch {
    return NextResponse.json({ detail: "Không gọi được AI OCR. Vui lòng kiểm tra cấu hình API key trên Vercel." }, { status: 502 });
  }
}
