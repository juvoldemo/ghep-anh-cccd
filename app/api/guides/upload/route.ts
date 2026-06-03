import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function isAdmin(request: NextRequest) {
  const pass = process.env.ADMIN_PASSWORD ?? "admin123";
  return request.headers.get("x-admin-pass") === pass;
}

function safeFileName(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/(^-|-$)/g, "") || `guide-${Date.now()}.pdf`
  );
}

export async function POST(request: NextRequest) {
  if (!isAdmin(request)) return NextResponse.json({ error: "Không có quyền truy cập." }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File) || file.type !== "application/pdf") {
    return NextResponse.json({ error: "Vui lòng tải lên file PDF." }, { status: 400 });
  }

  const baseName = safeFileName(file.name.endsWith(".pdf") ? file.name : `${file.name}.pdf`);
  const fileName = `${Date.now()}-${baseName}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`guides/${fileName}`, file, {
      access: "public",
      addRandomSuffix: false
    });
    return NextResponse.json({
      pdfUrl: blob.url,
      size: `${Math.max(1, Math.round(file.size / 1024))} KB`
    });
  }

  const uploadDir = path.join(process.cwd(), "public", "uploads", "guides");
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, fileName), Buffer.from(await file.arrayBuffer()));

  return NextResponse.json({
    pdfUrl: `/uploads/guides/${fileName}`,
    size: `${Math.max(1, Math.round(file.size / 1024))} KB`
  });
}
