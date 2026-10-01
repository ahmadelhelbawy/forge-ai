// Edits the raw demo recording into the README video.
//
//   node web/scripts/demo-edit.mjs docs/media/raw docs/media/forge-demo.mp4
//
// The only edit: each wait on the model (the spans demo-record.mjs logged in
// segments.json) is sped up to about 1.6 s and labelled with its REAL
// duration and the speed-up. Everything else — every click, every screen —
// plays at 1×, in order, uncut. Requires ffmpeg with drawtext.
//
// Light on the machine: one ffmpeg at a time, each encoding one short segment
// from a seek (2 threads, niced), then a stream-copy concat. A single filter
// graph over the whole recording drove a WSL host to a near-freeze.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [rawDir = "docs/media/raw", out = "docs/media/forge-demo.mp4"] = process.argv.slice(2);
const { duration, waits } = JSON.parse(readFileSync(join(rawDir, "segments.json"), "utf8"));
const input = join(rawDir, "forge-demo-raw.webm");
const FONT = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].find(existsSync);
const SHOWN = 1.6;

const parts = [];
let cursor = 0;
for (const w of waits) {
  if (w.start > cursor) parts.push({ kind: "show", start: cursor, end: w.start });
  parts.push({ kind: "wait", start: w.start, end: w.end, label: w.label });
  cursor = w.end;
}
if (duration > cursor) parts.push({ kind: "show", start: cursor, end: duration });

const escape = (text) => text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%");
const SCALE = "fps=25,scale=1280:-2,setsar=1";

/** Encodes [start, end) of `input` to `file` with the given filter, gently. */
function encode(input, start, end, filter, file) {
  execFileSync(
    "nice",
    ["-n", "10", "ffmpeg", "-loglevel", "error", "-y", "-threads", "2",
     "-ss", start.toFixed(3), "-to", end.toFixed(3), "-i", input,
     "-vf", filter, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
     "-pix_fmt", "yuv420p", "-threads", "2", "-r", "25", file],
    { stdio: "inherit" },
  );
}

/** Joins same-format segments without re-encoding. */
function concat(files, out, work) {
  const list = join(work, "list.txt");
  writeFileSync(list, files.map((f) => `file '${f}'`).join("\n"));
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out], { stdio: "inherit" });
}

{
  const work = mkdtempSync(join(tmpdir(), "forge-demo-edit-"));
  try {
    const files = parts.map((p, i) => {
      const file = join(work, `p${String(i).padStart(2, "0")}.mp4`);
      const length = p.end - p.start;
      if (p.kind === "show" || length <= SHOWN * 1.5) {
        encode(input, p.start, p.end, SCALE, file);
      } else {
        const factor = length / SHOWN;
        const label = escape(`${p.label}: ${Math.round(length)} s of real model time, shown ${Math.round(factor)}x faster`);
        const text = FONT
          ? `,drawtext=fontfile=${FONT}:text='${label}':fontsize=24:fontcolor=white:box=1:boxcolor=0x000000@0.72:boxborderw=14:x=(w-text_w)/2:y=h-84`
          : "";
        encode(input, p.start, p.end, `setpts=PTS/${factor.toFixed(4)},${SCALE}${text}`, file);
      }
      return file;
    });
    concat(files, out, work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString());
  console.log(JSON.stringify({ out, seconds: Math.round(seconds), parts: parts.map((p) => ({ ...p, length: +(p.end - p.start).toFixed(1) })) }, null, 2));
}
