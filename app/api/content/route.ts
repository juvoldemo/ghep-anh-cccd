import { NextRequest, NextResponse } from "next/server";
import { ContentKey, readContent, writeContent } from "@/lib/content";
import { isAdminRequest } from "@/lib/serverApi";

export const runtime = "nodejs";

const allowedKeys: ContentKey[] = ["forms", "guides", "faq", "settings"];

function getKey(request: NextRequest): ContentKey | null {
  const key = request.nextUrl.searchParams.get("key") as ContentKey | null;
  return key && allowedKeys.includes(key) ? key : null;
}

export async function GET(request: NextRequest) {
  const key = getKey(request);
  if (!key) return NextResponse.json({ error: "Khóa nội dung không hợp lệ." }, { status: 400 });

  const data = await readContent(key);
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Mật khẩu không đúng." }, { status: 401 });
  return NextResponse.json({ ok: true });
}

export async function PUT(request: NextRequest) {
  const key = getKey(request);
  if (!key) return NextResponse.json({ error: "Khóa nội dung không hợp lệ." }, { status: 400 });
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Không có quyền truy cập." }, { status: 401 });

  try {
    const data = await request.json();
    await writeContent(key, data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Khong the luu noi dung.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
