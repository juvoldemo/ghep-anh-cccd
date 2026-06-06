import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const maxFileSize = 10 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png"]);

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

  return NextResponse.json({
    ok: false,
    source: "ocr",
    data: {
      fullName: "",
      cccd: "",
      cmnd: ""
    },
    warnings: ["OCR backend chưa chạy trên máy này, vui lòng nhập thủ công."],
    message: "Không đọc được thông tin CCCD. Vui lòng thử ảnh rõ hơn."
  });
}
