import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import { existsSync } from "fs";
import path from "path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const execFileAsync = promisify(execFile);

// The autoscale deployment image ships no system ffmpeg/ffprobe (the dev
// workspace has them, which is why this only ever broke in production) —
// prefer the npm-bundled static binaries, fall back to PATH lookup.
export const FFMPEG_BIN = ffmpegStatic && existsSync(ffmpegStatic) ? ffmpegStatic : "ffmpeg";
export const FFPROBE_BIN = ffprobeInstaller?.path && existsSync(ffprobeInstaller.path) ? ffprobeInstaller.path : "ffprobe";

export interface MixOptions {
  /** Music level relative to the voice, 0..1. */
  musicVolume?: number;
  /** Music-only lead-in before the voice starts, seconds. */
  introSeconds?: number;
  /** Music-only tail after the voice ends, seconds. */
  outroSeconds?: number;
  /** Duck the music under the voice instead of holding a flat level. */
  duck?: boolean;
}

const DEFAULTS: Required<MixOptions> = {
  musicVolume: 0.18,
  introSeconds: 1.2,
  outroSeconds: 1.8,
  duck: true,
};

export async function probeDurationSeconds(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      FFPROBE_BIN,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { timeout: 30000 },
    );
    const value = parseFloat(stdout.trim());
    if (!Number.isFinite(value)) throw new Error(`Could not read duration of ${path.basename(filePath)}`);
    return value;
  } catch (err: any) {
    // Degrade to a bitrate estimate rather than failing the whole mix —
    // fades land slightly off, the spot still ships.
    const stat = await fs.stat(filePath);
    const estimate = stat.size / 24000; // 192 kbps mp3 ≈ 24000 bytes/s
    console.warn(`[mix] ffprobe unavailable for ${path.basename(filePath)} (${err?.message}); using size estimate ${estimate.toFixed(1)}s`);
    return estimate;
  }
}

/**
 * Lay a voice track over background music and render a finished spot.
 *
 * The music is looped to cover the voice, sits under it at a low level, gets a
 * short lead-in and a faded tail. With `duck` the music is compressed by the
 * voice (sidechain), which is what keeps speech intelligible over a busy track —
 * a flat level either buries the voice or makes the music pointless.
 */
export async function mixVoiceWithMusic(
  voicePath: string,
  musicPath: string,
  outputPath: string,
  options: MixOptions = {},
): Promise<{ outputPath: string; durationSeconds: number }> {
  const opts = { ...DEFAULTS, ...options };
  const voiceDuration = await probeDurationSeconds(voicePath);
  const totalDuration = opts.introSeconds + voiceDuration + opts.outroSeconds;
  const fadeStart = Math.max(0, totalDuration - opts.outroSeconds);
  const delayMs = Math.round(opts.introSeconds * 1000);

  // normalize=0 on amix is essential: the default divides every input by the
  // number of inputs, which would halve the voice.
  const voiceChain = `[0:a]adelay=${delayMs}|${delayMs},apad=pad_dur=${opts.outroSeconds.toFixed(2)}[voice]`;
  const musicBase =
    `[1:a]aloop=loop=-1:size=2e9,atrim=0:${totalDuration.toFixed(2)},` +
    `volume=${opts.musicVolume},afade=t=in:st=0:d=0.8,` +
    `afade=t=out:st=${fadeStart.toFixed(2)}:d=${opts.outroSeconds.toFixed(2)}[music]`;

  const filter = opts.duck
    ? `${voiceChain};${musicBase};[voice]asplit=2[v1][vkey];` +
      `[music][vkey]sidechaincompress=threshold=0.05:ratio=6:attack=20:release=400[ducked];` +
      `[v1][ducked]amix=inputs=2:duration=longest:normalize=0[out]`
    : `${voiceChain};${musicBase};[voice][music]amix=inputs=2:duration=longest:normalize=0[out]`;

  const tmpOutput = path.join(path.dirname(outputPath), `_mix_${path.basename(outputPath)}`);

  await execFileAsync(
    FFMPEG_BIN,
    [
      "-y",
      "-i", voicePath,
      "-i", musicPath,
      "-filter_complex", filter,
      "-map", "[out]",
      "-c:a", "libmp3lame",
      "-b:a", "192k",
      "-write_xing", "1",
      tmpOutput,
    ],
    { timeout: 180000, maxBuffer: 10 * 1024 * 1024 },
  );

  await fs.rename(tmpOutput, outputPath);
  return { outputPath, durationSeconds: totalDuration };
}

/** Fetch a remote music preview into the audio directory so ffmpeg can read it. */
export async function downloadToFile(url: string, destPath: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download music: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error("Downloaded music file is empty");
  await fs.writeFile(destPath, buffer);
  return destPath;
}
