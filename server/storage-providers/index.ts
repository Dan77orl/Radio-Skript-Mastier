import { promises as fs } from "fs";
import path from "path";
import { storage } from "../storage";
import * as googleDrive from "./google-drive";

export type StorageProvider = "yandex" | "google_drive" | "none";

export interface ArchiveResult {
  provider: StorageProvider;
  uploaded: boolean;
  remotePath: string | null;
  link: string | null;
  /** Set when the provider is configured but the upload could not be completed. */
  error?: string;
}

async function uploadToYandex(token: string, localPath: string, folder: string, fileName: string): Promise<ArchiveResult> {
  await fetch(`https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(folder)}`, {
    method: "PUT",
    headers: { Authorization: `OAuth ${token}` },
  }).catch(() => { /* already exists */ });

  const remotePath = `${folder}/${fileName}`;
  const hrefRes = await fetch(
    `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(remotePath)}&overwrite=true`,
    { headers: { Authorization: `OAuth ${token}` } },
  );
  if (!hrefRes.ok) {
    throw new Error(`Yandex Disk refused the upload: ${hrefRes.status}`);
  }
  const { href } = await hrefRes.json() as any;

  const fileData = await fs.readFile(localPath);
  const put = await fetch(href, { method: "PUT", body: fileData });
  if (!put.ok) throw new Error(`Yandex Disk upload failed: ${put.status}`);

  return { provider: "yandex", uploaded: true, remotePath, link: null };
}

/**
 * Archive a generated audio file to whichever cloud the tenant configured.
 *
 * Never throws: archiving is a follow-up step, and losing a finished programme
 * because a cloud token expired would be worse than shipping it unarchived. The
 * failure is reported in the result so the caller can surface it.
 */
export async function archiveAudio(opts: {
  userId: string;
  /** Public URL as stored on the record, e.g. "/audio/news.mp3". */
  audioUrl: string;
  folder: string;
}): Promise<ArchiveResult> {
  const { userId, audioUrl, folder } = opts;
  const settings = await storage.getSettings(userId);
  const provider = (settings?.storageProvider || "yandex") as StorageProvider;

  if (provider === "none") {
    return { provider, uploaded: false, remotePath: null, link: null };
  }

  const localPath = path.join(process.cwd(), "public", audioUrl.replace(/^\//, ""));
  const fileName = audioUrl.split("/").pop() || `audio_${Date.now()}.mp3`;

  try {
    await fs.access(localPath);
  } catch {
    return { provider, uploaded: false, remotePath: null, link: null, error: "Local audio file is missing" };
  }

  try {
    if (provider === "google_drive") {
      if (!settings?.googleDriveRefreshToken) {
        return { provider, uploaded: false, remotePath: null, link: null, error: "Google Drive is not connected" };
      }
      const result = await googleDrive.uploadFile({
        refreshToken: settings.googleDriveRefreshToken,
        localPath,
        fileName,
        folderPath: folder,
        rootFolderId: settings.googleDriveFolderId || undefined,
      });
      return { provider, uploaded: true, remotePath: result.path, link: result.webViewLink };
    }

    if (!settings?.yandexDiskToken) {
      return { provider: "yandex", uploaded: false, remotePath: null, link: null, error: "Yandex Disk token is not set" };
    }
    return await uploadToYandex(settings.yandexDiskToken, localPath, folder, fileName);
  } catch (err: any) {
    console.error(`[archive] ${provider} upload failed for ${audioUrl}:`, err?.message);
    return { provider, uploaded: false, remotePath: null, link: null, error: err?.message || "Upload failed" };
  }
}
