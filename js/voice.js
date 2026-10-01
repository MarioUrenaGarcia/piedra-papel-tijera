// Reconocimiento de voz con la Web Speech API. Escucha las palabras del conteo y
// avisa cada vez que aparece una nueva, usando resultados parciales para no
// esperar a que termine la frase.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// Sin acentos ni mayusculas, para comparar sin importar como lo transcriba.
const normalize = (text) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

// Indice del conteo que representa cada palabra. "Un, dos, tres" es otra forma
// comun de contar en espanol.
const WORDS = [
  [/\bpiedras?\b|\buno?\b/, 1],
  [/\bpapel(es)?\b|\bdos\b/, 2],
  [/\btijeras?\b|\btres\b/, 3],
  [/\bya\b|\byah\b/, 4],
];
const START_WORDS = /\b(jugar|juega|juguemos|empezar|empieza|vamos|otra)\b/;

export const voiceSupported = Boolean(Recognition);

export class VoiceTrigger {
  constructor({ onBeat, onStart, onHeard, onState }) {
    this.onBeat = onBeat;
    this.onStart = onStart;
    this.onHeard = onHeard;
    this.onState = onState;
    this.enabled = false;
    this.fired = new Set();
    this.seen = new Map();
    this.rec = null;
  }

  // Permite que la siguiente ronda vuelva a usar las palabras. Lo ya transcrito no
  // se olvida, para no disparar de nuevo palabras de una frase anterior.
  resetRound() {
    this.fired.clear();
  }

  start() {
    if (!Recognition || this.enabled) return;
    this.enabled = true;
    this.resetRound();
    this.seen.clear();
    this.rec = new Recognition();
    this.rec.lang = navigator.language?.startsWith("es") ? navigator.language : "es-MX";
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.rec.maxAlternatives = 1;
    this.rec.onresult = (e) => this.handle(e);
    this.rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.stop();
        this.onState?.("denied");
      }
    };
    // El navegador corta la escucha tras un silencio; se reanuda mientras siga activa.
    this.rec.onend = () => {
      if (this.enabled) {
        // Una sesion nueva vuelve a numerar los resultados desde cero.
        this.seen.clear();
        try {
          this.rec.start();
        } catch {
          this.stop();
        }
      }
    };
    try {
      this.rec.start();
      this.onState?.("listening");
    } catch {
      this.stop();
      this.onState?.("error");
    }
  }

  stop() {
    this.enabled = false;
    if (this.rec) {
      this.rec.onend = null;
      try {
        this.rec.abort();
      } catch {
        // Ya estaba detenido.
      }
    }
    this.rec = null;
    this.onState?.("off");
  }

  handle(event) {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = normalize(event.results[i][0].transcript);
      this.onHeard?.(text.trim().split(/\s+/).slice(-3).join(" "));

      // Un mismo resultado parcial llega varias veces mientras crece; solo cuentan
      // las palabras que no se habian visto en ese resultado.
      const prev = this.seen.get(i) ?? 0;
      const found = [];
      for (const [pattern, index] of WORDS) {
        const g = new RegExp(pattern.source, "g");
        let m;
        while ((m = g.exec(text))) found.push({ index, at: m.index });
      }
      found.sort((a, b) => a.at - b.at);
      found.slice(prev).forEach(({ index }) => {
        const key = `${index}`;
        if (this.fired.has(key)) return;
        this.fired.add(key);
        this.onBeat?.(index);
      });
      this.seen.set(i, Math.max(prev, found.length));

      if (found.length === 0 && START_WORDS.test(text) && event.results[i].isFinal) this.onStart?.();
    }
  }
}
