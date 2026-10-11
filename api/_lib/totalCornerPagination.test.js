import test from "node:test";
import assert from "node:assert/strict";
import { schedulePageUrls, fetchTotalCornerDate } from "./totalCorner.js";

test("schedule pagination follows only same-source, same-date links", () => {
  const base = "https://www.totalcorner.com/pt/match/schedule/20261011";
  assert.deepEqual(schedulePageUrls(`[1](${base}/page%3A1) [2](${base}/page%3A2) [3](${base}?page=3) [out](https://example.com/) [old](https://www.totalcorner.com/pt/match/schedule/20261010/page%3A2) [other](${base}/other)`, "2026-10-11"), [base, `${base}/page%3A2`, `${base}?page=3`]);
});

test("untrusted or different-date result page URLs are rejected before fetching", async () => {
  await assert.rejects(fetchTotalCornerDate("2026-10-11", { pageUrl: "https://example.com/pt/match/schedule/20261011/p.2" }), /Pagina de resultados invalida/);
  await assert.rejects(fetchTotalCornerDate("2026-10-11", { pageUrl: "https://www.totalcorner.com/pt/match/schedule/20261010/p.2" }), /Pagina de resultados invalida/);
});

test("plain-text pagination labels retain later result pages when reader strips links", () => {
  const base = "https://www.totalcorner.com/pt/match/schedule/20261011";
  assert.deepEqual(schedulePageUrls("Match details\n1\n2\n3\n»\nTotalCorner\nPara usar nossos dados", "2026-10-11"), [base, `${base}/page%3A2`, `${base}/page%3A3`]);
});
