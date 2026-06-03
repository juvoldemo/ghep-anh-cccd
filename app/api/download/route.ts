import { readFile, stat } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function getSafePdfFileName(value: string | null) {
  if (!value) return null;

  const fileName = path.basename(value);
  if (fileName !== value || !fileName.toLowerCase().endsWith(".pdf")) {
    return null;
  }

  return fileName;
}

function contentDisposition(fileName: string) {
  return `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: NextRequest) {
  const fileName = getSafePdfFileName(request.nextUrl.searchParams.get("file"));

  if (!fileName) {
    return NextResponse.json({ error: "File PDF khong hop le." }, { status: 400 });
  }

  const filePath = path.join(process.cwd(), "public", "pdfs", fileName);

  try {
    const [fileBuffer, fileStat] = await Promise.all([readFile(filePath), stat(filePath)]);

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(fileName),
        "Content-Length": String(fileStat.size),
        "Cache-Control": "public, max-age=0, must-revalidate"
      }
    });
  } catch {
    return NextResponse.json({ error: "Khong tim thay file PDF." }, { status: 404 });
  }
}
