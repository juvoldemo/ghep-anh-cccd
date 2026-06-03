import { randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { spawn } from "child_process";
import { NextRequest, NextResponse } from "next/server";

type OutputFormat = "jpeg" | "png";

export const runtime = "nodejs";

const pythonCandidates = process.platform === "win32" ? ["python", "py"] : ["python3", "python"];

async function saveUpload(formData: FormData, key: string, dir: string) {
  const file = formData.get(key);
  if (!(file instanceof File)) {
    throw new Error(`Missing file: ${key}`);
  }

  const extension = path.extname(file.name) || ".jpg";
  const target = path.join(dir, `${key}${extension}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(target, buffer);
  return target;
}

function runPython(args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    let lastError: Error | null = null;

    const tryNext = (index: number) => {
      if (index >= pythonCandidates.length) {
        reject(lastError ?? new Error("Python is not available."));
        return;
      }

      const child = spawn(pythonCandidates[index], args, { cwd, windowsHide: true });
      let stderr = "";

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        lastError = error;
        tryNext(index + 1);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        lastError = new Error(stderr || `Python exited with code ${code}`);
        tryNext(index + 1);
      });
    };

    tryNext(0);
  });
}

export async function POST(request: NextRequest) {
  const tempDir = path.join(tmpdir(), `cccd-compose-${randomUUID()}`);
  const projectRoot = process.cwd();

  try {
    await mkdir(tempDir, { recursive: true });
    const formData = await request.formData();
    const format = formData.get("format") === "png" ? "png" : ("jpeg" as OutputFormat);
    const frontPath = await saveUpload(formData, "front", tempDir);
    const backPath = await saveUpload(formData, "back", tempDir);
    const zaloPath = await saveUpload(formData, "zalo", tempDir);
    const outputPath = path.join(tempDir, `result.${format === "jpeg" ? "jpg" : "png"}`);

    await runPython(
      [
        path.join(projectRoot, "crop_compose.py"),
        "--front",
        frontPath,
        "--back",
        backPath,
        "--zalo",
        zaloPath,
        "--output",
        outputPath,
        "--format",
        format
      ],
      projectRoot
    );

    const result = await readFile(outputPath);
    return new NextResponse(result, {
      headers: {
        "Content-Type": format === "jpeg" ? "image/jpeg" : "image/png",
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not process images." },
      { status: 500 }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
