import { get, put } from "@vercel/blob";
import { readFile, writeFile } from "fs/promises";
import path from "path";

export type FormItem = {
  id: string;
  title: string;
  file: string;
  size?: string;
};

export type FormFolder = {
  id: string;
  title: string;
  items: FormItem[];
};

export type FormsData = {
  folders: FormFolder[];
};

export type Guide = {
  id: string;
  category: string;
  title: string;
  description?: string;
  summary: string;
  pdfUrl?: string;
  pageCount?: number;
  isActive?: boolean;
  order?: number;
  createdAt?: string;
  steps?: string[];
  checklist?: string[];
};

export type FaqItem = {
  id: string;
  question: string;
  answer: string;
};

export type MergeSettings = {
  mergeNote: string;
  defaultFormat: "jpeg" | "png";
};

export type ContentKey = "forms" | "guides" | "faq" | "settings";

const dataFiles: Record<ContentKey, string> = {
  forms: "forms.json",
  guides: "guides.json",
  faq: "faq.json",
  settings: "settings.json"
};

function dataPath(key: ContentKey) {
  return path.join(process.cwd(), "data", dataFiles[key]);
}

function blobPath(key: ContentKey) {
  return `content/${dataFiles[key]}`;
}

function hasBlobStore() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

async function streamToText(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

export async function readContent<T>(key: ContentKey): Promise<T> {
  if (hasBlobStore()) {
    const blob = await get(blobPath(key), { access: "private", useCache: false });
    if (blob?.statusCode === 200) {
      return JSON.parse(await streamToText(blob.stream)) as T;
    }
  }

  const raw = await readFile(dataPath(key), "utf8");
  return JSON.parse(raw) as T;
}

export async function writeContent(key: ContentKey, value: unknown) {
  const content = `${JSON.stringify(value, null, 2)}\n`;

  if (hasBlobStore()) {
    await put(blobPath(key), content, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json"
    });
    return;
  }

  await writeFile(dataPath(key), content, "utf8");
}

export async function getForms() {
  return readContent<FormsData>("forms");
}

export async function getGuides() {
  return readContent<Guide[]>("guides");
}

export async function getFaq() {
  return readContent<FaqItem[]>("faq");
}

export async function getSettings() {
  return readContent<MergeSettings>("settings");
}
