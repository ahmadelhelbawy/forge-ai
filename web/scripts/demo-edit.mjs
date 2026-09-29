// Edits the raw demo recording into the README video.
//
//   node web/scripts/demo-edit.mjs docs/media/raw docs/media/forge-demo.mp4
//
// The only edit: each wait on the model (the spans demo-record.mjs logged in
// segments.json) is sped up to about 1.6 s and labelled with its REAL
// duration and the speed-up. Everything else — every click, every screen —
// plays at 1×, in order, uncut. Requires ffmpeg with drawtext.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
const chains = parts.map((p, i) => {
  const length = p.end - p.start;
  const base = `[0:v]trim=start=${p.start.toFixed(3)}:end=${p.end.toFixed(3)},setpts=PTS-STARTPTS`;
  if (p.kind === "show" || length <= SHOWN * 1.5) return `${base}[v${i}]`;
  const factor = length / SHOWN;
  const label = escape(`${p.label}: ${Math.round(length)} s of real model time, shown ${Math.round(factor)}x faster`);
  const text = FONT
    ? `,drawtext=fontfile=${FONT}:text='${label}':fontsize=26:fontcolor=white:box=1:boxcolor=0x000000@0.72:boxborderw=14:x=(w-text_w)/2:y=h-90`
    : "";
  return `${base},setpts=PTS/${factor.toFixed(4)}${text}[v${i}]`;
});
const filter = `${chains.join(";")};${parts.map((_, i) => `[v${i}]`).join("")}concat=n=${parts.length}:v=1:a=0,fps=25,scale=1280:-2[out]`;

execFileSync(
  "ffmpeg",
  ["-loglevel", "error", "-y", "-i", input, "-filter_complex", filter, "-map", "[out]", "-an",
   "-c:v", "libx264", "-crf", "27", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
  { stdio: "inherit" },
);
const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString());
console.log(JSON.stringify({ out, seconds: Math.round(seconds), parts: parts.map((p) => ({ ...p, length: +(p.end - p.start).toFixed(1) })) }, null, 2));
