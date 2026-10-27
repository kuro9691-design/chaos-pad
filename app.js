const canvas = document.querySelector("#stage");
const ctx = canvas.getContext("2d", { alpha: false });
const audio = document.querySelector("#audio");
const video = document.querySelector("#sourceVideo");
const statusEl = document.querySelector("#status");
const playBtn = document.querySelector("#playBtn");
const stopBtn = document.querySelector("#stopBtn");
const recordBtn = document.querySelector("#recordBtn");
const downloadLink = document.querySelector("#downloadLink");
const audioInput = document.querySelector("#audioInput");
const visualInput = document.querySelector("#visualInput");
const cutRate = document.querySelector("#cutRate");
const gridSize = document.querySelector("#gridSize");
const noiseLevel = document.querySelector("#noiseLevel");
const captionText = document.querySelector("#captionText");
const scanlines = document.querySelector("#scanlines");
const posterize = document.querySelector("#posterize");
const audioName = document.querySelector("#audioName");
const visualName = document.querySelector("#visualName");
const xyPad = document.querySelector("#xyPad");
const xRead = document.querySelector("#xRead");
const yRead = document.querySelector("#yRead");
const sampleButtons = document.querySelectorAll(".sample");
const sequencer = document.querySelector("#sequencer");
const rhythmBtn = document.querySelector("#rhythmBtn");
const clearSeqBtn = document.querySelector("#clearSeqBtn");
const tempoInput = document.querySelector("#tempoInput");
const tempoRead = document.querySelector("#tempoRead");

const sampleList = Array.from(sampleButtons).map((button) => ({
  label: button.textContent,
  src: button.dataset.src,
}));

const state = {
  mode: "chlorophyll",
  media: [],
  currentMedia: -1,
  beat: 0,
  energy: 0,
  recorder: null,
  chunks: [],
  synthetic: true,
  rhythmPlaying: false,
  rhythmStep: -1,
  rhythmTimer: null,
  sequence: [],
  sampleBuffers: new Map(),
  samplePulseUntil: 0,
  x: 0.5,
  y: 0.5,
  freezeUntil: 0,
  flashUntil: 0,
  mirrorUntil: 0,
  invertUntil: 0,
  burnUntil: 0,
  typeUntil: 0,
  sliceUntil: 0,
  frozenFrame: null,
};

let audioContext;
let analyser;
let dataArray;
let sourceNode;
let analyserOutputConnected = false;

const palettes = {
  chlorophyll: ["#07100c", "#213b27", "#d7ff5f", "#e8e6d0", "#ff4f38", "#65f7ff"],
  ash: ["#080909", "#303432", "#cbd1c5", "#f1f4ec", "#a9ff65", "#65f7ff"],
  alarm: ["#120807", "#4f1010", "#ff4f38", "#f2e9d8", "#111111", "#d7ff5f"],
};

function setStatus(text) {
  statusEl.textContent = text;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updatePadUi() {
  const xPct = Math.round(state.x * 100);
  const yPct = Math.round(state.y * 100);
  xyPad.style.setProperty("--pad-x", `${xPct}%`);
  xyPad.style.setProperty("--pad-y", `${yPct}%`);
  xRead.textContent = `CUT ${xPct}`;
  yRead.textContent = `BEND ${100 - yPct}`;
  cutRate.value = Math.round(1 + state.x * 15);
  gridSize.value = Math.round(2 + (1 - state.y) * 8);
  noiseLevel.value = Math.round(12 + state.x * 48 + (1 - state.y) * 40);
}

function seedSequence() {
  state.sequence = sampleList.map((_, row) =>
    Array.from({ length: 16 }, (_, step) => {
      if (row === 0) return step % 4 === 0;
      if (row === 1) return step % 8 === 4;
      if (row === 2) return step % 4 === 2;
      if (row === 3) return step % 8 === 6;
      return false;
    }),
  );
}

function renderSequencer() {
  sequencer.replaceChildren();
  state.sequence.forEach((row, rowIndex) => {
    const label = document.createElement("div");
    label.className = "seq-label";
    label.textContent = sampleList[rowIndex].label;
    sequencer.append(label);

    row.forEach((isOn, stepIndex) => {
      const button = document.createElement("button");
      button.className = "seq-step";
      button.type = "button";
      button.dataset.row = String(rowIndex);
      button.dataset.step = String(stepIndex);
      button.setAttribute("aria-label", `${sampleList[rowIndex].label} step ${stepIndex + 1}`);
      button.classList.toggle("on", isOn);
      button.classList.toggle("playing", stepIndex === state.rhythmStep);
      sequencer.append(button);
    });
  });
}

function updateSequencerPlayhead() {
  document.querySelectorAll(".seq-step.playing").forEach((button) => {
    button.classList.remove("playing");
  });
  document.querySelectorAll(`.seq-step[data-step="${state.rhythmStep}"]`).forEach((button) => {
    button.classList.add("playing");
  });
}

function setPadFromPointer(event) {
  const rect = xyPad.getBoundingClientRect();
  state.x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  state.y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  updatePadUi();
}

function fitCover(source, dx, dy, dw, dh) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh) return;
  const scale = Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(source, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
}

function createProceduralCell(x, y, w, h, t, seed) {
  const p = palettes[state.mode];
  const pulse = 0.5 + Math.sin(t * 0.004 + seed) * 0.5;
  ctx.fillStyle = p[(seed + Math.floor(t * 0.002)) % p.length];
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = `rgba(0,0,0,${0.35 + pulse * 0.22})`;
  ctx.lineWidth = 2 + state.x * 5;

  if (seed % 4 === 0) {
    for (let i = 0; i < 11; i += 1) {
      const lx = x + ((i * 31 + t * (0.015 + state.x * 0.045) + seed * 17) % (w + 80)) - 40;
      ctx.beginPath();
      ctx.moveTo(lx, y);
      ctx.lineTo(lx - w * (0.14 + state.x * 0.3), y + h);
      ctx.stroke();
    }
  } else if (seed % 4 === 1) {
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.arc(
        x + w * (0.15 + i * 0.18),
        y + h * (0.5 + Math.sin(t * 0.003 + i) * (0.16 + state.x * 0.2)),
        h * (0.12 + state.y * 0.1),
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    }
  } else if (seed % 4 === 2) {
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    for (let i = 0; i < 7; i += 1) {
      const bx = x + ((i * 53 + seed * 11) % w);
      const bh = h * (0.25 + ((i + seed) % 4) * 0.16);
      ctx.fillRect(bx, y + h - bh, Math.max(4, w * 0.035), bh);
    }
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.16)";
    for (let i = 0; i < 12; i += 1) {
      ctx.fillRect(x + Math.random() * w, y + Math.random() * h, w * 0.08, 2 + Math.random() * 12);
    }
  }
}

function drawMediaCell(x, y, w, h, t, seed) {
  if (!state.media.length) {
    createProceduralCell(x, y, w, h, t, seed);
    return;
  }

  const item = state.media[(state.currentMedia + seed + state.media.length) % state.media.length];
  if (item.kind === "image") {
    fitCover(item.el, x, y, w, h);
    return;
  }

  fitCover(video, x, y, w, h);
}

function getEnergy(t) {
  const samplePulse = performance.now() < state.samplePulseUntil ? 0.88 : 0;
  if (!analyser || !dataArray || state.synthetic) {
    return clamp(
      Math.max(samplePulse, 0.55 + Math.sin(t * 0.006) * 0.25 + Math.sin(t * 0.017) * 0.12),
      0,
      1,
    );
  }

  analyser.getByteFrequencyData(dataArray);
  let sum = 0;
  for (let i = 0; i < dataArray.length; i += 1) sum += dataArray[i];
  return Math.max(samplePulse, Math.min(1, sum / dataArray.length / 130));
}

function drawFrame(t) {
  requestAnimationFrame(drawFrame);

  const width = canvas.width;
  const height = canvas.height;
  const now = performance.now();
  const energy = getEnergy(t);
  state.energy = state.energy * 0.75 + energy * 0.25;
  const cuts = Number(cutRate.value);
  const grid = Number(gridSize.value);
  const p = palettes[state.mode];
  const cutMoment = Math.floor(t / (980 / cuts + 18));

  if (cutMoment !== state.beat) {
    state.beat = cutMoment;
    state.currentMedia = state.media.length ? (state.currentMedia + 1) % state.media.length : -1;
  }

  if (now < state.freezeUntil && state.frozenFrame) {
    ctx.putImageData(state.frozenFrame, 0, 0);
    drawNoise(width, height, Number(noiseLevel.value), t);
    return;
  }

  ctx.fillStyle = p[0];
  ctx.fillRect(0, 0, width, height);
  ctx.save();
  const chaos = state.energy + state.x * 0.9 + (1 - state.y) * 0.55;
  ctx.translate((Math.random() - 0.5) * chaos * 18, (Math.random() - 0.5) * chaos * 12);

  const cols = grid;
  const rows = Math.max(2, Math.round(grid * 0.56));
  const cellW = width / cols;
  const cellH = height / rows;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const seed = row * cols + col + state.beat;
      const jitter = chaos * 24;
      const x = col * cellW + Math.sin(seed * 7.1 + t * 0.006) * jitter;
      const y = row * cellH + Math.cos(seed * 3.4 + t * 0.005) * jitter;
      const scale = now < state.sliceUntil ? 0.65 + Math.random() * 0.7 : 1;
      drawMediaCell(x, y, cellW * scale + 2, cellH * scale + 2, t, seed);
      ctx.fillStyle = `rgba(0,0,0,${0.04 + chaos * 0.16})`;
      ctx.fillRect(x, y, cellW * scale + 2, cellH * scale + 2);
    }
  }
  ctx.restore();

  if (now < state.mirrorUntil) drawMirror(width, height);
  if (posterize.checked) drawPosterize(width, height);
  if (now < state.burnUntil) drawBurn(width, height, p);
  if (now < state.invertUntil) drawInvert(width, height);
  if (now < state.flashUntil) drawFlash(width, height);

  drawTypography(t, p);
  drawNoise(width, height, Number(noiseLevel.value), t);
  if (scanlines.checked) drawScanlines(width, height);

  if (now < state.freezeUntil && !state.frozenFrame) {
    state.frozenFrame = ctx.getImageData(0, 0, width, height);
  }
}

function drawMirror(width, height) {
  ctx.save();
  ctx.globalAlpha = 0.56;
  ctx.scale(-1, 1);
  ctx.drawImage(canvas, -width, 0, width / 2, height, -width / 2, 0, width / 2, height);
  ctx.restore();
}

function drawPosterize(width, height) {
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = state.mode === "alarm" ? "rgba(255,79,56,0.25)" : "rgba(215,255,95,0.14)";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
}

function drawBurn(width, height, p) {
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = p[4];
  for (let i = 0; i < 12; i += 1) {
    ctx.fillRect(Math.random() * width, Math.random() * height, width * Math.random(), 3 + Math.random() * 42);
  }
  ctx.restore();
}

function drawInvert(width, height) {
  ctx.save();
  ctx.globalCompositeOperation = "difference";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function drawFlash(width, height) {
  ctx.save();
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = "#d7ff5f";
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function drawTypography(t, p) {
  const text = captionText.value.trim() || "CHAOS PAD";
  const flash = state.energy > 0.62 || Math.floor(t / 180) % 5 === 0 || performance.now() < state.typeUntil;
  ctx.save();
  ctx.globalAlpha = flash ? 0.96 : 0.55;
  ctx.fillStyle = flash ? p[4] : p[2];
  ctx.font = `${flash ? 920 : 800} ${64 + state.x * 34}px ui-sans-serif, system-ui`;
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 28), 42 + state.energy * 18, canvas.height - 86);

  ctx.font = "800 18px ui-monospace, SFMono-Regular, Consolas, monospace";
  const labels = ["TREE", "SAW", "SMOKE", "ROOT", "DATA", "CUT", "PAD", "LOOP"];
  for (let i = 0; i < 10; i += 1) {
    const label = labels[(i + state.beat) % labels.length];
    ctx.fillText(label, 28 + i * 132, 42 + Math.sin(t * 0.004 + i) * (10 + state.x * 24));
  }
  ctx.restore();
}

function drawNoise(width, height, amount, t) {
  const count = Math.round(amount * 16);
  ctx.save();
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.13})`;
    ctx.fillRect(Math.random() * width, Math.random() * height, Math.random() * 3 + 1, Math.random() * 34 + 2);
  }
  if (amount > 50 && Math.floor(t / 120) % 2 === 0) {
    ctx.fillStyle = "rgba(255,79,56,0.24)";
    ctx.fillRect(0, Math.random() * height, width, 8 + Math.random() * 28);
  }
  ctx.restore();
}

function drawScanlines(width, height) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  for (let y = 0; y < height; y += 4) {
    ctx.fillRect(0, y, width, 1);
  }
  ctx.restore();
}

async function ensureAudioGraph() {
  if (!audioContext) {
    audioContext = new AudioContext();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    dataArray = new Uint8Array(analyser.frequencyBinCount);
  }

  if (audioContext.state === "suspended") await audioContext.resume();

  if (!analyserOutputConnected) {
    analyser.connect(audioContext.destination);
    analyserOutputConnected = true;
  }

  if (audio.src && !sourceNode) {
    sourceNode = audioContext.createMediaElementSource(audio);
    sourceNode.connect(analyser);
  }
}

async function getSampleBuffer(index) {
  const sample = sampleList[index];
  if (!sample) return null;
  if (state.sampleBuffers.has(sample.src)) return state.sampleBuffers.get(sample.src);

  await ensureAudioGraph();
  const response = await fetch(sample.src);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = await audioContext.decodeAudioData(arrayBuffer);
  state.sampleBuffers.set(sample.src, buffer);
  return buffer;
}

async function playSample(index, velocity = 0.9) {
  const buffer = await getSampleBuffer(index);
  if (!buffer) return;

  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = buffer;
  gain.gain.value = velocity;
  source.connect(gain);
  gain.connect(analyser);
  source.start();
  state.synthetic = false;
  state.samplePulseUntil = performance.now() + 110;
  state.flashUntil = Math.max(state.flashUntil, performance.now() + 80);
}

function stepIntervalMs() {
  return 60000 / Number(tempoInput.value) / 4;
}

function advanceRhythm() {
  state.rhythmStep = (state.rhythmStep + 1) % 16;
  updateSequencerPlayhead();

  state.sequence.forEach((row, rowIndex) => {
    if (row[state.rhythmStep]) {
      playSample(rowIndex, rowIndex === 0 ? 0.95 : 0.72);
    }
  });

  state.beat += 1;
  if (state.rhythmStep % 4 === 0) trigger("slice");
  setStatus(`STEP ${state.rhythmStep + 1}`);
}

function startRhythm() {
  if (state.rhythmPlaying) return;
  state.rhythmPlaying = true;
  rhythmBtn.classList.add("on");
  rhythmBtn.textContent = "ON";
  state.rhythmStep = -1;
  advanceRhythm();
  state.rhythmTimer = window.setInterval(advanceRhythm, stepIntervalMs());
}

function stopRhythm() {
  state.rhythmPlaying = false;
  rhythmBtn.classList.remove("on");
  rhythmBtn.textContent = "SEQ";
  window.clearInterval(state.rhythmTimer);
  state.rhythmTimer = null;
  state.rhythmStep = -1;
  updateSequencerPlayhead();
}

function restartRhythmTimer() {
  tempoRead.textContent = `${tempoInput.value} BPM`;
  if (!state.rhythmPlaying) return;
  window.clearInterval(state.rhythmTimer);
  state.rhythmTimer = window.setInterval(advanceRhythm, stepIntervalMs());
}

async function play() {
  await ensureAudioGraph();
  if (audio.src) {
    state.synthetic = false;
    try {
      await audio.play();
      setStatus("PLAYING");
    } catch (error) {
      setStatus("TAP PLAY");
    }
  } else {
    state.synthetic = true;
    setStatus("AUTO BEAT");
  }

  const videoItem = state.media.find((item) => item.kind === "video");
  if (videoItem) {
    video.src = videoItem.url;
    await video.play().catch(() => {});
  }
}

function stop() {
  audio.pause();
  audio.currentTime = 0;
  video.pause();
  stopRhythm();
  state.synthetic = true;
  setStatus("STOP");
}

function trigger(name) {
  const now = performance.now();
  state.frozenFrame = null;

  if (name === "strobe") state.flashUntil = now + 650;
  if (name === "freeze") state.freezeUntil = now + 1000;
  if (name === "mirror") state.mirrorUntil = now + 1400;
  if (name === "invert") state.invertUntil = now + 900;
  if (name === "slice") state.sliceUntil = now + 1200;
  if (name === "burn") state.burnUntil = now + 1200;
  if (name === "type") state.typeUntil = now + 1600;
  if (name === "random") {
    state.x = Math.random();
    state.y = Math.random();
    state.mode = ["chlorophyll", "ash", "alarm"][Math.floor(Math.random() * 3)];
    document.querySelectorAll(".mode").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === state.mode);
    });
    updatePadUi();
    state.flashUntil = now + 400;
    state.sliceUntil = now + 900;
  }

  setStatus(name.toUpperCase());
}

function loadAudioSource(src, label) {
  audio.pause();
  audio.src = src;
  audio.currentTime = 0;
  state.synthetic = false;
  audioName.textContent = label;
  sampleButtons.forEach((button) => {
    button.classList.toggle("loaded", button.dataset.src === src);
  });
  setStatus(label);
}

audioInput.addEventListener("change", () => {
  const file = audioInput.files[0];
  if (!file) return;
  loadAudioSource(URL.createObjectURL(file), file.name);
  state.synthetic = false;
  sampleButtons.forEach((button) => button.classList.remove("loaded"));
  setStatus("AUDIO");
});

visualInput.addEventListener("change", async () => {
  state.media.forEach((item) => URL.revokeObjectURL(item.url));
  state.media = [];

  for (const file of visualInput.files) {
    const url = URL.createObjectURL(file);
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
      state.media.push({ kind: "image", el: img, url });
    } else if (file.type.startsWith("video/")) {
      state.media.push({ kind: "video", url });
    }
  }

  state.currentMedia = 0;
  visualName.textContent =
    state.media.length === 0
      ? "none"
      : state.media.length === 1
        ? visualInput.files[0].name
        : `${state.media.length} files`;
  setStatus(`${state.media.length} SRC`);
});

document.querySelectorAll(".mode").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".mode").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.mode = button.dataset.mode;
    setStatus(button.textContent);
  });
});

document.querySelectorAll(".trigger").forEach((button) => {
  button.addEventListener("pointerdown", () => {
    button.classList.add("active");
    trigger(button.dataset.trigger);
  });
  button.addEventListener("pointerup", () => button.classList.remove("active"));
  button.addEventListener("pointerleave", () => button.classList.remove("active"));
});

sampleButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    loadAudioSource(button.dataset.src, button.textContent);
    await playSample(sampleList.findIndex((sample) => sample.src === button.dataset.src));
  });
});

sequencer.addEventListener("click", (event) => {
  const button = event.target.closest(".seq-step");
  if (!button) return;
  const row = Number(button.dataset.row);
  const step = Number(button.dataset.step);
  state.sequence[row][step] = !state.sequence[row][step];
  button.classList.toggle("on", state.sequence[row][step]);
  if (state.sequence[row][step]) playSample(row, 0.82);
});

rhythmBtn.addEventListener("click", () => {
  if (state.rhythmPlaying) {
    stopRhythm();
    setStatus("SEQ OFF");
  } else {
    startRhythm();
  }
});

clearSeqBtn.addEventListener("click", () => {
  state.sequence = sampleList.map(() => Array.from({ length: 16 }, () => false));
  renderSequencer();
  setStatus("CLEAR");
});

tempoInput.addEventListener("input", restartRhythmTimer);

xyPad.addEventListener("pointerdown", (event) => {
  xyPad.setPointerCapture(event.pointerId);
  setPadFromPointer(event);
  state.flashUntil = performance.now() + 140;
});

xyPad.addEventListener("pointermove", (event) => {
  if (event.buttons !== 1) return;
  setPadFromPointer(event);
});

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  state.x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  state.y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
  updatePadUi();
  trigger("slice");
});

playBtn.addEventListener("click", play);
stopBtn.addEventListener("click", stop);

recordBtn.addEventListener("click", async () => {
  if (state.recorder?.state === "recording") {
    state.recorder.stop();
    return;
  }

  await play();
  const stream = canvas.captureStream(30);
  state.chunks = [];
  const options = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? { mimeType: "video/webm;codecs=vp9" }
    : { mimeType: "video/webm" };
  state.recorder = new MediaRecorder(stream, options);
  state.recorder.ondataavailable = (event) => {
    if (event.data.size) state.chunks.push(event.data);
  };
  state.recorder.onstop = () => {
    const blob = new Blob(state.chunks, { type: "video/webm" });
    downloadLink.href = URL.createObjectURL(blob);
    downloadLink.download = "chaos-pad-mv.webm";
    downloadLink.hidden = false;
    recordBtn.textContent = "REC";
    setStatus("SAVED");
  };
  state.recorder.start();
  recordBtn.textContent = "DONE";
  setStatus("REC");
});

seedSequence();
renderSequencer();
updatePadUi();
restartRhythmTimer();
requestAnimationFrame(drawFrame);
