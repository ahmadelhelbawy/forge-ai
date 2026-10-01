// Cuts the second README segment from the same raw recording: what you typed
// next to what FORGE produced, then each later stage at 1×.
//
//   node web/scripts/demo-compare.mjs docs/media/raw docs/media/forge-compare.mp4
//
// Every frame comes from the recording, at its real speed: no wait is shown,
// nothing is sped up. Each excerpt is captioned with its REAL elapsed time in
// the session, so the cut cannot hide how long the model took between them.
// Needs the `marks` demo-record.mjs writes to segments.json. Requires ffmpeg
// with drawtext.
//
// Light on the machine, like demo-edit.mjs: one ffmpeg at a time, each on a
// short seek, then a stream-copy concat.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [rawDir = "docs/media/raw", out = "docs/media/forge-compare.mp4"] = process.argv.slice(2);
const { duration, marks } = JSON.parse(readFileSync(join(rawDir, "segments.json"), "utf8"));
if (!marks) throw new Error(`${rawDir}/segments.json has no marks — record with the current demo-record.mjs`);
const input = join(rawDir, "forge-demo-raw.webm");
const FONT = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"].find(existsSync);
if (!FONT) throw new Error("DejaVuSans.ttf not found — the captions are the point of this cut");

const at = (name) => {
  if (typeof marks[name] !== "number") throw new Error(`segments.json has no mark "${name}"`);
  return marks[name];
};
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const escape = (text) => text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").replace(/%/g, "\\%");
const caption = (text, y = "h-84") =>
  `drawtext=fontfile=${FONT}:text='${escape(text)}':fontsize=24:fontcolor=white:box=1:boxcolor=0x000000@0.72:boxborderw=12:x=(w-text_w)/2:y=${y}`;
const X264 = ["-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-r", "25", "-threads", "2"];
const ff = (args) => execFileSync("nice", ["-n", "10", "ffmpeg", "-loglevel", "error", "-y", "-threads", "2", ...args], { stdio: "inherit" });

// The opening: two stills side by side — the last frame before the idea was
// sent (the chat column) and the first frame of the generated prompt (the
// Studio). The crops are the default layout of demo-record.mjs's 1440×900
// viewport.
const HOLD = 7;
const CHAT = "820:900:160:0";
const STUDIO = "460:900:980:0";
// The recorder's clock starts a little after the video does, so a mark sits
// about half a second late in the footage: step back to the frame where the
// sentence is complete and not yet sent.
const LAG = 0.6;
const typed = at("idea-typed") - LAG;
const prompt = at("prompt-shown");

// Then each later stage at 1×, from its mark.
const EXCERPT = 3.5;
const stages = [
  ["pinned", "Requirement pinned"],
  ["compiled", "Compiled for Claude Code"],
  ["packaged", "Execution Contract packaged"],
  ["verified", "Evidence verified"],
  ["matrix", "Traceability"],
];

const work = mkdtempSync(join(tmpdir(), "forge-demo-compare-"));
try {
  const left = join(work, "left.png");
  const right = join(work, "right.png");
  ff(["-ss", typed.toFixed(3), "-i", input, "-frames:v", "1", "-vf", `crop=${CHAT}`, left]);
  ff(["-ss", (prompt + 0.5).toFixed(3), "-i", input, "-frames:v", "1", "-vf", `crop=${STUDIO}`, right]);
  const files = [join(work, "p0.mp4")];
  ff([
    "-loop", "1", "-t", String(HOLD), "-i", left, "-loop", "1", "-t", String(HOLD), "-i", right,
    "-filter_complex",
    `[0]${caption("Without FORGE: this is the whole instruction", "56")}[l];` +
      `[1]${caption("With FORGE: one answer later", "56")}[r];` +
      `[l][r]hstack=inputs=2,scale=-2:800,pad=1280:800:(ow-iw)/2:0:color=0x0b0d10,setsar=1,fps=25[v]`,
    "-map", "[v]", ...X264, files[0],
  ]);
  stages.forEach(([name, label], i) => {
    const start = at(name);
    const end = Math.min(start + EXCERPT, duration);
    const file = join(work, `p${i + 1}.mp4`);
    ff(["-ss", start.toFixed(3), "-to", end.toFixed(3), "-i", input,
        "-vf", `fps=25,scale=1280:-2,setsar=1,${caption(`${label} — ${clock(start)} into the session, real speed`)}`, ...X264, file]);
    files.push(file);
  });
  const list = join(work, "list.txt");
  writeFileSync(list, files.map((f) => `file '${f}'`).join("\n"));
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", out], { stdio: "inherit" });
} finally {
  rmSync(work, { recursive: true, force: true });
}
const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString());
console.log(JSON.stringify({ out, seconds: Math.round(seconds), marks }, null, 2));
