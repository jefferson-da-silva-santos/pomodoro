import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ChangeEvent, FormEvent, ReactNode } from "react";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import {
  ArrowCounterClockwise,
  ChartBar,
  Check,
  CornersIn,
  CornersOut,
  ListChecks,
  Minus,
  Mountains,
  MusicNotes,
  Pause,
  Play,
  Plus,
  Repeat,
  RepeatOnce,
  SkipForward,
  SlidersHorizontal,
  SpeakerHigh,
  SpeakerSlash,
  Target,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

import { listStoredTracks, removeTrack, saveTrack } from "./lib/audioStore";
import { playChime } from "./lib/chime";
import { DEFAULT_SCENE_ID, SCENES, findScene, nextSceneId } from "./lib/scenes";
import { dayKey, usePersistentState } from "./lib/storage";
import type {
  Mode,
  PanelId,
  PlayerPrefs,
  Scene,
  Settings,
  Stats,
  Task,
  TimerState,
  Track,
} from "./lib/types";

/* ────────────────────────────── Constantes ────────────────────────────── */

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const DEFAULT_SETTINGS: Settings = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  cycles: 4,
  autoStartBreaks: true,
  autoStartFocus: false,
  chime: true,
  chimeVolume: 0.6,
  notify: false,
  sceneMode: "auto",
  sceneId: DEFAULT_SCENE_ID,
  sceneEverySec: 90,
};

const INITIAL_TIMER: TimerState = {
  mode: "focus",
  status: "idle",
  endsAt: null,
  remainingMs: null,
  cycle: 0,
};

const DEFAULT_PREFS: PlayerPrefs = {
  volume: 0.6,
  repeatOne: false,
  currentId: "builtin-cachoeira",
  focusOnly: false,
};

const BUILTIN_TRACK: Track = {
  id: "builtin-cachoeira",
  name: "Cachoeira da trilha",
  url: "./media/ambiente-cachoeira.m4a",
  size: 0,
  builtin: true,
};

const MODE_LABEL: Record<Mode, string> = {
  focus: "Foco",
  short: "Pausa curta",
  long: "Pausa longa",
};

const MODE_LINE: Record<Mode, string> = {
  focus: "Um passo de cada vez. Só a trilha importa agora.",
  short: "Solte os ombros, beba água e olhe para longe.",
  long: "Você chegou na cachoeira. Descanse de verdade.",
};

const FINISH_MESSAGE: Record<Mode, string> = {
  focus: "Foco concluído. Hora de respirar.",
  short: "Pausa encerrada. De volta à trilha.",
  long: "Descanso completo. Nova trilha pela frente.",
};

const PANEL_TITLE: Record<PanelId, string> = {
  tasks: "Tarefas",
  journey: "Jornada",
  sound: "Som",
  scenes: "Cenas",
  settings: "Ajustes",
};

const PANEL_ICON: Record<PanelId, Icon> = {
  tasks: ListChecks,
  journey: ChartBar,
  sound: MusicNotes,
  scenes: Mountains,
  settings: SlidersHorizontal,
};

const PANEL_ORDER: readonly PanelId[] = ["tasks", "journey", "sound", "scenes", "settings"];

/* ────────────────────────────── Utilitários ───────────────────────────── */

const durationOf = (mode: Mode, s: Settings): number => {
  const minutes = mode === "focus" ? s.focusMin : mode === "short" ? s.shortMin : s.longMin;
  return minutes * 60_000;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const formatClock = (ms: number): string => {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

const formatMinutes = (ms: number): string => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
};

const formatSize = (bytes: number): string =>
  bytes < 1_048_576
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1_048_576).toFixed(1).replace(".", ",")} MB`;

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/* ─────────────────────────────── Hooks ────────────────────────────────── */

interface Pomodoro {
  timer: TimerState;
  totalMs: number;
  remainingMs: number;
  progress: number;
  toggle: () => void;
  reset: () => void;
  skip: () => void;
  selectMode: (mode: Mode) => void;
}

/**
 * Motor do pomodoro. O relógio é derivado de `endsAt` (timestamp absoluto),
 * então não acumula atraso com a aba em segundo plano e sobrevive a recarregar.
 */
function usePomodoro(settings: Settings, onFinish: (finished: Mode) => void): Pomodoro {
  const [timer, setTimer] = usePersistentState<TimerState>("timer", INITIAL_TIMER);
  const [, setSecond] = useState(0);
  const settingsRef = useRef(settings);
  const onFinishRef = useRef(onFinish);
  const handledRef = useRef<number | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
    onFinishRef.current = onFinish;
  });

  const advance = useCallback(
    (natural: boolean) => {
      setTimer((prev) => {
        const s = settingsRef.current;
        let cycle = prev.cycle;
        let mode: Mode;
        if (prev.mode === "focus") {
          if (natural) cycle += 1;
          mode = cycle >= s.cycles ? "long" : "short";
        } else {
          if (prev.mode === "long") cycle = 0;
          mode = "focus";
        }
        const auto = natural && (mode === "focus" ? s.autoStartFocus : s.autoStartBreaks);
        return {
          mode,
          cycle,
          status: auto ? "running" : "idle",
          endsAt: auto ? Date.now() + durationOf(mode, s) : null,
          remainingMs: null,
        };
      });
    },
    [setTimer],
  );

  useEffect(() => {
    if (timer.status !== "running" || timer.endsAt === null) return;
    const { endsAt, mode } = timer;
    const check = (): void => {
      const left = endsAt - Date.now();
      if (left > 0) {
        setSecond(Math.ceil(left / 1000));
        return;
      }
      if (handledRef.current === endsAt) return;
      handledRef.current = endsAt;
      onFinishRef.current(mode);
      advance(true);
    };
    check();
    const id = window.setInterval(check, 250);
    return () => window.clearInterval(id);
  }, [timer, advance]);

  const totalMs = durationOf(timer.mode, settings);
  const remainingMs =
    timer.status === "running" && timer.endsAt !== null
      ? clamp(timer.endsAt - Date.now(), 0, totalMs)
      : timer.status === "paused" && timer.remainingMs !== null
        ? Math.min(timer.remainingMs, totalMs)
        : totalMs;

  const toggle = useCallback(() => {
    setTimer((prev) => {
      const now = Date.now();
      if (prev.status === "running" && prev.endsAt !== null) {
        return {
          ...prev,
          status: "paused",
          endsAt: null,
          remainingMs: Math.max(0, prev.endsAt - now),
        };
      }
      const left = prev.remainingMs ?? durationOf(prev.mode, settingsRef.current);
      return { ...prev, status: "running", endsAt: now + left, remainingMs: null };
    });
  }, [setTimer]);

  const reset = useCallback(() => {
    setTimer((prev) => ({ ...prev, status: "idle", endsAt: null, remainingMs: null }));
  }, [setTimer]);

  const skip = useCallback(() => advance(false), [advance]);

  const selectMode = useCallback(
    (mode: Mode) => {
      setTimer((prev) => ({ ...prev, mode, status: "idle", endsAt: null, remainingMs: null }));
    },
    [setTimer],
  );

  return {
    timer,
    totalMs,
    remainingMs,
    progress: totalMs === 0 ? 0 : 1 - remainingMs / totalMs,
    toggle,
    reset,
    skip,
    selectMode,
  };
}

type LibraryState = "loading" | "ready" | "error";

interface AudioPlayer {
  tracks: Track[];
  current: Track;
  playing: boolean;
  prefs: PlayerPrefs;
  library: LibraryState;
  error: string | null;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  select: (id: string) => void;
  add: (files: FileList) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setVolume: (volume: number) => void;
  setRepeatOne: (value: boolean) => void;
  setFocusOnly: (value: boolean) => void;
}

/** Player de áudio de fundo: faixa embutida + arquivos enviados (mp4, m4a, mp3, wav, ogg). */
function useAudioPlayer(): AudioPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wantPlayRef = useRef(false);
  const [tracks, setTracks] = useState<Track[]>([BUILTIN_TRACK]);
  const [library, setLibrary] = useState<LibraryState>("loading");
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = usePersistentState<PlayerPrefs>("player", DEFAULT_PREFS);

  const current = tracks.find((t) => t.id === prefs.currentId) ?? BUILTIN_TRACK;
  const tracksRef = useRef(tracks);
  const currentIdRef = useRef(current.id);
  useEffect(() => {
    tracksRef.current = tracks;
    currentIdRef.current = current.id;
  });

  // Carrega a biblioteca salva e cria as URLs temporárias dos blobs.
  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    listStoredTracks()
      .then((stored) => {
        if (!alive) return;
        const loaded = stored.map<Track>((t) => {
          const url = URL.createObjectURL(t.blob);
          urls.push(url);
          return { id: t.id, name: t.name, url, size: t.size, builtin: false };
        });
        setTracks([BUILTIN_TRACK, ...loaded]);
        setLibrary("ready");
      })
      .catch(() => {
        if (alive) setLibrary("error");
      });
    return () => {
      alive = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  // Um único elemento <audio> para a vida inteira do app.
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;

    const onPlay = (): void => setPlaying(true);
    const onPause = (): void => setPlaying(false);
    const onError = (): void => {
      wantPlayRef.current = false;
      setPlaying(false);
      setError("Não foi possível tocar este arquivo. Tente outro formato.");
    };
    const onEnded = (): void => {
      const list = tracksRef.current;
      const index = list.findIndex((t) => t.id === currentIdRef.current);
      const next = list[(index + 1) % list.length];
      if (next) {
        wantPlayRef.current = true;
        setPrefs((p) => ({ ...p, currentId: next.id }));
      }
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.pause();
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("ended", onEnded);
      audioRef.current = null;
    };
  }, [setPrefs]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.src = current.url;
    setError(null);
    if (wantPlayRef.current) {
      audio.play().catch(() => setPlaying(false));
    }
  }, [current.url]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = clamp(prefs.volume, 0, 1);
  }, [prefs.volume]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.loop = prefs.repeatOne || tracks.length === 1;
  }, [prefs.repeatOne, tracks.length]);

  const play = useCallback(() => {
    wantPlayRef.current = true;
    setError(null);
    audioRef.current?.play().catch(() => {
      setError("O sistema bloqueou o áudio. Clique em tocar de novo.");
    });
  }, []);

  const pause = useCallback(() => {
    wantPlayRef.current = false;
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    if (audioRef.current?.paused === false) pause();
    else play();
  }, [pause, play]);

  const select = useCallback(
    (id: string) => {
      wantPlayRef.current = true;
      if (id === currentIdRef.current) {
        play();
        return;
      }
      setPrefs((p) => ({ ...p, currentId: id }));
    },
    [play, setPrefs],
  );

  const add = useCallback(async (files: FileList) => {
    const accepted = Array.from(files).filter(
      (f) => f.type.startsWith("audio/") || f.type.startsWith("video/") || /\.(mp4|m4a|mp3|wav|ogg|webm)$/i.test(f.name),
    );
    if (accepted.length === 0) {
      setError("Envie um arquivo de áudio ou vídeo (mp4, m4a, mp3, wav, ogg).");
      return;
    }
    try {
      const saved = await Promise.all(accepted.map(saveTrack));
      setTracks((list) => [
        ...list,
        ...saved.map<Track>((t) => ({
          id: t.id,
          name: t.name,
          url: URL.createObjectURL(t.blob),
          size: t.size,
          builtin: false,
        })),
      ]);
      setError(null);
    } catch {
      setError("Sem espaço para salvar este arquivo no dispositivo.");
    }
  }, []);

  const remove = useCallback(
    async (id: string) => {
      const target = tracksRef.current.find((t) => t.id === id);
      if (!target || target.builtin) return;
      await removeTrack(id).catch(() => undefined);
      if (currentIdRef.current === id) {
        setPrefs((p) => ({ ...p, currentId: BUILTIN_TRACK.id }));
      }
      setTracks((list) => list.filter((t) => t.id !== id));
      URL.revokeObjectURL(target.url);
    },
    [setPrefs],
  );

  const setVolume = useCallback(
    (volume: number) => setPrefs((p) => ({ ...p, volume })),
    [setPrefs],
  );
  const setRepeatOne = useCallback(
    (repeatOne: boolean) => setPrefs((p) => ({ ...p, repeatOne })),
    [setPrefs],
  );
  const setFocusOnly = useCallback(
    (focusOnly: boolean) => setPrefs((p) => ({ ...p, focusOnly })),
    [setPrefs],
  );

  return {
    tracks,
    current,
    playing,
    prefs,
    library,
    error,
    toggle,
    play,
    pause,
    select,
    add,
    remove,
    setVolume,
    setRepeatOne,
    setFocusOnly,
  };
}

/* ───────────────────────────── Primitivos de UI ───────────────────────── */

interface IconButtonProps {
  label: string;
  icon: Icon;
  onClick: () => void;
  active?: boolean;
  size?: "md" | "lg";
  weight?: "bold" | "fill";
}

function IconButton({ label, icon: Glyph, onClick, active = false, size = "md", weight = "bold" }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-btn icon-btn--${size}`}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      onClick={onClick}
    >
      <Glyph weight={weight} aria-hidden="true" />
    </button>
  );
}

interface SwitchProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

function Switch({ label, hint, checked, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span className="switch__text">
        <span className="switch__label">{label}</span>
        {hint ? <span className="switch__hint">{hint}</span> : null}
      </span>
      <span className="switch__track" aria-hidden="true">
        <span className="switch__thumb" />
      </span>
    </button>
  );
}

interface StepperProps {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function Stepper({ label, unit, value, min, max, onChange }: StepperProps) {
  const id = useId();
  const commit = (next: number): void => {
    if (Number.isFinite(next)) onChange(clamp(Math.round(next), min, max));
  };
  return (
    <div className="stepper">
      <label htmlFor={id} className="stepper__label">
        {label}
      </label>
      <div className="stepper__control">
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Diminuir ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => commit(value - 1)}
        >
          <Minus weight="bold" aria-hidden="true" />
        </button>
        <input
          id={id}
          className="stepper__input"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => commit(e.target.valueAsNumber)}
        />
        <button
          type="button"
          className="stepper__btn"
          aria-label={`Aumentar ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => commit(value + 1)}
        >
          <Plus weight="bold" aria-hidden="true" />
        </button>
      </div>
      <span className="stepper__unit">{unit}</span>
    </div>
  );
}

/* ───────────────────────────── Cenário de fundo ───────────────────────── */

function SceneMedia({ scene, className }: { scene: Scene; className: string }) {
  if (scene.kind === "video") {
    return (
      <video
        className={className}
        src={scene.src}
        poster={scene.poster}
        autoPlay
        muted
        loop
        playsInline
        aria-hidden="true"
      />
    );
  }
  return <img className={className} src={scene.src} alt="" decoding="async" draggable={false} />;
}

/** Fundo imersivo: a cena desfocada em tela cheia, névoa e grão. */
const Backdrop = memo(function Backdrop({ scene }: { scene: Scene }) {
  const motes = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        id: i,
        left: (i * 53 + 11) % 100,
        size: 2 + ((i * 7) % 5),
        delay: -((i * 37) % 26),
        duration: 20 + ((i * 11) % 16),
      })),
    [],
  );

  return (
    <div className="backdrop" aria-hidden="true">
      <AnimatePresence initial={false}>
        <motion.div
          key={scene.id}
          className="backdrop__layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.6, ease: "easeInOut" }}
        >
          <SceneMedia scene={scene} className="backdrop__media" />
        </motion.div>
      </AnimatePresence>
      <div className="backdrop__shade" />
      <div className="backdrop__motes">
        {motes.map((m) => (
          <span
            key={m.id}
            className="mote"
            style={{
              left: `${m.left}%`,
              width: m.size,
              height: m.size,
              animationDelay: `${m.delay}s`,
              animationDuration: `${m.duration}s`,
            }}
          />
        ))}
      </div>
      <div className="backdrop__grain" />
    </div>
  );
});

interface PhotoFrameProps {
  scene: Scene;
  onNext: () => void;
  onOpenScenes: () => void;
}

/**
 * Momento assinatura: a foto nítida em um quadro inclinado que reage ao ponteiro
 * e se revela de baixo para cima, como neblina subindo, a cada troca de cena.
 */
const PhotoFrame = memo(function PhotoFrame({ scene, onNext, onOpenScenes }: PhotoFrameProps) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 18 });
  const sy = useSpring(py, { stiffness: 60, damping: 18 });
  const rotateY = useTransform(sx, [-0.5, 0.5], [-7, 7]);
  const rotateX = useTransform(sy, [-0.5, 0.5], [5, -5]);
  const shiftX = useTransform(sx, [-0.5, 0.5], [10, -10]);
  const shiftY = useTransform(sy, [-0.5, 0.5], [8, -8]);

  useEffect(() => {
    if (reduce) return;
    const onMove = (e: PointerEvent): void => {
      if (e.pointerType !== "mouse") return;
      px.set(e.clientX / window.innerWidth - 0.5);
      py.set(e.clientY / window.innerHeight - 0.5);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [px, py, reduce]);

  return (
    <motion.figure
      className="frame"
      initial={reduce ? false : { opacity: 0, y: 40, rotate: 6 }}
      animate={{ opacity: 1, y: 0, rotate: 2.2 }}
      transition={{ duration: 1.1, ease: EASE_OUT, delay: 0.25 }}
    >
      <motion.div className="frame__tilt" style={reduce ? undefined : { rotateX, rotateY }}>
        <div className="frame__window">
          <AnimatePresence initial={false}>
            <motion.div
              key={scene.id}
              className="frame__slide"
              initial={reduce ? { opacity: 0 } : { clipPath: "inset(100% 0% 0% 0%)" }}
              animate={reduce ? { opacity: 1 } : { clipPath: "inset(0% 0% 0% 0%)" }}
              exit={{ opacity: 0.999 }}
              transition={{ duration: reduce ? 0.3 : 1.25, ease: EASE_OUT }}
            >
              <motion.div className="frame__parallax" style={reduce ? undefined : { x: shiftX, y: shiftY }}>
                <SceneMedia scene={scene} className="frame__media" />
              </motion.div>
            </motion.div>
          </AnimatePresence>
          <div className="frame__sheen" aria-hidden="true" />
        </div>
      </motion.div>
      <figcaption className="frame__caption">
        <button type="button" className="link-btn" onClick={onOpenScenes}>
          {scene.title}
        </button>
        <button type="button" className="link-btn link-btn--quiet" onClick={onNext}>
          Próxima cena
        </button>
      </figcaption>
    </motion.figure>
  );
});

/* ─────────────────────────────── Relógio ──────────────────────────────── */

function Digit({ char }: { char: string }) {
  const reduce = useReducedMotion();
  return (
    <span className="digit" aria-hidden="true">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={char}
          className="digit__glyph"
          initial={reduce ? { opacity: 0 } : { y: "38%", opacity: 0, filter: "blur(6px)" }}
          animate={{ y: "0%", opacity: 1, filter: "blur(0px)" }}
          exit={reduce ? { opacity: 0 } : { y: "-38%", opacity: 0, filter: "blur(6px)" }}
          transition={{ duration: 0.42, ease: EASE_OUT }}
        >
          {char}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Dígitos gigantes: cada algarismo rola de forma independente ao mudar. */
function Clock({ ms, running }: { ms: number; running: boolean }) {
  const text = formatClock(ms);
  return (
    <div className="clock" role="timer" aria-label={`Tempo restante: ${text}`} data-running={running}>
      {text.split("").map((char, index) =>
        char === ":" ? (
          <span key={`sep-${index}`} className="clock__sep" aria-hidden="true">
            :
          </span>
        ) : (
          <Digit key={`pos-${index}`} char={char} />
        ),
      )}
    </div>
  );
}

interface ModeSwitchProps {
  mode: Mode;
  onSelect: (mode: Mode) => void;
}

function ModeSwitch({ mode, onSelect }: ModeSwitchProps) {
  const modes: readonly Mode[] = ["focus", "short", "long"];
  return (
    <div className="modes glass" role="tablist" aria-label="Tipo de sessão">
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={mode === m}
          className="modes__tab"
          onClick={() => onSelect(m)}
        >
          {mode === m ? (
            <motion.span
              layoutId="mode-pill"
              className="modes__pill"
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
            />
          ) : null}
          <span className="modes__label">{MODE_LABEL[m]}</span>
        </button>
      ))}
    </div>
  );
}

/* ──────────────────────────── Progresso em trilha ─────────────────────── */

const TRAIL_PATH =
  "M12 54 C 60 18, 104 66, 160 44 S 248 10, 310 36 S 404 68, 468 34 S 548 14, 588 24";

interface Point {
  x: number;
  y: number;
}

interface TrailProps {
  cycles: number;
  cycle: number;
  mode: Mode;
  progress: number;
}

/** A sessão desenhada como percurso: cada foco é um marco, a pausa longa é a cachoeira. */
function Trail({ cycles, cycle, mode, progress }: TrailProps) {
  const pathRef = useRef<SVGPathElement | null>(null);
  const [length, setLength] = useState(0);
  const fraction = clamp((cycle + (mode === "focus" ? progress : 0)) / cycles, 0, 1);

  useLayoutEffect(() => {
    if (pathRef.current) setLength(pathRef.current.getTotalLength());
  }, []);

  const at = (f: number): Point => {
    const path = pathRef.current;
    if (!path || length === 0) return { x: 12, y: 54 };
    const p = path.getPointAtLength(length * f);
    return { x: p.x, y: p.y };
  };

  const marks = Array.from({ length: cycles }, (_, i) => (i + 1) / cycles);
  const walker = at(fraction);
  const left = Math.max(0, cycles - cycle);
  const caption =
    mode === "long"
      ? "Trilha completa. Você está na cachoeira."
      : left === 1
        ? "Falta 1 foco para a cachoeira"
        : `Faltam ${left} focos para a cachoeira`;

  return (
    <div className="trail">
      <svg
        className="trail__svg"
        viewBox="0 0 600 72"
        role="img"
        aria-label={`Foco ${Math.min(cycle + 1, cycles)} de ${cycles}. ${caption}.`}
      >
        <path className="trail__base" d={TRAIL_PATH} ref={pathRef} />
        <path
          className="trail__done"
          d={TRAIL_PATH}
          style={{
            strokeDasharray: length || 1,
            strokeDashoffset: (length || 1) * (1 - fraction),
          }}
        />
        {marks.map((f, i) => {
          const p = at(f);
          const reached = fraction >= f - 0.0005;
          const last = i === cycles - 1;
          return (
            <circle
              key={f}
              className={`trail__mark${reached ? " is-reached" : ""}${last ? " is-goal" : ""}`}
              cx={p.x}
              cy={p.y}
              r={last ? 7 : 4.5}
            />
          );
        })}
        <g className="trail__walker" style={{ transform: `translate(${walker.x}px, ${walker.y}px)` }}>
          <circle className="trail__halo" r="11" />
          <circle className="trail__dot" r="5" />
        </g>
      </svg>
      <p className="trail__caption">{caption}</p>
    </div>
  );
}

/* ─────────────────────────────── Painéis ──────────────────────────────── */

interface TasksPanelProps {
  tasks: Task[];
  activeId: string | null;
  onAdd: (title: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onActivate: (id: string | null) => void;
}

function TasksPanel({ tasks, activeId, onAdd, onToggle, onRemove, onActivate }: TasksPanelProps) {
  const [draft, setDraft] = useState("");
  const inputId = useId();

  const submit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    onAdd(title);
    setDraft("");
  };

  return (
    <div className="panel-body">
      <form className="field-row" onSubmit={submit}>
        <div className="field">
          <label htmlFor={inputId} className="field__label">
            Nova tarefa
          </label>
          <input
            id={inputId}
            className="field__input"
            value={draft}
            maxLength={120}
            autoComplete="off"
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn--solid" disabled={draft.trim().length === 0}>
          <Plus weight="bold" aria-hidden="true" />
          Adicionar
        </button>
      </form>

      {tasks.length === 0 ? (
        <div className="empty">
          <Target weight="duotone" aria-hidden="true" />
          <p className="empty__title">Nenhuma tarefa na mochila</p>
          <p className="empty__text">
            Escreva o que você vai fazer neste foco. Cada sessão concluída conta um ponto para a tarefa ativa.
          </p>
        </div>
      ) : (
        <motion.ul className="tasks" layout>
          <AnimatePresence initial={false}>
            {tasks.map((task) => {
              const active = task.id === activeId;
              return (
                <motion.li
                  key={task.id}
                  layout
                  className={`task${active ? " is-active" : ""}${task.done ? " is-done" : ""}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  transition={{ duration: 0.3, ease: EASE_OUT }}
                >
                  <button
                    type="button"
                    className="task__check"
                    role="checkbox"
                    aria-checked={task.done}
                    aria-label={`Concluir ${task.title}`}
                    onClick={() => onToggle(task.id)}
                  >
                    {task.done ? <Check weight="bold" aria-hidden="true" /> : null}
                  </button>
                  <div className="task__main">
                    <span className="task__title">{task.title}</span>
                    <span className="task__meta">
                      {task.pomos === 1 ? "1 foco" : `${task.pomos} focos`}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="chip-btn"
                    aria-pressed={active}
                    disabled={task.done}
                    onClick={() => onActivate(active ? null : task.id)}
                  >
                    {active ? "Em foco" : "Focar"}
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label={`Excluir ${task.title}`}
                    onClick={() => onRemove(task.id)}
                  >
                    <Trash weight="bold" aria-hidden="true" />
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </motion.ul>
      )}
    </div>
  );
}

function JourneyPanel({ stats }: { stats: Stats }) {
  const today = stats[dayKey()] ?? { focusMs: 0, sessions: 0 };

  const week = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("pt-BR", { weekday: "short" });
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - i));
      const stat = stats[dayKey(date)];
      return {
        key: dayKey(date),
        label: formatter.format(date).replace(".", ""),
        ms: stat?.focusMs ?? 0,
      };
    });
  }, [stats]);

  const streak = useMemo(() => {
    let count = 0;
    const cursor = new Date();
    if ((stats[dayKey(cursor)]?.sessions ?? 0) === 0) cursor.setDate(cursor.getDate() - 1);
    while ((stats[dayKey(cursor)]?.sessions ?? 0) > 0) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }, [stats]);

  const totals = useMemo(
    () =>
      Object.values(stats).reduce(
        (acc, day) => ({ ms: acc.ms + day.focusMs, sessions: acc.sessions + day.sessions }),
        { ms: 0, sessions: 0 },
      ),
    [stats],
  );

  const peak = Math.max(...week.map((d) => d.ms), 1);
  const empty = totals.sessions === 0;

  return (
    <div className="panel-body">
      <div className="tiles">
        <div className="tile tile--wide">
          <span className="tile__label">Foco hoje</span>
          <span className="tile__value">{formatMinutes(today.focusMs)}</span>
        </div>
        <div className="tile">
          <span className="tile__label">Sessões hoje</span>
          <span className="tile__value">{today.sessions}</span>
        </div>
        <div className="tile">
          <span className="tile__label">Dias seguidos</span>
          <span className="tile__value">{streak}</span>
        </div>
        <div className="tile tile--wide">
          <span className="tile__label">Total percorrido</span>
          <span className="tile__value">{formatMinutes(totals.ms)}</span>
        </div>
      </div>

      <section aria-labelledby="week-title">
        <h3 id="week-title" className="panel-subtitle">
          Últimos 7 dias
        </h3>
        {empty ? (
          <div className="empty">
            <Mountains weight="duotone" aria-hidden="true" />
            <p className="empty__title">A jornada começa no primeiro foco</p>
            <p className="empty__text">Conclua uma sessão e o seu histórico aparece aqui.</p>
          </div>
        ) : (
          <ol className="week">
            {week.map((day, i) => (
              <li key={day.key} className="week__day">
                <span className="week__value">{day.ms > 0 ? Math.round(day.ms / 60_000) : ""}</span>
                <motion.span
                  className="week__bar"
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: Math.max(day.ms / peak, day.ms > 0 ? 0.06 : 0.015) }}
                  transition={{ duration: 0.7, delay: i * 0.05, ease: EASE_OUT }}
                />
                <span className="week__label">{day.label}</span>
              </li>
            ))}
          </ol>
        )}
        {empty ? null : <p className="panel-note">Minutos de foco por dia.</p>}
      </section>
    </div>
  );
}

function SoundPanel({ player }: { player: AudioPlayer }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="panel-body">
      <button
        type="button"
        className={`dropzone${dragging ? " is-dragging" : ""}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length > 0) void player.add(e.dataTransfer.files);
        }}
      >
        <UploadSimple weight="bold" aria-hidden="true" />
        <span className="dropzone__title">Enviar áudio</span>
        <span className="dropzone__text">Solte aqui ou clique para escolher. Aceita mp4, m4a, mp3, wav e ogg.</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        multiple
        accept="audio/*,video/mp4,.mp4,.m4a,.mp3,.wav,.ogg"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) void player.add(e.target.files);
          e.target.value = "";
        }}
      />

      {player.error ? (
        <p className="alert" role="alert">
          {player.error}
        </p>
      ) : null}

      {player.library === "loading" ? (
        <ul className="tracks" aria-busy="true" aria-label="Carregando biblioteca">
          {[0, 1, 2].map((i) => (
            <li key={i} className="track track--skeleton" />
          ))}
        </ul>
      ) : (
        <ul className="tracks">
          {player.tracks.map((track) => {
            const active = track.id === player.current.id;
            return (
              <li key={track.id} className={`track${active ? " is-active" : ""}`}>
                <button
                  type="button"
                  className="track__play"
                  aria-label={active && player.playing ? `Pausar ${track.name}` : `Tocar ${track.name}`}
                  onClick={() => (active && player.playing ? player.pause() : player.select(track.id))}
                >
                  {active && player.playing ? (
                    <Pause weight="fill" aria-hidden="true" />
                  ) : (
                    <Play weight="fill" aria-hidden="true" />
                  )}
                </button>
                <div className="track__main">
                  <span className="track__name">{track.name}</span>
                  <span className="track__meta">
                    {track.builtin ? "Gravado na sua trilha" : formatSize(track.size)}
                  </span>
                </div>
                {active && player.playing ? (
                  <span className="eq" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : null}
                {track.builtin ? null : (
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label={`Remover ${track.name}`}
                    onClick={() => void player.remove(track.id)}
                  >
                    <Trash weight="bold" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {player.library === "error" ? (
        <p className="alert" role="alert">
          Não foi possível abrir a biblioteca salva. Os arquivos enviados valem só nesta sessão.
        </p>
      ) : null}

      <div className="group">
        <Switch
          label="Repetir a faixa atual"
          hint="Desligado, a lista toca em sequência."
          checked={player.prefs.repeatOne}
          onChange={player.setRepeatOne}
        />
        <Switch
          label="Tocar só durante o foco"
          hint="O som pausa nas pausas e volta com o cronômetro."
          checked={player.prefs.focusOnly}
          onChange={player.setFocusOnly}
        />
      </div>
    </div>
  );
}

interface ScenesPanelProps {
  settings: Settings;
  onPick: (id: string) => void;
  onAuto: (value: boolean) => void;
}

function ScenesPanel({ settings, onPick, onAuto }: ScenesPanelProps) {
  return (
    <div className="panel-body">
      <Switch
        label="Trocar de cena sozinho"
        hint="Uma nova paisagem de tempos em tempos."
        checked={settings.sceneMode === "auto"}
        onChange={onAuto}
      />
      <ul className="scenes">
        {SCENES.map((scene, i) => {
          const active = scene.id === settings.sceneId;
          return (
            <motion.li
              key={scene.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: Math.min(i * 0.025, 0.4), ease: EASE_OUT }}
            >
              <button
                type="button"
                className={`scene${active ? " is-active" : ""}`}
                aria-pressed={active}
                onClick={() => onPick(scene.id)}
              >
                <img src={scene.thumb} alt="" loading="lazy" decoding="async" />
                <span className="scene__title">
                  {scene.kind === "video" ? <Play weight="fill" aria-hidden="true" /> : null}
                  {scene.title}
                </span>
              </button>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

interface SettingsPanelProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onNotify: (value: boolean) => void;
  onResetAll: () => void;
}

function SettingsPanel({ settings, onChange, onNotify, onResetAll }: SettingsPanelProps) {
  const volumeId = useId();
  const sceneId = useId();
  return (
    <div className="panel-body">
      <section className="group" aria-labelledby="set-time">
        <h3 id="set-time" className="panel-subtitle">
          Tempos
        </h3>
        <div className="steppers">
          <Stepper label="Foco" unit="min" value={settings.focusMin} min={1} max={180} onChange={(v) => onChange({ focusMin: v })} />
          <Stepper label="Pausa curta" unit="min" value={settings.shortMin} min={1} max={60} onChange={(v) => onChange({ shortMin: v })} />
          <Stepper label="Pausa longa" unit="min" value={settings.longMin} min={1} max={90} onChange={(v) => onChange({ longMin: v })} />
          <Stepper label="Focos por trilha" unit="até a pausa longa" value={settings.cycles} min={2} max={8} onChange={(v) => onChange({ cycles: v })} />
        </div>
      </section>

      <section className="group" aria-labelledby="set-flow">
        <h3 id="set-flow" className="panel-subtitle">
          Ritmo
        </h3>
        <Switch
          label="Iniciar pausas automaticamente"
          checked={settings.autoStartBreaks}
          onChange={(v) => onChange({ autoStartBreaks: v })}
        />
        <Switch
          label="Iniciar focos automaticamente"
          checked={settings.autoStartFocus}
          onChange={(v) => onChange({ autoStartFocus: v })}
        />
      </section>

      <section className="group" aria-labelledby="set-alert">
        <h3 id="set-alert" className="panel-subtitle">
          Avisos
        </h3>
        <Switch label="Sino ao terminar" checked={settings.chime} onChange={(v) => onChange({ chime: v })} />
        <div className="field">
          <label htmlFor={volumeId} className="field__label">
            Volume do sino
          </label>
          <input
            id={volumeId}
            className="range"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.chimeVolume}
            disabled={!settings.chime}
            style={{ "--fill": `${settings.chimeVolume * 100}%` } as CSSProperties}
            onChange={(e) => onChange({ chimeVolume: e.target.valueAsNumber })}
            onPointerUp={() => playChime(settings.chimeVolume, "break-end")}
          />
        </div>
        <Switch
          label="Notificação do sistema"
          hint="Avisa mesmo com a janela minimizada."
          checked={settings.notify}
          onChange={onNotify}
        />
      </section>

      <section className="group" aria-labelledby="set-scene">
        <h3 id="set-scene" className="panel-subtitle">
          Cenário
        </h3>
        <div className="field">
          <label htmlFor={sceneId} className="field__label">
            Trocar de cena a cada {settings.sceneEverySec} segundos
          </label>
          <input
            id={sceneId}
            className="range"
            type="range"
            min={30}
            max={600}
            step={30}
            value={settings.sceneEverySec}
            disabled={settings.sceneMode !== "auto"}
            style={{ "--fill": `${((settings.sceneEverySec - 30) / 570) * 100}%` } as CSSProperties}
            onChange={(e) => onChange({ sceneEverySec: e.target.valueAsNumber })}
          />
        </div>
      </section>

      <button type="button" className="btn btn--ghost btn--danger" onClick={onResetAll}>
        <ArrowCounterClockwise weight="bold" aria-hidden="true" />
        Restaurar ajustes padrão
      </button>
    </div>
  );
}

interface DrawerProps {
  panel: PanelId;
  onSelect: (panel: PanelId) => void;
  onClose: () => void;
  children: ReactNode;
}

/** Gaveta lateral em vidro com abas; fecha com Esc e devolve o foco. */
function Drawer({ panel, onSelect, onClose, children }: DrawerProps) {
  const ref = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <>
      <motion.div
        className="scrim"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      />
      <motion.aside
        ref={ref}
        className="drawer glass"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={{ x: "104%" }}
        animate={{ x: "0%" }}
        exit={{ x: "104%" }}
        transition={{ type: "spring", stiffness: 260, damping: 32 }}
      >
        <header className="drawer__head">
          <h2 id={titleId} className="drawer__title">
            {PANEL_TITLE[panel]}
          </h2>
          <IconButton label="Fechar painel" icon={X} onClick={onClose} />
        </header>
        <nav className="drawer__tabs" aria-label="Painéis">
          {PANEL_ORDER.map((id) => {
            const Glyph = PANEL_ICON[id];
            return (
              <button
                key={id}
                type="button"
                className="drawer__tab"
                title={PANEL_TITLE[id]}
                aria-current={panel === id ? "page" : undefined}
                onClick={() => onSelect(id)}
              >
                <Glyph weight={panel === id ? "fill" : "bold"} aria-hidden="true" />
                <span>{PANEL_TITLE[id]}</span>
              </button>
            );
          })}
        </nav>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={panel}
            className="drawer__content"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: EASE_OUT }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </motion.aside>
    </>
  );
}

/* ───────────────────────────── Dock de áudio ──────────────────────────── */

function AudioDock({ player, onOpen }: { player: AudioPlayer; onOpen: () => void }) {
  const volumeId = useId();
  const muted = player.prefs.volume === 0;
  const lastVolume = useRef(player.prefs.volume || 0.6);

  const toggleMute = (): void => {
    if (muted) player.setVolume(lastVolume.current);
    else {
      lastVolume.current = player.prefs.volume;
      player.setVolume(0);
    }
  };

  return (
    <div className="dock glass" role="group" aria-label="Som ambiente">
      <button
        type="button"
        className="dock__play"
        aria-label={player.playing ? "Pausar som" : "Tocar som"}
        onClick={player.toggle}
      >
        {player.playing ? <Pause weight="fill" aria-hidden="true" /> : <Play weight="fill" aria-hidden="true" />}
      </button>
      <button type="button" className="dock__track" onClick={onOpen} title="Abrir biblioteca de som">
        <span className="dock__name">{player.current.name}</span>
        <span className="dock__meta">{player.playing ? "Tocando" : "Som ambiente"}</span>
      </button>
      {player.playing ? (
        <span className="eq" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : null}
      <div className="dock__volume">
        <IconButton
          label={muted ? "Ativar som" : "Silenciar"}
          icon={muted ? SpeakerSlash : SpeakerHigh}
          onClick={toggleMute}
        />
        <label htmlFor={volumeId} className="sr-only">
          Volume
        </label>
        <input
          id={volumeId}
          className="range range--dock"
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={player.prefs.volume}
          style={{ "--fill": `${player.prefs.volume * 100}%` } as CSSProperties}
          onChange={(e) => player.setVolume(e.target.valueAsNumber)}
        />
      </div>
      <IconButton
        label={player.prefs.repeatOne ? "Repetindo a faixa" : "Tocando em sequência"}
        icon={player.prefs.repeatOne ? RepeatOnce : Repeat}
        active={player.prefs.repeatOne}
        onClick={() => player.setRepeatOne(!player.prefs.repeatOne)}
      />
    </div>
  );
}

/* ─────────────────────────────── Aplicação ────────────────────────────── */

export default function App() {
  const [settings, setSettings] = usePersistentState<Settings>("settings", DEFAULT_SETTINGS);
  const [stats, setStats] = usePersistentState<Stats>("stats", {});
  const [tasks, setTasks] = usePersistentState<Task[]>("tasks", []);
  const [activeTaskId, setActiveTaskId] = usePersistentState<string | null>("active-task", null);
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const player = useAudioPlayer();

  const patchSettings = useCallback(
    (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })),
    [setSettings],
  );

  /* Fim natural de uma sessão: contabiliza, toca o sino e avisa. */
  const handleFinish = useCallback(
    (finished: Mode) => {
      if (finished === "focus") {
        const key = dayKey();
        setStats((prev) => {
          const day = prev[key] ?? { focusMs: 0, sessions: 0 };
          return {
            ...prev,
            [key]: {
              focusMs: day.focusMs + settings.focusMin * 60_000,
              sessions: day.sessions + 1,
            },
          };
        });
        if (activeTaskId) {
          setTasks((list) =>
            list.map((t) => (t.id === activeTaskId ? { ...t, pomos: t.pomos + 1 } : t)),
          );
        }
      }
      if (settings.chime) {
        playChime(settings.chimeVolume, finished === "focus" ? "focus-end" : "break-end");
      }
      if (settings.notify && "Notification" in window && Notification.permission === "granted") {
        new Notification("Trilha", { body: FINISH_MESSAGE[finished], silent: true });
      }
      setToast(FINISH_MESSAGE[finished]);
    },
    [activeTaskId, setStats, setTasks, settings.chime, settings.chimeVolume, settings.focusMin, settings.notify],
  );

  const pomodoro = usePomodoro(settings, handleFinish);
  const { timer, remainingMs, progress } = pomodoro;
  const running = timer.status === "running";
  const scene = findScene(settings.sceneId);
  const activeTask = tasks.find((t) => t.id === activeTaskId && !t.done) ?? null;

  /* Aviso temporário. */
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 5200);
    return () => window.clearTimeout(id);
  }, [toast]);

  /* O título da janela acompanha o relógio (útil na barra de tarefas). */
  const clockText = formatClock(remainingMs);
  useEffect(() => {
    document.title = timer.status === "idle" ? "Trilha" : `${clockText} · ${MODE_LABEL[timer.mode]}`;
  }, [clockText, timer.mode, timer.status]);

  /* Troca automática de cena. */
  useEffect(() => {
    if (settings.sceneMode !== "auto") return;
    const id = window.setInterval(
      () => {
        if (document.hidden) return;
        setSettings((s) => ({ ...s, sceneId: nextSceneId(s.sceneId) }));
      },
      Math.max(15, settings.sceneEverySec) * 1000,
    );
    return () => window.clearInterval(id);
  }, [settings.sceneMode, settings.sceneEverySec, setSettings]);

  /* "Tocar só durante o foco": o som acompanha o cronômetro. */
  const focusRunning = running && timer.mode === "focus";
  const resumeRef = useRef(false);
  const { focusOnly } = player.prefs;
  const { playing, play: playAudio, pause: pauseAudio } = player;
  useEffect(() => {
    if (!focusOnly) {
      resumeRef.current = false;
      return;
    }
    if (focusRunning && resumeRef.current) {
      resumeRef.current = false;
      playAudio();
    } else if (!focusRunning && playing) {
      resumeRef.current = true;
      pauseAudio();
    }
    // `playing` fica fora de propósito: só reagimos à mudança do cronômetro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusOnly, focusRunning, playAudio, pauseAudio]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /* Atalhos de teclado. */
  const { toggle, reset, skip } = pomodoro;
  const togglePlayer = player.toggle;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const onButton = e.target instanceof HTMLElement && e.target.closest("button, a, [role='tab']");
      switch (e.key.toLowerCase()) {
        case " ":
          if (onButton) return;
          e.preventDefault();
          toggle();
          break;
        case "r":
          reset();
          break;
        case "n":
          skip();
          break;
        case "m":
          togglePlayer();
          break;
        case "f":
          toggleFullscreen();
          break;
        default:
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, reset, skip, togglePlayer, toggleFullscreen]);

  /* Ações de cena e tarefas. */
  const nextScene = useCallback(
    () => setSettings((s) => ({ ...s, sceneId: nextSceneId(s.sceneId) })),
    [setSettings],
  );
  const openScenes = useCallback(() => setPanel("scenes"), []);
  const closePanel = useCallback(() => setPanel(null), []);

  const addTask = useCallback(
    (title: string) => {
      const task: Task = { id: crypto.randomUUID(), title, done: false, pomos: 0 };
      setTasks((list) => [...list, task]);
      setActiveTaskId((current) => current ?? task.id);
    },
    [setTasks, setActiveTaskId],
  );

  const toggleTask = useCallback(
    (id: string) => setTasks((list) => list.map((t) => (t.id === id ? { ...t, done: !t.done } : t))),
    [setTasks],
  );

  const removeTaskById = useCallback(
    (id: string) => {
      setTasks((list) => list.filter((t) => t.id !== id));
      setActiveTaskId((current) => (current === id ? null : current));
    },
    [setTasks, setActiveTaskId],
  );

  const setNotify = useCallback(
    (value: boolean) => {
      if (!value) {
        patchSettings({ notify: false });
        return;
      }
      if (!("Notification" in window)) {
        setToast("Este sistema não oferece notificações.");
        return;
      }
      void Notification.requestPermission().then((permission) => {
        if (permission === "granted") patchSettings({ notify: true });
        else setToast("Permissão de notificação negada pelo sistema.");
      });
    },
    [patchSettings],
  );

  const primaryLabel = running ? "Pausar" : timer.status === "paused" ? "Continuar" : "Iniciar";

  return (
    <MotionConfig reducedMotion="user">
      <div className="app" data-mode={timer.mode} data-running={running}>
        <Backdrop scene={scene} />

        <header className="topbar">
          <motion.div
            className="brand"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE_OUT }}
          >
            <svg className="brand__mark" viewBox="0 0 64 64" aria-hidden="true">
              <path d="M10 48c10-2 10-15 20-16s9-14 24-15" />
              <circle cx="54" cy="17" r="5" />
            </svg>
            <span className="brand__name">Trilha</span>
          </motion.div>

          <motion.nav
            className="nav glass"
            aria-label="Painéis"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.08, ease: EASE_OUT }}
          >
            {PANEL_ORDER.map((id) => (
              <IconButton
                key={id}
                label={PANEL_TITLE[id]}
                icon={PANEL_ICON[id]}
                active={panel === id}
                onClick={() => setPanel(id)}
              />
            ))}
            <span className="nav__divider" aria-hidden="true" />
            <IconButton
              label={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
              icon={fullscreen ? CornersIn : CornersOut}
              onClick={toggleFullscreen}
            />
          </motion.nav>
        </header>

        <main className="stage">
          <section className="hero" aria-label="Cronômetro">
            <motion.div
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1, ease: EASE_OUT }}
            >
              <ModeSwitch mode={timer.mode} onSelect={pomodoro.selectMode} />
            </motion.div>

            <motion.div
              className="hero__clock"
              initial={{ opacity: 0, y: 36 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.18, ease: EASE_OUT }}
            >
              <Clock ms={remainingMs} running={running} />
            </motion.div>

            <motion.div
              className="hero__line"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3, ease: EASE_OUT }}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={activeTask && timer.mode === "focus" ? activeTask.id : timer.mode}
                  className="hero__text"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.35, ease: EASE_OUT }}
                >
                  {activeTask && timer.mode === "focus" ? (
                    <>
                      <span className="hero__now">Agora</span>
                      {activeTask.title}
                    </>
                  ) : (
                    MODE_LINE[timer.mode]
                  )}
                </motion.p>
              </AnimatePresence>
            </motion.div>

            <motion.div
              className="controls"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.38, ease: EASE_OUT }}
            >
              <button type="button" className="btn btn--primary" onClick={toggle}>
                {running ? <Pause weight="fill" aria-hidden="true" /> : <Play weight="fill" aria-hidden="true" />}
                <span>{primaryLabel}</span>
                <kbd className="btn__kbd" aria-hidden="true">
                  espaço
                </kbd>
              </button>
              <IconButton label="Reiniciar sessão (R)" icon={ArrowCounterClockwise} size="lg" onClick={reset} />
              <IconButton label="Pular para a próxima (N)" icon={SkipForward} size="lg" weight="fill" onClick={skip} />
            </motion.div>

            <motion.div
              className="hero__trail"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.46, ease: EASE_OUT }}
            >
              <Trail cycles={settings.cycles} cycle={timer.cycle} mode={timer.mode} progress={progress} />
            </motion.div>
          </section>

          <PhotoFrame scene={scene} onNext={nextScene} onOpenScenes={openScenes} />
        </main>

        <motion.footer
          className="bottom"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.55, ease: EASE_OUT }}
        >
          <AudioDock player={player} onOpen={() => setPanel("sound")} />
          <ul className="keys" aria-label="Atalhos de teclado">
            <li>
              <kbd>R</kbd> reiniciar
            </li>
            <li>
              <kbd>N</kbd> pular
            </li>
            <li>
              <kbd>M</kbd> som
            </li>
            <li>
              <kbd>F</kbd> tela cheia
            </li>
          </ul>
        </motion.footer>

        <div className="toast-region" role="status" aria-live="polite">
          <AnimatePresence>
            {toast ? (
              <motion.div
                key={toast}
                className="toast glass"
                initial={{ opacity: 0, y: -18, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.45, ease: EASE_OUT }}
              >
                {toast}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {panel ? (
            <Drawer key="drawer" panel={panel} onSelect={setPanel} onClose={closePanel}>
              {panel === "tasks" ? (
                <TasksPanel
                  tasks={tasks}
                  activeId={activeTaskId}
                  onAdd={addTask}
                  onToggle={toggleTask}
                  onRemove={removeTaskById}
                  onActivate={setActiveTaskId}
                />
              ) : null}
              {panel === "journey" ? <JourneyPanel stats={stats} /> : null}
              {panel === "sound" ? <SoundPanel player={player} /> : null}
              {panel === "scenes" ? (
                <ScenesPanel
                  settings={settings}
                  onPick={(id) => patchSettings({ sceneId: id, sceneMode: "fixed" })}
                  onAuto={(value) => patchSettings({ sceneMode: value ? "auto" : "fixed" })}
                />
              ) : null}
              {panel === "settings" ? (
                <SettingsPanel
                  settings={settings}
                  onChange={patchSettings}
                  onNotify={setNotify}
                  onResetAll={() => setSettings({ ...DEFAULT_SETTINGS, sceneId: settings.sceneId })}
                />
              ) : null}
            </Drawer>
          ) : null}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
