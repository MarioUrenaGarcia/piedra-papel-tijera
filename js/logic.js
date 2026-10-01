// Logica pura del juego, sin dependencias del navegador, para poder probarla aparte.

export const ROCK = "rock";
export const PAPER = "paper";
export const SCISSORS = "scissors";

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

// Indices de MediaPipe: [punta, articulacion media] de indice, medio, anular y menique.
const FINGERS = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18],
];
const WRIST = 0;

// La punta debe quedar al menos un 15% mas lejos de la muneca que la articulacion
// media para contar como estirada; asi un dedo medio doblado no cuenta.
const EXTEND_RATIO = 1.15;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Se miden distancias a la muneca en lugar de comparar alturas para que la mano
// pueda estar girada o de lado. El pulgar se ignora porque cada persona lo pone
// distinto y no cambia cual de los tres gestos es.
export function classify(landmarks) {
  const wrist = landmarks[WRIST];
  const up = FINGERS.map(
    ([tip, pip]) => dist(landmarks[tip], wrist) > dist(landmarks[pip], wrist) * EXTEND_RATIO
  );
  const [index, middle, ring, pinky] = up;
  const count = up.filter(Boolean).length;

  if (count === 0) return ROCK;
  if (index && middle && !ring && !pinky) return SCISSORS;
  if (count >= 3) return PAPER;
  if (count === 1) return ROCK;
  return null;
}

// Confirma un gesto solo cuando se repite en varios cuadros seguidos, para no
// responder a la mano mientras todavia se esta formando.
export class StableGesture {
  constructor(frames) {
    this.frames = frames;
    this.buffer = [];
  }

  reset() {
    this.buffer = [];
  }

  push(gesture) {
    this.buffer.push(gesture);
    if (this.buffer.length > this.frames) this.buffer.shift();
    const first = this.buffer[0];
    const stable =
      this.buffer.length === this.frames && first !== null && this.buffer.every((g) => g === first);
    return stable ? first : null;
  }
}
