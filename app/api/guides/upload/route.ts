import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { fileSizeLabel, isAdminRequest, isVercel, safeFileName, writePublicFile } from "@/lib/serverApi";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Không có quyền truy cập." }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.type !== "application/pdf") {
    return NextResponse.json({ error: "Vui lòng tải lên file PDF." }, { status: 400 });
  }

  const baseName = safeFileName(file.name.endsWith(".pdf") ? file.name : `${file.name}.pdf`, `guide-${Date.now()}.pdf`);
  const fileName = `${Date.now()}-${baseName}`;
  const size = fileSizeLabel(file.size);

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`guides/${fileName}`, file, {
      access: "public",
      addRandomSuffix: false
    });
    return NextResponse.json({
      pdfUrl: blob.url,
      size
    });
  }

  if (isVercel()) {
    return NextResponse.json(
      { error: "Chua cau hinh Vercel Blob. Hay tao Blob Store va them BLOB_READ_WRITE_TOKEN trong Environment Variables." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    pdfUrl: await writePublicFile(["uploads", "guides"], fileName, file),
    size
  });
}
