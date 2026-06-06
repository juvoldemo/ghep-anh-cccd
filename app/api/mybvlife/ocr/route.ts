import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const maxFileSize = 10 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png"]);
const defaultModel = "gpt-4o-mini";
const readFailedMessage = "Không đọc được thông tin CCCD. Vui lòng thử ảnh rõ hơn.";
const missingSurnameWarning = "Họ tên có thể bị thiếu họ, vui lòng kiểm tra lại.";

const systemPrompt =
  "Bạn là hệ thống trích xuất dữ liệu từ ảnh CCCD Việt Nam hoặc ảnh màn hình kết quả quét QR CCCD từ Zalo. Chỉ trả về JSON hợp lệ, không giải thích.";

const userPrompt =
  'Hãy đọc ảnh và trích xuất đúng 3 trường: Họ và tên, Số CCCD, Số CMND. Trả về JSON theo schema: {"fullName":"","cccd":"","cmnd":""}. ' +
  "Quy tắc: giữ nguyên dấu tiếng Việt của họ tên; không bỏ họ đầu tiên như Nguyễn, Trần, Lê, Phạm, Hoàng, Huỳnh, Võ, Đặng, Bùi, Đỗ, Tống, Ngô, Lâm; " +
  "nếu thấy nhãn Họ và tên, lấy đầy đủ dòng tên ngay bên dưới; nếu tên bị xuống dòng, ghép đầy đủ các phần của tên; số CCCD và CMND chỉ giữ chữ số; " +
  "không lấy ngày sinh, giới tính, địa chỉ, ngày cấp; nếu không thấy trường nào thì để chuỗi rỗng.";

type AiData = {
  fullName: string;
  cccd: string;
  cmnd: string;
};

function loadLocalEnvValue(key: string) {
  for (const relativePath of [".env", join("backend", ".env")]) {
    try {
      const content = readFileSync(join(process.cwd(), relativePath), "utf8");
      const line = content.split(/\r?\n/).find((item) => item.trim().startsWith(`${key}=`));
      if (!line) continue;
      return line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
    } catch {
      // Vercel uses process.env; local fallback is best-effort only.
    }
  }
  return "";
}

function envValue(key: string) {
  return (process.env[key] || loadLocalEnvValue(key)).trim();
}

function digitsOnly(value: string) {
  return (value || "").replace(/\D/g, "");
}

function cleanSpaces(value: string) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function stripAccents(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

function matchNameCase(source: string, replacement: string) {
  if (source === source.toLocaleUpperCase("vi-VN")) return replacement.toLocaleUpperCase("vi-VN");
  if (source.charAt(0) === source.charAt(0).toLocaleUpperCase("vi-VN")) return replacement;
  return replacement.toLocaleLowerCase("vi-VN");
}

function normalizeVietnameseMiddleName(value: string) {
  const words = cleanSpaces(value).split(" ").filter(Boolean);
  if (words.length < 3) return words.join(" ");

  const middleNameMap: Record<string, string> = {
    thi: "Thị",
    van: "Văn",
    huu: "Hữu",
    duc: "Đức",
    dinh: "Đình",
    ngoc: "Ngọc",
    quoc: "Quốc"
  };

  return words
    .map((word, index) => {
      const key = stripAccents(word).replace(/[^a-z]/g, "");
      if (index > 0 && index < words.length - 1 && middleNameMap[key]) {
        return matchNameCase(word, middleNameMap[key]);
      }
      return word;
    })
    .join(" ");
}

function cleanName(value: string) {
  return normalizeVietnameseMiddleName(cleanSpaces((value || "").replace(/^[\s:,\-–—]+|[\s:,\-–—]+$/g, "")));
}

function extractJsonObject(text: string) {
  let cleaned = (text || "").trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }

  try {
    const data = JSON.parse(cleaned);
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const data = JSON.parse(cleaned.slice(start, end + 1));
        return data && typeof data === "object" && !Array.isArray(data) ? data : {};
      } catch {
        return {};
      }
    }
  }
  return {};
}

function extractMessageContent(apiData: unknown) {
  const data = apiData as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (item && typeof item === "object" && "text" in item && typeof item.text === "string" ? item.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function normalizeAiData(raw: Record<string, unknown>): AiData {
  return {
    fullName: cleanName(String(raw.fullName || raw.full_name || "")),
    cccd: digitsOnly(String(raw.cccd || raw.identity_no || "")),
    cmnd: digitsOnly(String(raw.cmnd || raw.old_identity_no || ""))
  };
}

function validateAiData(data: AiData) {
  const warnings: string[] = [];
  const words = data.fullName.split(" ").filter(Boolean);
  const firstWord = stripAccents(words[0] || "");

  if (!data.fullName) {
    warnings.push("Không đọc được họ tên, vui lòng nhập thủ công.");
  } else if (words.length < 2 || /\d/.test(data.fullName)) {
    warnings.push("Họ tên không hợp lệ, vui lòng kiểm tra lại.");
  } else if (words.length === 2 && ["thi", "van", "huu", "duc", "dinh", "ngoc", "quoc", "cong", "thanh"].includes(firstWord)) {
    warnings.push(missingSurnameWarning);
  }

  if (data.cccd.length !== 12) {
    warnings.push("Không đọc được số CCCD/GTTT hợp lệ, vui lòng kiểm tra lại.");
  }
  if (data.cmnd && ![9, 12].includes(data.cmnd.length)) {
    warnings.push("Số CMND không hợp lệ, vui lòng kiểm tra lại.");
  }

  return {
    ok: Boolean(data.fullName && data.cccd.length === 12),
    warnings
  };
}

function buildPayload(model: string, imageDataUrl: string, includeResponseFormat: boolean) {
  return {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: userPrompt },
          { type: "image_url", image_url: { url: imageDataUrl } }
        ]
      }
    ],
    temperature: 0,
    ...(includeResponseFormat ? { response_format: { type: "json_object" } } : {})
  };
}

function mapAiError(status: number, body: string) {
  const lowerBody = body.toLowerCase();
  if ([401, 403].includes(status)) return "API key không hợp lệ hoặc không có quyền truy cập model.";
  if (lowerBody.includes("vision") || lowerBody.includes("image") || lowerBody.includes("modal")) {
    return "Model hiện tại không hỗ trợ đọc ảnh. Vui lòng đổi AI_MODEL sang model vision.";
  }
  return readFailedMessage;
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

  const baseUrl = envValue("AI_API_BASE_URL").replace(/\/$/, "");
  const apiKey = envValue("AI_API_KEY");
  const model = envValue("AI_MODEL") || defaultModel;

  if (!baseUrl) {
    return NextResponse.json({
      ok: false,
      source: "ai_vision",
      data: { fullName: "", cccd: "", cmnd: "" },
      warnings: [],
      message: "Chưa cấu hình AI_API_BASE_URL trên Vercel."
    });
  }

  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      source: "ai_vision",
      data: { fullName: "", cccd: "", cmnd: "" },
      warnings: [],
      message: "Chưa cấu hình AI_API_KEY trên Vercel."
    });
  }

  const imageBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const imageDataUrl = `data:${file.type};base64,${imageBase64}`;
  const endpoint = `${baseUrl}/chat/completions`;

  try {
    let response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildPayload(model, imageDataUrl, true))
    });

    let responseText = await response.text();
    if (!response.ok && responseText.toLowerCase().includes("response_format")) {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(buildPayload(model, imageDataUrl, false))
      });
      responseText = await response.text();
    }

    if (!response.ok) {
      return NextResponse.json({
        ok: false,
        source: "ai_vision",
        data: { fullName: "", cccd: "", cmnd: "" },
        warnings: [],
        message: mapAiError(response.status, responseText)
      });
    }

    const apiData = JSON.parse(responseText);
    const rawContent = extractMessageContent(apiData);
    const extracted = extractJsonObject(rawContent);

    if (!Object.keys(extracted).length) {
      return NextResponse.json({
        ok: false,
        source: "ai_vision",
        data: { fullName: "", cccd: "", cmnd: "" },
        warnings: [],
        message: "AI trả về dữ liệu không đúng định dạng JSON."
      });
    }

    const normalized = normalizeAiData(extracted as Record<string, unknown>);
    const validation = validateAiData(normalized);

    return NextResponse.json({
      ok: validation.ok,
      source: "ai_vision",
      data: normalized,
      warnings: validation.warnings,
      message: validation.ok ? null : readFailedMessage
    });
  } catch {
    return NextResponse.json({
      ok: false,
      source: "ai_vision",
      data: { fullName: "", cccd: "", cmnd: "" },
      warnings: [],
      message: readFailedMessage
    });
  }
}
