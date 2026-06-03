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

export async function readContent<T>(key: ContentKey): Promise<T> {
  const raw = await readFile(dataPath(key), "utf8");
  return JSON.parse(raw) as T;
}

export async function writeContent(key: ContentKey, value: unknown) {
  await writeFile(dataPath(key), `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
