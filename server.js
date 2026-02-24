// server.js
import fs from "fs";
import path from "path";
import crypto from "crypto";
import express from "express";
import multer from "multer";
import sharp from "sharp";
import open from "open";

const app = express();
const port = Number(process.env.PORT || 5177);

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in environment or .env");
  process.exit(1);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const EMOTIONS = [
  { key: "neutral", label: "Neutral" },
  { key: "happy", label: "Happy" },
  { key: "serious", label: "Serious/Determined" },
  { key: "angry", label: "Angry" },
  { key: "sad", label: "Sad" },
  { key: "surprised", label: "Surprised" },
  { key: "thinking", label: "Thinking/Concerned" },
  { key: "embarrassed", label: "Embarrassed" },
];

// In memory job store
const jobs = new Map();

// -------------------------
// Helpers
// -------------------------

function safeStem(filename) {
  const base = path.basename(filename);
  const stem = base.replace(path.extname(base), "");
  return stem.replace(/[^\w\-]+/g, "_").slice(0, 80) || "image";
}

async function to144Png(buffer) {
  return sharp(buffer)
    .resize(144, 144, { fit: "cover" })
    .png()
    .toBuffer();
}

async function saveBuffer(filePath, buf) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, buf);
}

async function composeSheet(pngBuffers144) {
  // 4 columns x 2 rows, each cell 144x144 => 576x288
  const sheet = sharp({
    create: {
      width: 576,
      height: 288,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  const composites = pngBuffers144.map((buf, i) => {
    const col = i % 4;
    const row = Math.floor(i / 4);
    return { input: buf, left: col * 144, top: row * 144 };
  });

  return sheet.composite(composites).png().toBuffer();
}

function emotionPrompt(emotionLabel) {
  return [
    "You are editing the provided reference image.",
    "Generate a single 144x144 PNG portrait that preserves the original subject identity and art style.",
    "Keep the same framing, pose, head size, clothing, accessories, lighting, and background as the input image.",
    "Do not add or remove characters or major elements.",
    "Do not add text, captions, logos, borders, or watermarks.",
    `Change only facial expression and subtle body language to clearly convey: ${emotionLabel}.`,
    "Make the emotion readable but do not drastically exaggerate proportions or change the character design.",
    "Return a clean portrait suitable for an RPG dialog portrait sheet.",
  ].join(" ");
}

async function ensureDirWritable(dir) {
  await fs.promises.mkdir(dir, { recursive: true });

  const stat = await fs.promises.stat(dir);
  if (!stat.isDirectory()) {
    throw new Error("Output path exists but is not a directory");
  }

  const testName = `.zigzag_write_test_${crypto.randomBytes(4).toString("hex")}.tmp`;
  const testPath = path.join(dir, testName);
  await fs.promises.writeFile(testPath, "ok");
  await fs.promises.unlink(testPath);
}

function pickOutputDir(rawFromUser) {
  const trimmed = (rawFromUser || "").trim();
  if (trimmed) return trimmed;
  if (process.env.OUTPUT_DIR) return process.env.OUTPUT_DIR;
  return path.join(process.cwd(), "output");
}

// -------------------------
// OpenAI Images Edit call via fetch + multipart
// -------------------------

async function editWithEmotion(base144Png, emotionLabel) {
  const url = "https://api.openai.com/v1/images/edits";

  const fd = new FormData();
  fd.append("image", new Blob([base144Png], { type: "image/png" }), "base.png");

  // Keep model name as you used when it worked
  fd.append("model", "gpt-image-1.5");
  fd.append("prompt", emotionPrompt(emotionLabel));
  fd.append("input_fidelity", "high");
  fd.append("output_format", "png");

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: fd,
  });

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Images edit failed ${r.status}: ${txt}`);
  }

  const data = await r.json();
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image returned from API");
  return Buffer.from(b64, "base64");
}

// -------------------------
// Job runner
// -------------------------

async function runJob(jobId, file, outputDirRaw) {
  const job = jobs.get(jobId);
  if (!job) return;

  try {
    job.status = "running";
    job.message = "Validating output folder";

    const outputDir = pickOutputDir(outputDirRaw);
    await ensureDirWritable(outputDir);
    job.outputDir = outputDir;

    const stem = safeStem(file.originalname);
    const runId = crypto.randomBytes(3).toString("hex");

    // Step 1, prepare neutral (not saved separately)
    job.message = "Preparing neutral (1/8)";
    const base144 = await to144Png(file.buffer);

    job.current = 1;
    job.message = "Neutral ready (1/8)";

    const results = [base144];

    // Steps 2..8, generate other emotions (not saved separately)
    for (let i = 1; i < EMOTIONS.length; i++) {
      const emo = EMOTIONS[i];
      const stepNum = i + 1; // 2..8

      job.message = `Generating ${emo.label} (${stepNum}/8)`;

      const buf = await editWithEmotion(base144, emo.label);

      // Force exact 144x144 output
      const fixed = await to144Png(buf);
      results.push(fixed);

      job.current = stepNum;
      job.message = `Finished ${emo.label} (${stepNum}/8)`;
    }

    // Compose and save only the final sheet into the outputDir root
    job.message = "Composing and saving sheet";
    const sheet = await composeSheet(results);

    const sheetFileName = `${stem}_sheet_576x288_${runId}.png`;
    const sheetPath = path.join(outputDir, sheetFileName);
    await saveBuffer(sheetPath, sheet);

    job.saved.push(sheetPath);

    job.status = "done";
    job.done = true;
    job.message = "Done";
  } catch (e) {
    job.status = "error";
    job.done = true;
    job.error = String(e?.message || e);
    job.message = "Error";
  }
}

// -------------------------
// Routes
// -------------------------

app.get("/", (req, res) => {
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Portrait Sheet</title>
  <style>
    body { font-family: system-ui, Arial; max-width: 980px; margin: 24px auto; padding: 0 16px; }
    .drop { border: 2px dashed #999; border-radius: 12px; padding: 18px; text-align: center; }
    .row { display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; margin-top: 12px; }
    .col { display: flex; flex-direction: column; gap: 8px; }
    button { padding: 10px 14px; border-radius: 10px; border: 1px solid #ccc; cursor: pointer; }
    input[type="text"] { padding: 10px 12px; border-radius: 10px; border: 1px solid #ccc; width: 520px; max-width: 100%; }
    .log { white-space: pre-wrap; background: #f6f6f6; border-radius: 12px; padding: 12px; margin-top: 12px; }
    #preview { display:none; width:144px; height:144px; border:1px solid #ddd; border-radius:12px; object-fit: cover; }
    .hint { color: #555; font-size: 13px; line-height: 1.3; }
    .label { font-size: 13px; font-weight: 600; }
  </style>
</head>
<body>
  <h1>Portrait Sheet Generator</h1>

  <div class="row">
    <div class="col">
      <div class="drop" id="drop">
        <p><strong>Drag and drop</strong> an image here</p>
        <p>or</p>
        <input type="file" id="file" accept="image/png,image/jpeg,image/webp" />
      </div>

      <div class="col">
        <div class="label">Output folder</div>
        <input type="text" id="outDir" placeholder="Example: C:\\\\dev\\\\output" />
        <div class="hint">
          This is saved in your browser for next time.
          The app will write the final 576x288 sheet directly into this folder.
        </div>
      </div>

      <div class="row">
        <button id="go" disabled>Generate</button>
      </div>
    </div>

    <div class="col">
      <div class="label">Preview</div>
      <img id="preview" />
    </div>
  </div>

  <div class="log" id="log"></div>

  <script>
    const drop = document.getElementById("drop");
    const fileInput = document.getElementById("file");
    const go = document.getElementById("go");
    const log = document.getElementById("log");
    const preview = document.getElementById("preview");
    const outDir = document.getElementById("outDir");

    let file = null;

    function setLog(msg) { log.textContent = msg; }

    // Persist output folder between sessions
    const savedDir = localStorage.getItem("output_dir") || "";
    if (savedDir) outDir.value = savedDir;

    outDir.addEventListener("input", () => {
      localStorage.setItem("output_dir", outDir.value || "");
    });

    function setFile(f) {
      file = f;
      go.disabled = !file;

      if (file) {
        preview.src = URL.createObjectURL(file);
        preview.style.display = "block";
        setLog("Selected: " + file.name);
      } else {
        preview.style.display = "none";
        setLog("");
      }
    }

    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.style.opacity = 0.7; });
    drop.addEventListener("dragleave", () => { drop.style.opacity = 1; });
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.style.opacity = 1;
      if (e.dataTransfer.files && e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
    });

    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files[0]) setFile(fileInput.files[0]);
    });

    go.addEventListener("click", async () => {
      if (!file) return;

      const dir = (outDir.value || "").trim();
      if (!dir) {
        setLog("Please enter an output folder path first, for example C:\\\\dev\\\\output");
        return;
      }

      setLog("Uploading...");
      const fd = new FormData();
      fd.append("image", file);
      fd.append("outputDir", dir);

      const start = await fetch("/api/generate/start", { method: "POST", body: fd });
      const startData = await start.json();

      if (!start.ok) {
        setLog("Error: " + (startData?.error || "unknown"));
        return;
      }

      const jobId = startData.jobId;
      setLog("Started job " + jobId);

      const poll = async () => {
        const r = await fetch("/api/generate/status/" + jobId);
        const s = await r.json();

        if (!r.ok) {
          setLog("Error: " + (s?.error || "unknown"));
          return;
        }

        const line1 = (s.status || "").toUpperCase() + " " + (s.current || 0) + "/" + (s.total || 8);
        const line2 = s.message || "";
        const line3 = s.outputDir ? ("Output: " + s.outputDir) : "";
        setLog([line1, line2, line3].filter(Boolean).join("\\n"));

        if (s.done) {
          if (s.error) {
            setLog("Error: " + s.error);
          } else {
            setLog("Done, saved file:\\n" + (s.saved || []).join("\\n"));
          }
          return;
        }

        setTimeout(poll, 900);
      };

      poll();
    });
  </script>
</body>
</html>`);
});

app.post("/api/generate/start", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const outputDir = (req.body?.outputDir || "").trim();
    if (!outputDir) return res.status(400).json({ error: "Missing outputDir" });

    const jobId = crypto.randomBytes(8).toString("hex");
    jobs.set(jobId, {
      status: "queued",
      current: 0,
      total: EMOTIONS.length, // 8
      message: "Queued",
      saved: [],
      done: false,
      error: null,
      outputDir,
    });

    runJob(jobId, req.file, outputDir);

    res.json({ jobId });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/generate/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(job);
});

app.listen(port, async () => {
  const url = `http://localhost:${port}`;
  console.log(`Portrait Generator running at ${url}`);

  try {
    await open(url);
  } catch {
    // If it fails (headless, SSH, etc), just ignore
  }
});