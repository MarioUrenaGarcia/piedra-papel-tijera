// Logica pura del juego, sin dependencias del navegador, para poder probarla aparte.

export const ROCK = "rock";
export const PAPER = "paper";
export const SCISSORS = "scissors";
export const MOVES = [ROCK, PAPER, SCISSORS];

export const LABELS = {
  [ROCK]: "Piedra",
  [PAPER]: "Papel",
  [SCISSORS]: "Tijera",
};

export const BEATS = {
  [ROCK]: PAPER,
  [PAPER]: SCISSORS,
  [SCISSORS]: ROCK,
};

export function outcome(player, cpu) {
  if (player === cpu) return "tie";
  return BEATS[player] === cpu ? "cpu" : "you";
}

/* Geometria de la mano */

// Indices de MediaPipe: [punta, articulacion media] de indice, medio, anular y menique.
const FINGERS = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18],
];
const WRIST = 0;
const MIDDLE_MCP = 9;

// La punta debe quedar al menos un 15% mas lejos de la muneca que la articulacion
// media para contar como estirada; asi un dedo medio doblado no cuenta.
const EXTEND_RATIO = 1.15;
// Rango del cociente punta/articulacion entre un dedo cerrado y uno estirado del todo.
const CLOSED_RATIO = 0.95;
const OPEN_RATIO = 1.4;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const sigmoid = (v) => 1 / (1 + Math.exp(-v));

export const palmSize = (lm) => dist(lm[WRIST], lm[MIDDLE_MCP]);

// Cociente de distancias a la muneca: no depende de que la mano este girada o de lado.
function ratios(lm) {
  const wrist = lm[WRIST];
  return FINGERS.map(([tip, pip]) => dist(lm[tip], wrist) / dist(lm[pip], wrist));
}

// Que tan estirado esta cada dedo, de 0 (cerrado) a 1 (estirado). Permite ver la
// mano a medio abrir, que es justo lo que se usa para anticipar el gesto.
export function extensions(lm) {
  return ratios(lm).map((r) => clamp01((r - CLOSED_RATIO) / (OPEN_RATIO - CLOSED_RATIO)));
}

// Gesto ya formado. El pulgar se ignora porque cada persona lo pone distinto y no
// cambia cual de los tres gestos es.
export function classify(lm) {
  const up = ratios(lm).map((r) => r > EXTEND_RATIO);
  const [index, middle, ring, pinky] = up;
  const count = up.filter(Boolean).length;

  if (count === 0) return ROCK;
  if (index && middle && !ring && !pinky) return SCISSORS;
  if (count >= 3) return PAPER;
  if (count === 1) return ROCK;
  return null;
}

/* Lectura temprana del gesto */

// Verosimilitud de cada jugada a partir de una mano que quiza todavia se esta
// abriendo. Indice y medio se abren en papel y en tijera; lo que las separa es si
// anular y menique acompanan. La piedra no se distingue por forma (el puno ya
// esta cerrado mientras se agita), solo porque la mano se detiene sin abrirse.
export function intent(ext, settle) {
  const front = (ext[0] + ext[1]) / 2;
  const back = (ext[2] + ext[3]) / 2;
  const opening = sigmoid((front - 0.3) * 12);
  const backOpen = sigmoid((back - 0.28) * 14);
  return {
    [PAPER]: opening * backOpen + 0.02,
    [SCISSORS]: opening * (1 - backOpen) + 0.02,
    [ROCK]: (1 - opening) * (1 - backOpen) * (0.15 + 0.85 * settle * settle) + 0.02,
  };
}

// Combina lo que se sabe de antes (historial) con lo que se ve ahora (camara).
export function posterior(prior, like, priorWeight = 0.6) {
  const raw = MOVES.map((m) => Math.pow(prior[m], priorWeight) * like[m]);
  const total = raw.reduce((a, b) => a + b, 0);
  return Object.fromEntries(MOVES.map((m, i) => [m, raw[i] / total]));
}

export const best = (dist) => MOVES.reduce((a, b) => (dist[b] > dist[a] ? b : a));

/* Movimiento de la mano */

// Sigue la muneca para saber que tan rapido se mueve y detectar cada golpe del
// puno al decir "piedra, papel, tijera". Todo se mide en tamanos de palma para que
// funcione igual cerca o lejos de la camara.
export class Motion {
  constructor({ amplitude = 0.45, hysteresis = 0.12, stillSpeed = 1.2 } = {}) {
    this.amplitude = amplitude;
    this.hysteresis = hysteresis;
    this.stillSpeed = stillSpeed;
    this.reset();
  }

  reset() {
    this.y = null;
    this.t = 0;
    this.speed = 0;
    this.dir = 0;
    this.top = null;
    this.bottom = null;
  }

  // Devuelve true cuando la mano acaba de tocar fondo en un golpe completo.
  update(lm, t) {
    if (!lm) {
      this.reset();
      return false;
    }
    const palm = palmSize(lm) || 0.1;
    const y = lm[WRIST].y / palm;
    if (this.y === null) {
      this.y = y;
      this.t = t;
      this.top = this.bottom = y;
      return false;
    }

    const dt = Math.max(1, t - this.t) / 1000;
    const smooth = this.y + (y - this.y) * 0.6;
    this.speed = this.speed * 0.5 + (Math.abs(smooth - this.y) / dt) * 0.5;
    this.y = smooth;
    this.t = t;

    // En la imagen la y crece hacia abajo: bajar es y creciente.
    let beat = false;
    if (this.dir >= 0) {
      if (smooth > this.bottom) this.bottom = smooth;
      if (this.bottom - smooth > this.hysteresis) {
        beat = this.bottom - this.top > this.amplitude;
        this.dir = -1;
        this.top = smooth;
      }
    } else {
      if (smooth < this.top) this.top = smooth;
      if (smooth - this.top > this.hysteresis) {
        this.dir = 1;
        this.bottom = smooth;
      }
    }
    return beat;
  }

  get still() {
    return this.speed < this.stillSpeed;
  }

  // 1 cuando la mano esta quieta, 0 cuando se mueve rapido.
  get settle() {
    return clamp01(1 - this.speed / (this.stillSpeed * 3));
  }
}

/* Prediccion por historial */

// Las personas no juegan al azar: repiten patrones. Se cuentan que jugadas siguen
// a la ultima y a las dos ultimas, y se mezclan con la frecuencia general.
export class HistoryPredictor {
  constructor(moves = []) {
    this.moves = moves.filter((m) => MOVES.includes(m)).slice(-200);
  }

  record(move) {
    this.moves.push(move);
    if (this.moves.length > 200) this.moves.shift();
  }

  countAfter(context) {
    const counts = { [ROCK]: 1, [PAPER]: 1, [SCISSORS]: 1 };
    const n = context.length;
    for (let i = n; i < this.moves.length; i++) {
      let match = true;
      for (let k = 0; k < n; k++) {
        if (this.moves[i - n + k] !== context[k]) match = false;
      }
      if (match) counts[this.moves[i]] += 1;
    }
    const total = counts[ROCK] + counts[PAPER] + counts[SCISSORS];
    return { dist: Object.fromEntries(MOVES.map((m) => [m, counts[m] / total])), samples: total - 3 };
  }

  predict() {
    const h = this.moves;
    const parts = [this.countAfter([])];
    if (h.length >= 1) parts.push(this.countAfter(h.slice(-1)));
    if (h.length >= 2) parts.push(this.countAfter(h.slice(-2)));

    // Cada contexto pesa segun cuantas veces se ha visto, para no fiarse de un solo dato.
    const mix = { [ROCK]: 0, [PAPER]: 0, [SCISSORS]: 0 };
    let weight = 0;
    parts.forEach((p, i) => {
      const w = (i + 1) * Math.min(1, p.samples / 4);
      for (const m of MOVES) mix[m] += p.dist[m] * w;
      weight += w;
    });
    if (weight === 0) return { [ROCK]: 1 / 3, [PAPER]: 1 / 3, [SCISSORS]: 1 / 3 };
    for (const m of MOVES) mix[m] /= weight;
    return mix;
  }
}
