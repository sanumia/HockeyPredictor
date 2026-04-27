import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function ensureDirForFile(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function writeJson<T>(filePath: string, data: T): Promise<void> {
  await ensureDirForFile(filePath);
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

