/** Contratos de domínio compartilhados por toda a aplicação. */

export type Mode = "focus" | "short" | "long";
export type TimerStatus = "idle" | "running" | "paused";
export type PanelId = "tasks" | "journey" | "sound" | "scenes" | "settings";

export interface Settings {
  focusMin: number;
  shortMin: number;
  longMin: number;
  /** Quantos focos formam uma trilha completa antes da pausa longa. */
  cycles: number;
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  chime: boolean;
  chimeVolume: number;
  notify: boolean;
  /** "auto" troca a cena sozinho; "fixed" mantém a escolhida. */
  sceneMode: "auto" | "fixed";
  sceneId: string;
  /** Intervalo da troca automática de cena, em segundos. */
  sceneEverySec: number;
}

export interface TimerState {
  mode: Mode;
  status: TimerStatus;
  /** Epoch em ms do fim da sessão; a fonte da verdade enquanto roda. */
  endsAt: number | null;
  /** Tempo restante congelado quando pausado. */
  remainingMs: number | null;
  /** Focos concluídos na trilha atual (0..cycles). */
  cycle: number;
}

export interface DayStat {
  focusMs: number;
  sessions: number;
}

export type Stats = Record<string, DayStat>;

export interface Task {
  id: string;
  title: string;
  done: boolean;
  pomos: number;
}

export interface Scene {
  id: string;
  kind: "photo" | "video";
  src: string;
  thumb: string;
  poster?: string;
  title: string;
}

export interface Track {
  id: string;
  name: string;
  url: string;
  size: number;
  builtin: boolean;
}

export interface PlayerPrefs {
  volume: number;
  repeatOne: boolean;
  currentId: string;
  /** Pausa a música nas pausas e retoma no foco. */
  focusOnly: boolean;
}
