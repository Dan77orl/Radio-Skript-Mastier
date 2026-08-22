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

  // The registry is what makes restore possible after a redeploy wipes the
  // local files; losing a registry write must not fail the archive itself.
  const recordEntry = async (fileId: string | null, remotePath: string | null, link: string | null, entryProvider: StorageProvider) => {
    try {
      await storage.upsertAudioArchiveEntry({
        userId,
        fileName,
        provider: entryProvider,
        fileId,
        remotePath,
        link,
      });
    } catch (err: any) {
      console.error(`[archive] could not record registry entry for ${fileName}:`, err?.message);
    }
  };

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
      await recordEntry(result.fileId, result.path, result.webViewLink, "google_drive");
      return { provider, uploaded: true, remotePath: result.path, link: result.webViewLink };
    }

    if (!settings?.yandexDiskToken) {
      return { provider: "yandex", uploaded: false, remotePath: null, link: null, error: "Yandex Disk token is not set" };
    }
    const yandexResult = await uploadToYandex(settings.yandexDiskToken, localPath, folder, fileName);
    if (yandexResult.uploaded) {
      await recordEntry(null, yandexResult.remotePath, null, "yandex");
    }
    return yandexResult;
  } catch (err: any) {
    console.error(`[archive] ${provider} upload failed for ${audioUrl}:`, err?.message);
    return { provider, uploaded: false, remotePath: null, link: null, error: err?.message || "Upload failed" };
  }
}

/**
 * Bring a missing local audio file back from the cloud archive.
 *
 * The deployment filesystem is recreated on every republish, so any file
 * generated before the last deploy is gone locally while its DB record still
 * points at it. If the registry knows where the file was archived, download it
 * back into public/audio so the normal streaming/download path can proceed.
 *
 * Returns true when the local file exists again.
 */
export async function restoreAudio(opts: { userId: string; audioUrl: string }): Promise<boolean> {
  const fileName = opts.audioUrl.split("/").pop();
  if (!fileName) return false;

  const entry = await storage.getAudioArchiveEntry(opts.userId, fileName);
  if (!entry) return false;

  const settings = await storage.getSettings(opts.userId);
  const localPath = path.join(process.cwd(), "public", "audio", fileName);

  try {
    let data: Buffer | null = null;

    if (entry.provider === "google_drive" && entry.fileId && settings?.googleDriveRefreshToken) {
      data = await googleDrive.downloadFile(settings.googleDriveRefreshToken, entry.fileId);
    } else if (entry.provider === "yandex" && entry.remotePath && settings?.yandexDiskToken) {
      const hrefRes = await fetch(
        `https://cloud-api.yandex.net/v1/disk/resources/download?path=${encodeURIComponent(entry.remotePath)}`,
        { headers: { Authorization: `OAuth ${settings.yandexDiskToken}` } },
      );
      if (!hrefRes.ok) throw new Error(`Yandex Disk refused the download: ${hrefRes.status}`);
      const { href } = await hrefRes.json() as any;
      const dl = await fetch(href);
      if (!dl.ok) throw new Error(`Yandex Disk download failed: ${dl.status}`);
      data = Buffer.from(await dl.arrayBuffer());
    }

    if (!data) return false;

    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, data);
    console.log(`[restore] brought back ${fileName} from ${entry.provider}`);
    return true;
  } catch (err: any) {
    console.error(`[restore] ${entry.provider} download failed for ${fileName}:`, err?.message);
    return false;
  }
}
