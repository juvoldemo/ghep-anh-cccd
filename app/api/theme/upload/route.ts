import path from "path";
import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, isVercel, safeFileName, writePublicFile } from "@/lib/serverApi";

export const runtime = "nodejs";

function extensionFromType(type: string) {
  if (type === "image/png") return ".png";
  if (type === "image/webp") return ".webp";
  return ".jpg";
}

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Khong co quyen truy cap." }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  const slot = String(formData.get("slot") || "theme").replace(/[^a-z0-9-]/gi, "").toLowerCase() || "theme";

  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Vui long tai len file anh." }, { status: 400 });
  }

  const fallbackName = `${slot}-${Date.now()}${extensionFromType(file.type)}`;
  const fileName = safeFileName(file.name || fallbackName, `theme-${Date.now()}.png`);
  const pathname = `theme/${slot}-${Date.now()}-${fileName}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(pathname, file, {
      access: "public",
      addRandomSuffix: false,
      contentType: file.type
    });
    return NextResponse.json({ url: blob.url });
  }

  if (isVercel()) {
    return NextResponse.json(
      { error: "Chua cau hinh Vercel Blob. Hay tao Blob Store va them BLOB_READ_WRITE_TOKEN trong Environment Variables." },
      { status: 500 }
    );
  }

  return NextResponse.json({ url: await writePublicFile(["uploads", "theme"], path.basename(pathname), file) });
}
