import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";

export function isAdminRequest(request: NextRequest) {
  const pass = process.env.ADMIN_PASSWORD ?? "admin123";
  return request.headers.get("x-admin-pass") === pass;
}

export function isVercel() {
  return Boolean(process.env.VERCEL);
}

export function safeFileName(name: string, fallback: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/(^-|-$)/g, "") || fallback
  );
}

export function fileSizeLabel(size: number) {
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

export async function writePublicFile(relativeDir: string[], fileName: string, file: File) {
  const uploadDir = path.join(process.cwd(), "public", ...relativeDir);
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, fileName), Buffer.from(await file.arrayBuffer()));
  return `/${[...relativeDir, fileName].join("/")}`;
}
