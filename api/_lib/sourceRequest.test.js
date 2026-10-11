import test from "node:test";
import assert from "node:assert/strict";
import { fetchSourceText } from "./sourceRequest.js";

test("retries a timeout and returns fresh source text", async () => {
  let calls = 0;
  const result = await fetchSourceText("https://example.com", {
    timeouts: [20000, 10000],
    fetchImpl: async (_url, options) => {
      assert.ok(options.signal);
      if (++calls === 1) throw new DOMException("timeout", "TimeoutError");
      return new Response("fresh games");
    }
  });
  assert.equal(result, "fresh games");
  assert.equal(calls, 2);
});

test("retries a temporary HTTP error", async () => {
  let calls = 0;
  const result = await fetchSourceText("https://example.com", {
    timeouts: [20000, 10000],
    fetchImpl: async () => ++calls === 1 ? new Response("", { status: 503 }) : new Response("games")
  });
  assert.equal(result, "games");
  assert.equal(calls, 2);
});

test("does not retry denied access", async () => {
  let calls = 0;
  await assert.rejects(fetchSourceText("https://example.com", {
    timeouts: [20000, 10000],
    fetchImpl: async () => { calls++; return new Response("", { status: 403 }); }
  }), /TotalCorner retornou 403/);
  assert.equal(calls, 1);
});

test("exhausted retries show a readable error instead of empty games", async () => {
  let calls = 0;
  await assert.rejects(fetchSourceText("https://example.com", {
    timeouts: [20000, 10000],
    fetchImpl: async () => { calls++; throw new DOMException("timeout", "TimeoutError"); }
  }), /demorou para responder/);
  assert.equal(calls, 2);
});

test("the timeout also covers reading the response body", async () => {
  let calls = 0;
  assert.equal(await fetchSourceText("https://example.com", {
    timeouts: [20000, 10000],
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? { ok: true, text: async () => { throw new DOMException("timeout", "AbortError"); } }
        : new Response("complete body");
    }
  }), "complete body");
  assert.equal(calls, 2);
});
