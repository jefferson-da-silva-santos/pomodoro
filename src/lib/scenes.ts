import type { Scene } from "./types";

/** Caminhos relativos: funcionam em http(s) e no protocolo de assets do Tauri. */
const MEDIA = "./media";

const photo = (n: number, title: string): Scene => {
  const id = `trilha-${String(n).padStart(2, "0")}`;
  return {
    id,
    kind: "photo",
    src: `${MEDIA}/fotos/${id}.webp`,
    thumb: `${MEDIA}/thumbs/${id}.webp`,
    title,
  };
};

const video = (n: number, title: string): Scene => {
  const id = `cachoeira-${n}`;
  return {
    id,
    kind: "video",
    src: `${MEDIA}/video/${id}.mp4`,
    poster: `${MEDIA}/video/${id}.webp`,
    thumb: `${MEDIA}/thumbs/${id}.webp`,
    title,
  };
};

/** Ordem pensada como uma caminhada: mata, subida, rio, queda e volta. */
export const SCENES: readonly Scene[] = [
  video(1, "Cachoeira ao vivo"),
  photo(15, "Mirante da queda"),
  photo(19, "Rio na mata"),
  photo(20, "Rio âmbar"),
  photo(13, "Bambuzal"),
  photo(5, "Subida na mata"),
  photo(7, "Luz entre as copas"),
  photo(6, "Trilha íngreme"),
  photo(2, "Folhagem"),
  photo(10, "Verde fechado"),
  photo(4, "Pedra e musgo"),
  photo(11, "Degraus de pedra"),
  photo(3, "No meio da trilha"),
  photo(9, "Clareira"),
  video(2, "Laje molhada ao vivo"),
  photo(14, "Corredeira"),
  photo(16, "Beira do rio"),
  photo(17, "Água branca"),
  photo(18, "Correnteza"),
  photo(25, "Chegada"),
  photo(1, "Queda d'água"),
  photo(12, "Pé da cachoeira"),
  photo(8, "Sob a queda"),
  video(3, "Embaixo da cachoeira ao vivo"),
  photo(24, "Laje de pedra"),
  photo(21, "Parada de apoio"),
  photo(22, "Descanso"),
  photo(23, "Fim de trilha"),
];

export const DEFAULT_SCENE_ID = "trilha-15";

export const findScene = (id: string): Scene =>
  SCENES.find((s) => s.id === id) ?? (SCENES[0] as Scene);

export const nextSceneId = (id: string): string => {
  const index = SCENES.findIndex((s) => s.id === id);
  return (SCENES[(index + 1) % SCENES.length] as Scene).id;
};
