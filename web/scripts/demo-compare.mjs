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
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
const caption = (text, y = "h-90") =>
  `drawtext=fontfile=${FONT}:text='${escape(text)}':fontsize=26:fontcolor=white:box=1:boxcolor=0x000000@0.72:boxborderw=14:x=(w-text_w)/2:y=${y}`;

// The opening: two stills side by side, the last frame before the idea was
// sent (the chat column) and the first frame of the generated prompt (the
// Studio). The crops are the default layout of demo-record.mjs's 1440×900
// viewport.
const HOLD = 6;
const CHAT = "820:900:160:0";
const STUDIO = "460:900:980:0";
const still = (t, crop, label) =>
  `[0:v]trim=start=${t.toFixed(3)}:duration=0.04,setpts=PTS-STARTPTS,crop=${crop},loop=loop=${HOLD * 25}:size=1:start=0,setpts=N/25/TB,` +
  `${caption(label, "56")}`;
const typed = at("idea-typed");
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
const chains = [
  `${still(typed, CHAT, `You typed (${clock(typed)})`)}[l]`,
  `${still(prompt + 0.5, STUDIO, `FORGE produced (${clock(prompt)})`)}[r]`,
  `[l][r]hstack=inputs=2,scale=-2:800,pad=1280:800:(ow-iw)/2:0:color=0x0b0d10,setsar=1[v0]`,
  ...stages.map(([name, label], i) => {
    const start = at(name);
    const end = Math.min(start + EXCERPT, duration);
    return `[0:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS,fps=25,scale=1280:-2,setsar=1,` +
      `${caption(`${label} — ${clock(start)} into the session, real speed`)}[v${i + 1}]`;
  }),
];
const n = stages.length + 1;
const filter = `${chains.join(";")};${Array.from({ length: n }, (_, i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0,fps=25[out]`;

execFileSync(
  "ffmpeg",
  ["-loglevel", "error", "-y", "-i", input, "-filter_complex", filter, "-map", "[out]", "-an",
   "-c:v", "libx264", "-crf", "27", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
  { stdio: "inherit" },
);
const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString());
console.log(JSON.stringify({ out, seconds: Math.round(seconds), marks }, null, 2));
