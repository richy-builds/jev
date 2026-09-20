import raw from "@/data/steam-1245620.json";

/** One Steam review from scripts/build-steam.mjs. `voted_up` is Steam's thumbs-up: ground truth for the calibration panel. */
export interface Review {
  id: string;
  text: string;
  voted_up: boolean;
  hours: number;
}

export const STEAM_APPID = "1245620";
export const STEAM_GAME = "Elden Ring";
export const REVIEWS: Review[] = (raw as { reviews: Review[] }).reviews;
