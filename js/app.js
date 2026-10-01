import {
  FilesetResolver,
  HandLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";
import {
  BEATS,
  HistoryPredictor,
  LABELS,
  MOVES,
  Motion,
  ROCK,
  best,
  classify,
  extensions,
  intent,
  outcome,
  posterior,
} from "./logic.js";
import { VoiceTrigger, voiceSupported } from "./voice.js";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const COUNTDOWN = ["Piedra", "Papel", "Tijera"];
const STEP_MS = 450; // ritmo del conteo cuando se inicia con teclado
const BEAT_TIMEOUT_MS = 1700; // sin golpe ni palabra en este tiempo, se pierde el ritmo
const SHOOT_TIMEOUT_MS = 2500;
const COMMIT_CONFIDENCE = 0.86; // probabilidad minima para que la maquina se decida
const COMMIT_FRAMES = 2; // cuadros seguidos con la misma prediccion antes de decidir
const CONFIRM_FRAMES = 7; // cuadros con la mano quieta y el mismo gesto para validar
const CONFIRM_TIMEOUT_MS = 1600;
const CHANGE_FRAMES = 3; // cuadros para dar por vista una jugada completa
const RESULT_MS = 2600;
const REARM_MS = 900; // pausa tras un resultado antes de aceptar otro inicio por gesto
const HISTORY_MAX = 12;
const STORAGE_KEY = "rps-history";

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
    commit: $("layer-commit"),
    result: $("layer-result"),
  },
  error: $("error"),
  loadingText: $("loading-text"),
  idleTitle: $("idle-title"),
  countWord: $("count-word"),
  countSource: $("count-source"),
  pips: [...document.querySelectorAll(".pips i")],
  commitIcon: $("commit-icon"),
  commitMove: $("commit-move"),
  commitNote: $("commit-note"),
  validateBar: $("validate-bar"),
  cardYou: $("card-you"),
  cardCpu: $("card-cpu"),
  resultCards: $("result-cards"),
  resYou: $("res-you"),
  resCpu: $("res-cpu"),
  resYouIcon: $("res-you-icon"),
  resCpuIcon: $("res-cpu-icon"),
  verdict: $("verdict"),
  reaction: $("reaction"),
  detail: $("detail"),
  live: $("live"),
  liveText: $("live-text"),
  chips: [...document.querySelectorAll(".chip")],
  prior: [...document.querySelectorAll("#prior [data-g]")],
  priorText: $("prior-text"),
  scoreCpu: $("score-cpu"),
  scoreYou: $("score-you"),
  round: $("round"),
  statLead: $("stat-lead"),
  statAvg: $("stat-avg"),
  statAcc: $("stat-acc"),
  history: $("history"),
  play: $("btn-play"),
  voice: $("btn-voice"),
  voiceNote: $("voice-note"),
  voiceReadout: $("voice-readout"),
  voiceHeard: $("voice-heard"),
  reset: $("btn-reset"),
  forget: $("btn-forget"),
  camera: $("btn-camera"),
  sound: $("sound"),
  fps: $("fps"),
};
const ctx = el.canvas.getContext("2d");

/* Estado */

const game = {
  state: "start",
  source: null, // "hand", "voice" o "timer": quien marca el ritmo de esta ronda
  beat: 0,
  lastBeatAt: 0,
  t0: 0,
  readyAt: 0,
  prior: null,
  shoot: null,
  commit: null,
  confirm: null,
  scoreCpu: 0,
  scoreYou: 0,
  rounds: 0,
  leads: [],
  predictions: 0,
  hits: 0,
};

const motion = new Motion();
const predictor = new HistoryPredictor(loadHistory());
let landmarker = null;
let lastVideoTime = -1;
let soundOn = true;
let audio = null;

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(predictor.moves));
  } catch {
    // Sin almacenamiento el historial solo dura la sesion.
  }
}

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
  commit: () => beep(1320, 70, "square", 0.05),
  cpu: () => {
    beep(220, 450, "sawtooth", 0.07, 70);
    setTimeout(() => beep(660, 140, "square", 0.05), 60);
  },
  you: () => {
    beep(523, 120, "triangle", 0.08);
    setTimeout(() => beep(784, 220, "triangle", 0.08), 110);
  },
  tie: () => beep(330, 220, "triangle", 0.07),
  miss: () => beep(160, 300, "triangle", 0.08),
};

/* Pantallas */

function showLayer(name) {
  for (const [key, node] of Object.entries(el.layers)) node.hidden = key !== name;
}

function setControls() {
  el.play.disabled = !landmarker || !["idle", "result"].includes(game.state);
  el.voice.disabled = !landmarker || !voiceSupported;
}

function restartAnimation(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
}

function setIcon(use, move) {
  use.setAttribute("href", `#icon-${move}`);
}

function goIdle(title = "¿Listo para perder?") {
  game.state = "idle";
  game.source = null;
  el.idleTitle.textContent = title;
  showLayer("idle");
  voice.resetRound();
  setControls();
}

/* Conteo: lo marcan tus golpes de puno, tu voz o el reloj */

const SOURCE_LABEL = { hand: "Ritmo: tu mano", voice: "Ritmo: tu voz", timer: "Ritmo: automático" };

function startRound(source, now = performance.now()) {
  if (!landmarker || !["idle", "result"].includes(game.state)) return;
  if (source !== "timer" && now < game.readyAt) return;
  game.state = "count";
  game.source = source;
  game.beat = 0;
  game.t0 = now;
  game.lastBeatAt = now;
  game.prior = predictor.predict();
  game.commit = game.shoot = game.confirm = null;
  voice.resetRound();
  el.countSource.textContent = SOURCE_LABEL[source];
  el.pips.forEach((p) => p.classList.remove("on"));
  showLayer("count");
  renderPrior();
  setControls();
  if (source !== "timer") advanceBeat(1, now);
}

function advanceBeat(index, now) {
  if (game.state !== "count" || index <= game.beat) return;
  if (index > COUNTDOWN.length) {
    enterShoot(now);
    return;
  }
  game.beat = index;
  game.lastBeatAt = now;
  el.countWord.textContent = COUNTDOWN[index - 1];
  el.countWord.classList.remove("go");
  restartAnimation(el.countWord, "pop");
  el.pips.forEach((p, i) => p.classList.toggle("on", i < index));
  sfx.tick();
  // Con mano o voz, el lanzamiento llega en el golpe que sigue a "tijera".
  if (index === COUNTDOWN.length && game.source !== "timer") enterShoot(now, true);
}

function enterShoot(now, keepWord = false) {
  game.state = "shoot";
  game.shoot = { at: now, moved: false, bottom: false, streak: null, streakFrames: 0, post: null };
  if (keepWord) {
    setTimeout(() => game.state === "shoot" && showGo(), 220);
  } else {
    showGo();
  }
}

function showGo() {
  el.countWord.textContent = "Ya!";
  el.countWord.classList.add("go");
  restartAnimation(el.countWord, "pop");
  sfx.go();
}

/* Decision de la maquina */

// La maquina se decide en cuanto la combinacion de historial y lectura de la mano
// es suficientemente segura, aunque el gesto todavia no este terminado.
function updateShoot(lm, gesture, beatHand, now) {
  const s = game.shoot;
  const elapsed = now - s.at;
  if (motion.speed > 2.5) s.moved = true;
  if (beatHand) s.bottom = true;

  if (lm) {
    const like = intent(extensions(lm), motion.settle);
    s.post = posterior(game.prior, like);
    const guess = best(s.post);

    // El puno ya esta cerrado mientras se agita: la piedra solo cuenta cuando la
    // mano termina el lanzamiento sin abrirse.
    const rockReady = s.bottom || (motion.still && elapsed > 250 && (s.moved || elapsed > 650));
    const usable = s.post[guess] >= COMMIT_CONFIDENCE && (guess !== ROCK || rockReady);

    if (usable && guess === s.streak) s.streakFrames += 1;
    else {
      s.streak = usable ? guess : null;
      s.streakFrames = usable ? 1 : 0;
    }
    if (s.streakFrames >= COMMIT_FRAMES) {
      commitMove(guess, s.post[guess], now);
      return;
    }
  }

  if (elapsed > SHOOT_TIMEOUT_MS) {
    showMiss("No vi tu jugada", "Pon la mano frente a la cámara y vuelve a intentarlo");
  }
}

function commitMove(predicted, confidence, now) {
  const cpu = BEATS[predicted];
  game.state = "confirm";
  game.commit = { predicted, cpu, confidence, at: now, sinceShoot: Math.round(now - game.shoot.at) };
  game.confirm = { run: null, runStart: 0, runFrames: 0, seen: null, seenFrames: 0, sawPredicted: false, last: null };

  setIcon(el.commitIcon, cpu);
  el.commitMove.textContent = LABELS[cpu];
  el.commitNote.textContent = `Predice ${LABELS[predicted].toLowerCase()} con ${Math.round(confidence * 100)}% de seguridad`;
  el.validateBar.style.width = "0%";
  showLayer("commit");
  sfx.commit();
}

/* Validacion de lo que realmente jugaste */

// Tras decidir, la maquina sigue mirando hasta que tu mano se queda quieta con un
// gesto fijo. El resultado se calcula con esa jugada, no con la prediccion.
function updateConfirm(gesture, now) {
  const c = game.confirm;
  const settled = gesture && motion.still ? gesture : null;

  if (settled && settled === c.run) c.runFrames += 1;
  else {
    c.run = settled;
    c.runStart = now;
    c.runFrames = settled ? 1 : 0;
  }

  if (gesture && gesture === c.seen) c.seenFrames += 1;
  else {
    c.seen = gesture;
    c.seenFrames = gesture ? 1 : 0;
  }
  if (c.seen === game.commit.predicted && c.seenFrames >= CHANGE_FRAMES) c.sawPredicted = true;
  if (c.runFrames >= CHANGE_FRAMES) c.last = { move: c.run, at: c.runStart };

  el.validateBar.style.width = `${Math.min(100, (c.runFrames / CONFIRM_FRAMES) * 100)}%`;

  if (c.runFrames >= CONFIRM_FRAMES) {
    finishRound(c.run, c.runStart, now);
  } else if (now - game.commit.at > CONFIRM_TIMEOUT_MS) {
    if (c.last) finishRound(c.last.move, c.last.at, now);
    else showMiss("Jugada sin validar", "Tu mano no se quedó quieta el tiempo suficiente. Ronda anulada.");
  }
}

function finishRound(final, completedAt, now) {
  const { predicted, cpu, confidence, at } = game.commit;
  const lead = Math.round(completedAt - at);

  // Si la jugada prevista se vio completa y luego cambio, fue un cambio tardio.
  if (final !== predicted && game.confirm.sawPredicted) {
    showMiss(
      "Cambiaste de jugada",
      `Mostraste ${LABELS[predicted].toLowerCase()} y luego ${LABELS[final].toLowerCase()} cuando la máquina ya había elegido. Ronda anulada.`
    );
    return;
  }

  const winner = outcome(final, cpu);
  game.state = "result";
  game.t0 = now;
  game.readyAt = now + REARM_MS;
  game.rounds += 1;
  game.predictions += 1;
  if (final === predicted) {
    game.hits += 1;
    game.leads.push(lead);
  }
  if (winner === "cpu") game.scoreCpu += 1;
  if (winner === "you") game.scoreYou += 1;
  predictor.record(final);
  saveHistory();

  el.resultCards.hidden = false;
  el.resYou.textContent = LABELS[final];
  el.resCpu.textContent = LABELS[cpu];
  setIcon(el.resYouIcon, final);
  setIcon(el.resCpuIcon, cpu);
  el.cardCpu.classList.toggle("winner", winner === "cpu");
  el.cardYou.classList.toggle("winner", winner === "you");
  el.verdict.textContent = { cpu: "Gana la máquina", you: "Ganaste", tie: "Empate" }[winner];
  el.verdict.dataset.winner = winner;

  if (final === predicted) {
    el.reaction.textContent =
      lead > 0
        ? `Predijo tu jugada ${lead} ms antes de que la terminaras`
        : `Reaccionó ${-lead} ms después de tu jugada`;
  } else {
    el.reaction.textContent = `Esperaba ${LABELS[predicted].toLowerCase()} y sacaste ${LABELS[final].toLowerCase()}`;
  }
  el.detail.textContent = `Seguridad ${Math.round(confidence * 100)}% · decidió a los ${game.commit.sinceShoot} ms del lanzamiento · validado con la mano quieta`;
  showLayer("result");

  el.scoreCpu.textContent = game.scoreCpu;
  el.scoreYou.textContent = game.scoreYou;
  el.round.textContent = `Ronda ${game.rounds}`;
  restartAnimation(winner === "you" ? el.scoreYou : el.scoreCpu, "bump");
  if (winner === "cpu") {
    restartAnimation(el.stage, "flash");
    restartAnimation(el.stage, "shake");
  }
  sfx[winner]();
  updateStats();
  addHistory(final, cpu, winner);
  renderPrior(predictor.predict());
  setControls();
}

function showMiss(title, text) {
  const now = performance.now();
  game.state = "result";
  game.t0 = now;
  game.readyAt = now + REARM_MS;
  el.resultCards.hidden = true;
  el.verdict.textContent = title;
  el.verdict.dataset.winner = "none";
  el.reaction.textContent = text;
  el.detail.textContent = "";
  showLayer("result");
  sfx.miss();
  setControls();
}

/* Paneles */

function updateStats() {
  const l = game.leads;
  el.statLead.textContent = l.length ? l[l.length - 1] : 0;
  el.statAvg.textContent = l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : 0;
  el.statAcc.textContent = game.predictions ? `${Math.round((game.hits / game.predictions) * 100)}%` : "0%";
}

function renderPrior(dist = game.prior ?? predictor.predict()) {
  for (const row of el.prior) {
    const p = dist[row.dataset.g];
    row.querySelector("i").style.width = `${p * 100}%`;
    row.querySelector("em").textContent = `${Math.round(p * 100)}%`;
  }
  const top = best(dist);
  const n = predictor.moves.length;
  el.priorText.textContent =
    n < 3
      ? "Aún no conozco tus patrones."
      : `Por tus ${n} jugadas, lo más probable es ${LABELS[top].toLowerCase()}.`;
}

function addHistory(player, cpu, winner) {
  el.history.querySelector(".empty")?.remove();
  const li = document.createElement("li");
  li.className = `w-${winner}`;
  li.title = `${LABELS[player]} contra ${LABELS[cpu]}`;
  li.innerHTML = `
    <svg class="h-you"><use href="#icon-${player}" /></svg>
    <span class="h-x">vs</span>
    <svg class="h-cpu"><use href="#icon-${cpu}" /></svg>`;
  el.history.prepend(li);
  while (el.history.children.length > HISTORY_MAX) el.history.lastElementChild.remove();
}

function resetScore() {
  Object.assign(game, { scoreCpu: 0, scoreYou: 0, rounds: 0, leads: [], predictions: 0, hits: 0 });
  el.scoreCpu.textContent = "0";
  el.scoreYou.textContent = "0";
  el.round.textContent = "Ronda 0";
  el.history.innerHTML = '<li class="empty">Aún no hay rondas</li>';
  updateStats();
}

function forgetHistory() {
  predictor.moves = [];
  saveHistory();
  renderPrior(predictor.predict());
}

function showLive(lm, gesture) {
  el.live.classList.toggle("on", Boolean(lm));
  el.liveText.textContent = gesture ? LABELS[gesture] : lm ? "Mano detectada" : "Buscando mano";

  // Fuera del lanzamiento la barra muestra solo lo que se ve; durante el
  // lanzamiento, la estimacion completa que usa la maquina para decidir.
  let dist = null;
  if (game.state === "shoot" && game.shoot?.post) dist = game.shoot.post;
  else if (lm) dist = posterior({ rock: 1, paper: 1, scissors: 1 }, intent(extensions(lm), motion.settle));
  for (const chip of el.chips) {
    const g = chip.dataset.g;
    chip.classList.toggle("active", chip.dataset.g === gesture);
    chip.style.setProperty("--p", dist ? dist[g].toFixed(3) : 0);
  }
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

function onFrame(lm, now) {
  const beatHand = motion.update(lm, now);
  const gesture = lm ? classify(lm) : null;

  switch (game.state) {
    case "idle":
    case "result":
      // Un golpe con el puno cerrado arranca la ronda, como al jugar en persona.
      if (beatHand && gesture === ROCK) startRound("hand", now);
      break;
    case "count":
      if (beatHand && game.source !== "timer") advanceBeat(game.beat + 1, now);
      break;
    case "shoot":
      updateShoot(lm, gesture, beatHand, now);
      break;
    case "confirm":
      updateConfirm(gesture, now);
      break;
  }

  drawHand(lm);
  showLive(lm, gesture);
}

function onTick(now) {
  if (game.state === "count") {
    if (game.source === "timer") {
      const step = Math.floor((now - game.t0) / STEP_MS) + 1;
      if (step > game.beat) advanceBeat(step, now);
    } else if (now - game.lastBeatAt > BEAT_TIMEOUT_MS) {
      goIdle("Perdí el ritmo. Otra vez");
    }
  } else if (game.state === "result" && now - game.t0 > RESULT_MS) {
    goIdle();
  }
}

function loop() {
  const now = performance.now();
  if (el.video.readyState >= 2 && el.video.currentTime !== lastVideoTime) {
    lastVideoTime = el.video.currentTime;
    countFrame(now);
    if (el.canvas.width !== el.video.videoWidth) {
      el.canvas.width = el.video.videoWidth;
      el.canvas.height = el.video.videoHeight;
    }
    const result = landmarker.detectForVideo(el.video, now);
    onFrame(result.landmarks?.[0] ?? null, now);
  }
  onTick(now);
  requestAnimationFrame(loop);
}

/* Voz */

const voice = new VoiceTrigger({
  onBeat(index) {
    const now = performance.now();
    if (game.state === "idle" || game.state === "result") {
      if (index === 1) startRound("voice", now);
    } else if (game.state === "count" && game.source !== "timer") {
      advanceBeat(index, now);
    }
  },
  onStart() {
    startRound("timer");
  },
  onHeard(text) {
    el.voiceHeard.textContent = text || "escuchando";
  },
  onState(state) {
    const on = state === "listening";
    el.voice.setAttribute("aria-pressed", String(on));
    el.voiceReadout.hidden = !on;
    if (state === "denied") showVoiceNote("Necesito permiso para usar el micrófono.");
    else if (state === "error") showVoiceNote("No se pudo iniciar el reconocimiento de voz.");
    else if (on) showVoiceNote("Di «piedra, papel, tijera» para jugar, o «jugar» para el conteo automático. El navegador procesa la voz con su servicio de reconocimiento.");
    else el.voiceNote.hidden = true;
  },
});

function showVoiceNote(text) {
  el.voiceNote.textContent = text;
  el.voiceNote.hidden = false;
}

function toggleVoice() {
  if (!landmarker || !voiceSupported) return;
  if (voice.enabled) voice.stop();
  else voice.start();
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
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
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
  el.live.hidden = false;
  goIdle();
  requestAnimationFrame(loop);
}

function toggleSound() {
  soundOn = !soundOn;
  el.sound.setAttribute("aria-pressed", String(soundOn));
}

if (!voiceSupported) {
  el.voice.title = "Tu navegador no tiene reconocimiento de voz. Prueba con Chrome o Edge.";
}
renderPrior();
updateStats();

el.camera.addEventListener("click", boot);
el.play.addEventListener("click", () => startRound("timer"));
el.voice.addEventListener("click", toggleVoice);
el.reset.addEventListener("click", resetScore);
el.forget.addEventListener("click", forgetHistory);
el.sound.addEventListener("click", toggleSound);

document.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "Space") {
    // Espacio sobre un boton enfocado ya dispara su click nativo.
    if (e.target.closest?.("button")) return;
    e.preventDefault();
    startRound("timer");
  } else if (e.code === "KeyV") toggleVoice();
  else if (e.code === "KeyR") resetScore();
  else if (e.code === "KeyM") toggleSound();
});
