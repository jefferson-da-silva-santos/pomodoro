/** Sino sintetizado com Web Audio: nenhum arquivo extra, timbre de tigela. */

let context: AudioContext | null = null;

const strike = (ctx: AudioContext, frequency: number, at: number, volume: number): void => {
  const partials: ReadonlyArray<readonly [number, number]> = [
    [1, 1],
    [2.76, 0.35],
    [5.4, 0.12],
  ];
  for (const [ratio, gainRatio] of partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency * ratio;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * gainRatio), at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 2.4 / ratio);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 2.6);
  }
};

export function playChime(volume: number, kind: "focus-end" | "break-end"): void {
  try {
    context ??= new AudioContext();
    const ctx = context;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime + 0.02;
    const notes = kind === "focus-end" ? [528, 660, 792] : [660, 528];
    notes.forEach((note, i) => strike(ctx, note, now + i * 0.32, volume * 0.5));
  } catch {
    /* sem dispositivo de áudio: o aviso visual continua valendo */
  }
}
