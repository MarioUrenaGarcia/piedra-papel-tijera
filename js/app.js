import {
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";
import { BEATS, LABELS, StableGesture, classify } from "./logic.js";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const COUNTDOWN = ["Piedra", "Papel", "Tijera"];
const STEP_MS = 450;
const STABLE_FRAMES = 3;
const SHOOT_TIMEOUT_MS = 2500;
const RESULT_MS = 2400;
const HISTORY_MAX = 12;

const $ = (id) => document.getElementById(id);
const el = {
  stage: $("stage"),
  video: $("video"),
  canvas: $("overlay"),
  layers: {
    start: $("layer-start"),
    loading: $("layer-loading"),
    idle: $("layer-idle"),
    count: $("layer-count"),
    result: $("layer-result"),
  },
  error: $("error"),
  loadingText: $("loading-text"),
  countWord: $("count-word"),
  cards: document.querySelector("#layer-result .cards"),
  resYou: $("res-you"),
  resCpu: $("res-cpu"),
  resYouIcon: $("res-you-icon"),
  resCpuIcon: $("res-cpu-icon"),
  verdict: $("verdict"),
  reaction: $("reaction"),
  live: $("live"),
  liveText: $("live-text"),
  chips: [...document.querySelectorAll(".chip")],
  scoreCpu: $("score-cpu"),
  scoreYou: $("score-you"),
  round: $("round"),
  statLast: $("stat-last"),
  statBest: $("stat-best"),
  statAvg: $("stat-avg"),
  history: $("history"),
  play: $("btn-play"),
  auto: $("btn-auto"),
  reset: $("btn-reset"),
  camera: $("btn-camera"),
  sound: $("sound"),
  fps: $("fps"),
};
const ctx = el.canvas.getContext("2d");

const game = {
  state: "start",
  t0: 0,
  step: -1,
  auto: false,
  scoreCpu: 0,
  scoreYou: 0,
  rounds: 0,
  reactions: [],
  stable: new StableGesture(STABLE_FRAMES),
};

let landmarker = null;
let lastVideoTime = -1;
let soundOn = true;
let audio = null;

/* Sonido sintetizado: evita cargar archivos y suena al instante */

function beep(freq, ms, type = "square", gain = 0.06, slideTo = null) {
  if (!soundOn) return;
  audio ??= new AudioContext();
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  const vol = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + ms / 1000);
  vol.gain.setValueAtTime(gain, t);
  vol.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.connect(vol).connect(audio.destination);
  osc.start(t);
  osc.stop(t + ms / 1000);
}

const sfx = {
  tick: () => beep(440, 120),
  go: () => beep(880, 180, "square", 0.08),
  win: () => {
    beep(220, 450, "sawtooth", 0.07, 70);
    setTimeout(() => beep(660, 140, "square", 0.05), 60);
  },
  miss: () => beep(160, 300, "triangle", 0.08),
};

/* Pantallas */

function showLayer(name) {
  for (const [key, node] of Object.entries(el.layers)) node.hidden = key !== name;
}

function setControls() {
  const ready = landmarker !== null;
  el.play.disabled = !ready || game.state === "countdown" || game.state === "shoot";
  el.auto.disabled = !ready;
}

function restartAnimation(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

/* Flujo del juego */

function startRound() {
  if (!landmarker || game.state === "countdown" || game.state === "shoot") return;
  game.state = "countdown";
  game.t0 = performance.now();
  game.step = -1;
  game.stable.reset();
  showLayer("count");
  setControls();
}

function finishRound(player, now) {
  const reaction = Math.round(now - game.t0);
  const cpu = BEATS[player];
  game.state = "result";
  game.t0 = now;
  game.rounds += 1;
  game.scoreCpu += 1;
  game.reactions.push(reaction);

  el.cards.hidden = false;
  el.resYou.textContent = LABELS[player];
  el.resCpu.textContent = LABELS[cpu];
  el.resYouIcon.setAttribute("href", `#icon-${player}`);
  el.resCpuIcon.setAttribute("href", `#icon-${cpu}`);
  el.verdict.textContent = "Gana la máquina";
  el.reaction.textContent = `Reaccionó en ${reaction} ms`;
  showLayer("result");

  el.scoreCpu.textContent = game.scoreCpu;
  el.round.textContent = `Ronda ${game.rounds}`;
  restartAnimation(el.scoreCpu, "bump");
  restartAnimation(el.stage, "flash");
  restartAnimation(el.stage, "shake");
  updateStats();
  addHistory(player, cpu);
  sfx.win();
  setControls();
}

function missRound(now) {
  game.state = "result";
  game.t0 = now;
  el.cards.hidden = true;
  el.verdict.textContent = "No vi tu mano";
  el.reaction.textContent = "Pon la mano frente a la cámara y vuelve a intentarlo";
  showLayer("result");
  sfx.miss();
  setControls();
}

function tick(gesture, now) {
  if (game.state === "countdown") {
    const step = Math.floor((now - game.t0) / STEP_MS);
    if (step >= COUNTDOWN.length) {
      game.state = "shoot";
      game.t0 = now;
      game.stable.reset();
      el.countWord.textContent = "Ya!";
      el.countWord.classList.add("go");
      restartAnimation(el.countWord, "pop");
      sfx.go();
    } else if (step !== game.step) {
      game.step = step;
      el.countWord.textContent = COUNTDOWN[step];
      el.countWord.classList.remove("go");
      restartAnimation(el.countWord, "pop");
      sfx.tick();
    }
  } else if (game.state === "shoot") {
    const locked = game.stable.push(gesture);
    if (locked) finishRound(locked, now);
    else if (now - game.t0 > SHOOT_TIMEOUT_MS) missRound(now);
  } else if (game.state === "result" && now - game.t0 > RESULT_MS) {
    if (game.auto) {
      game.state = "idle";
      startRound();
    } else {
      game.state = "idle";
      showLayer("idle");
      setControls();
    }
  }
}

/* Paneles */

function updateStats() {
  const r = game.reactions;
  if (!r.length) {
    el.statLast.textContent = el.statBest.textContent = el.statAvg.textContent = "0";
    return;
  }
  el.statLast.textContent = r[r.length - 1];
  el.statBest.textContent = Math.min(...r);
  el.statAvg.textContent = Math.round(r.reduce((a, b) => a + b, 0) / r.length);
}

function addHistory(player, cpu) {
  el.history.querySelector(".empty")?.remove();
  const li = document.createElement("li");
  li.title = `${LABELS[player]} contra ${LABELS[cpu]}`;
  li.innerHTML = `
    <svg class="h-you"><use href="#icon-${player}" /></svg>
    <span class="h-x">vs</span>
    <svg class="h-cpu"><use href="#icon-${cpu}" /></svg>`;
  el.history.prepend(li);
  while (el.history.children.length > HISTORY_MAX) el.history.lastElementChild.remove();
}

function resetScore() {
  game.scoreCpu = game.scoreYou = game.rounds = 0;
  game.reactions = [];
  el.scoreCpu.textContent = "0";
  el.scoreYou.textContent = "0";
  el.round.textContent = "Ronda 0";
  el.history.innerHTML = '<li class="empty">Aún no hay rondas</li>';
  updateStats();
}

function showLive(gesture, hasHand) {
  el.live.classList.toggle("on", hasHand);
  el.liveText.textContent = gesture ? LABELS[gesture] : hasHand ? "Mano detectada" : "Buscando mano";
  for (const chip of el.chips) chip.classList.toggle("active", chip.dataset.g === gesture);
}

/* Dibujo de la mano */

function drawHand(landmarks) {
  const { width: w, height: h } = el.canvas;
  ctx.clearRect(0, 0, w, h);
  if (!landmarks) return;

  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(3, w / 260);
  ctx.strokeStyle = "#ff1f3d";
  ctx.shadowColor = "#ff1f3d";
  ctx.shadowBlur = 20;
  ctx.beginPath();
  for (const { start, end } of HandLandmarker.HAND_CONNECTIONS) {
    ctx.moveTo(landmarks[start].x * w, landmarks[start].y * h);
    ctx.lineTo(landmarks[end].x * w, landmarks[end].y * h);
  }
  ctx.stroke();

  ctx.shadowColor = "#ff1f3d";
  ctx.fillStyle = "#eaf2ff";
  const r = Math.max(4, w / 200);
  for (const p of landmarks) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
}

/* Bucle principal */

let fpsFrames = 0;
let fpsSince = 0;

function countFrame(now) {
  fpsFrames += 1;
  if (now - fpsSince >= 1000) {
    el.fps.textContent = `${Math.round((fpsFrames * 1000) / (now - fpsSince))} FPS`;
    fpsFrames = 0;
    fpsSince = now;
  }
}

function loop() {
  const now = performance.now();
  let gesture = null;
  let landmarks = null;

  if (el.video.readyState >= 2 && el.video.currentTime !== lastVideoTime) {
    lastVideoTime = el.video.currentTime;
    countFrame(now);
    if (el.canvas.width !== el.video.videoWidth) {
      el.canvas.width = el.video.videoWidth;
      el.canvas.height = el.video.videoHeight;
    }
    const result = landmarker.detectForVideo(el.video, now);
    landmarks = result.landmarks?.[0] ?? null;
    gesture = landmarks ? classify(landmarks) : null;
    drawHand(landmarks);
    showLive(gesture, Boolean(landmarks));
    tick(gesture, now);
  } else if (game.state !== "shoot") {
    // Sin cuadro nuevo no hay gesto nuevo, pero la cuenta regresiva debe seguir avanzando.
    tick(null, now);
  }

  requestAnimationFrame(loop);
}

/* Arranque */

async function createLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    return await HandLandmarker.createFromOptions(vision, options("GPU"));
  } catch {
    return HandLandmarker.createFromOptions(vision, options("CPU"));
  }
}

async function openCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  el.video.srcObject = stream;
  await el.video.play();
}

function cameraError(err) {
  if (!window.isSecureContext) return "La cámara solo funciona en https o en localhost.";
  if (err?.name === "NotAllowedError") return "Necesito permiso para usar la cámara. Revísalo en la barra de direcciones.";
  if (err?.name === "NotFoundError") return "No encontré ninguna cámara conectada.";
  if (err?.name === "NotReadableError") return "La cámara está ocupada por otra aplicación.";
  return "No se pudo iniciar. Recarga la página e inténtalo de nuevo.";
}

async function boot() {
  el.error.hidden = true;
  showLayer("loading");
  el.loadingText.textContent = "Cargando modelo de manos";
  try {
    const [model] = await Promise.all([createLandmarker(), openCamera()]);
    landmarker = model;
  } catch (err) {
    console.error(err);
    el.error.textContent = cameraError(err);
    el.error.hidden = false;
    showLayer("start");
    return;
  }
  game.state = "idle";
  el.live.hidden = false;
  showLayer("idle");
  setControls();
  requestAnimationFrame(loop);
}

function toggleAuto() {
  if (!landmarker) return;
  game.auto = !game.auto;
  el.auto.setAttribute("aria-pressed", String(game.auto));
  if (game.auto && game.state === "idle") startRound();
}

function toggleSound() {
  soundOn = !soundOn;
  el.sound.setAttribute("aria-pressed", String(soundOn));
}

el.camera.addEventListener("click", boot);
el.play.addEventListener("click", startRound);
el.auto.addEventListener("click", toggleAuto);
el.reset.addEventListener("click", resetScore);
el.sound.addEventListener("click", toggleSound);

document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "Space") {
    // Espacio sobre un boton enfocado ya dispara su click nativo.
    if (e.target.closest("button")) return;
    e.preventDefault();
    startRound();
  } else if (e.code === "KeyA") toggleAuto();
  else if (e.code === "KeyR") resetScore();
  else if (e.code === "KeyM") toggleSound();
});
