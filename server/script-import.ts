/**
 * Import of client-approved, ready-made scripts.
 *
 * Input is a document (docx/txt/pasted text) with numbered episodes, e.g.:
 *
 *   Выпуск 1 · 1 сентября
 *   «Сколько реально приносит квадратный метр»
 *   [Джингл]: короткая отбивка программы
 *   Ведущая: В эфире «Ваши метры»...
 *   Ведущая: ...
 *   [Ролик]: рекламный ролик, до 30 секунд
 *
 * Output is one normalized script per episode in the app's speaker format
 * ([Имя]: текст), with production cues removed — the TTS pipeline would
 * otherwise treat "[Джингл]:" as a speaker named Джингл and try to voice it.
 */

export interface ImportedEpisode {
  /** 1-based number from the header, or the block's position if absent. */
  number: number;
  title: string;
  scriptText: string;
  /** Word count of the speech text — lets the UI show a length estimate. */
  words: number;
}

/** "Выпуск 3 · 3 сентября", "Эпизод №7", "Episode 12" — the block delimiter. */
const EPISODE_HEADER = /^\s*(?:Выпуск|Эпизод|Episode)\s*№?\s*(\d+)\b(.*)$/i;

/**
 * Bracketed lines that are stage directions, not speech. Matched by name:
 * a real speaker would be a person's name, not one of these.
 */
const PRODUCTION_CUES =
  /^\s*\[\s*(джингл|ролик|музыка|отбивка|реклама|звук|пауза|jingle|sting|music|ad|sfx|pause|intro|outro)[^\]]*\]\s*:?/i;

/** "Ведущая:", "Алиса:", "Host:" — a short label ending with a colon. */
const PLAIN_SPEAKER = /^\s*([А-ЯЁA-Z][^:\[\]{}]{0,29}?)\s*:\s+(\S.*)$/;

/** Labels that are hosts by convention even if they occur only once. */
const KNOWN_HOST_LABELS = /^(ведущ|соведущ|диктор|host|co-host|sunucu|speaker)/i;

function extractTitle(lines: string[]): { title: string | null; consumed: number } {
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const quoted = line.match(/^[«"„']\s*(.+?)\s*[»"“']$/);
    if (quoted) return { title: quoted[1], consumed: i + 1 };
    // A short unquoted line before any speech reads as a title too.
    if (!PLAIN_SPEAKER.test(line) && !PRODUCTION_CUES.test(line) && line.length <= 80) {
      return { title: line.replace(/^[«"„']|[»"“']$/g, ""), consumed: i + 1 };
    }
    break;
  }
  return { title: null, consumed: 0 };
}

function normalizeBlock(lines: string[]): string {
  // A label counts as a speaker when it repeats (real hosts speak more than
  // once) or looks like a host word; "Роль первая:" inside a lecture does
  // neither and must stay part of the running text.
  const labelCounts = new Map<string, number>();
  for (const line of lines) {
    const m = line.match(PLAIN_SPEAKER);
    if (m) {
      const label = m[1].trim();
      labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
    }
  }

  const out: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (PRODUCTION_CUES.test(line)) continue;

    const bracketed = line.match(/^\s*\[([^\]]+)\]:\s*(.*)$/);
    if (bracketed) {
      out.push(line);
      continue;
    }

    const plain = line.match(PLAIN_SPEAKER);
    if (plain) {
      const label = plain[1].trim();
      const isSpeaker = (labelCounts.get(label) || 0) >= 2 || KNOWN_HOST_LABELS.test(label);
      if (isSpeaker) {
        out.push(`[${label}]: ${plain[2]}`);
        continue;
      }
    }

    out.push(line);
  }
  return out.join("\n").trim();
}

function countWords(text: string): number {
  const speech = text.replace(/^\[[^\]]+\]:\s*/gm, "");
  return speech.split(/\s+/).filter(Boolean).length;
}

export function parseImportedScripts(rawText: string): ImportedEpisode[] {
  const lines = rawText.replace(/\r\n?/g, "\n").split("\n");

  // Locate episode headers; everything before the first one is a preamble
  // (station name, editorial notes) and is dropped.
  const headers: Array<{ index: number; number: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(EPISODE_HEADER);
    if (m) headers.push({ index: i, number: parseInt(m[1], 10) });
  }

  const blocks: Array<{ number: number; lines: string[] }> = [];
  if (headers.length >= 2) {
    for (let h = 0; h < headers.length; h++) {
      const start = headers[h].index + 1;
      const end = h + 1 < headers.length ? headers[h + 1].index : lines.length;
      blocks.push({ number: headers[h].number, lines: lines.slice(start, end) });
    }
  } else {
    // No recognizable numbering — treat the whole document as one script.
    blocks.push({ number: 1, lines });
  }

  const episodes: ImportedEpisode[] = [];
  for (const block of blocks) {
    const { title, consumed } = extractTitle(block.lines);
    const scriptText = normalizeBlock(block.lines.slice(consumed));
    if (!scriptText) continue;
    episodes.push({
      number: block.number,
      title: title || `Выпуск ${block.number}`,
      scriptText,
      words: countWords(scriptText),
    });
  }
  return episodes;
}
