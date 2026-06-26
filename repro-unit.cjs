// Deterministic, server-free proof of the failure mode.
//
// On a PPR resume, base-server.js does `body.toString("utf8")` on the request
// body and hands it to parsePostponedState. When the body is gzip-compressed
// (as on Vercel), parsePostponedState fails its `^<digits>:` format check,
// catches it internally, logs `Failed to parse postponed state` + the Invariant,
// and degrades (returns type:1). That logged line is the exact production error.
const zlib = require("zlib");
const {
  parsePostponedState,
} = require("next/dist/server/app-render/postponed-state");

const STATE = "4:null"; // a real, minimal postponed-state string
const gz = zlib.gzipSync(Buffer.from(STATE));

console.log(
  "gzip header bytes:",
  [...gz.subarray(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join(" "),
  " (production logs showed 1f 8b 08 ..)\n",
);

// Capture what Next logs (it catches internally + console.error + degrades).
let logged = "";
const orig = console.error;
console.error = (...args) => {
  logged += args.map(String).join(" ") + "\n";
};
const result = parsePostponedState(gz.toString("utf8"), {}, 1e9); // the Vercel resume-body path
console.error = orig;

const firstLine = logged.split("\n")[0];
if (/Failed to parse postponed state[\s\S]*invalid postponed state/.test(logged)) {
  console.log("Next logged (exactly as in production):");
  console.log("  " + firstLine.slice(0, 90));
  console.log("  -> parsePostponedState degraded to type:" + result.type + " (logged error, no crash; HTTP 200).");
  console.log(
    "\nReproduced: a gzip resume body read as UTF-8 without decompression produces" +
      '\nthe exact production log "Failed to parse postponed state: Invariant: invalid postponed state <gzip>".',
  );
  process.exit(0);
}
console.log("Bug NOT reproduced. Captured log:\n" + logged.slice(0, 200));
process.exit(1);
