import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AvatarMimeType } from "../shared/contracts.js";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES: AvatarMimeType[] = ["image/jpeg", "image/png", "image/webp"];

export function isAvatarMimeType(value: string): value is AvatarMimeType {
  return AVATAR_MIME_TYPES.includes(value as AvatarMimeType);
}

export function hasMatchingImageSignature(data: Buffer, mimeType: AvatarMimeType): boolean {
  if (mimeType === "image/png") {
    return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/jpeg") {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  return data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP";
}

export class AvatarStore {
  constructor(private readonly directory: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }

  async write(data: Buffer): Promise<string> {
    const key = `${randomUUID()}.img`;
    await writeFile(path.join(this.directory, key), data, { mode: 0o600 });
    return key;
  }

  async read(key: string): Promise<Buffer | null> {
    if (!this.isValidKey(key)) return null;
    try {
      return await readFile(path.join(this.directory, key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.isValidKey(key)) return;
    await rm(path.join(this.directory, key), { force: true });
  }

  private isValidKey(key: string): boolean {
    return /^[0-9a-f-]+\.img$/.test(key);
  }
}
