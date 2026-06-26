import { over05 } from "./over05.js";
import { over15 } from "./over15.js";
import { over25 } from "./over25.js";
import { under25 } from "./under25.js";
import { corners } from "./corners.js";

export const markets = {
  over05,
  over15,
  over25,
  under25,
  corners
};

export function getMarketLabel(market) {
  return markets[market]?.label || market;
}
