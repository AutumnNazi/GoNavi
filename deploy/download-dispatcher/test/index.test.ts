import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  isReadyHealthPayload,
  isRoutingStateFresh,
  nextNodeHealth,
  orderedNodeIds,
  refreshChannel,
  selectLegacyRedirectCandidate,
} from "../src/core";

describe("download dispatcher", () => {
  it("uses China and global preferences without exposing a node selector", () => {
    expect(orderedNodeIds("CN")).toEqual(["tencent", "dmit"]);
    expect(orderedNodeIds("US")).toEqual(["dmit", "tencent"]);
    expect(orderedNodeIds(undefined)).toEqual(["dmit", "tencent"]);
  });

  it("keeps legacy 302 downloads on healthy DMIT before the slower Tencent edge", () => {
    const candidates = [
      { source: "tencent", url: "https://43.139.148.5/asset" },
      { source: "dmit", url: "https://download.syngnat.top/asset" },
      { source: "github", url: "https://github.com/example/asset" },
    ];
    expect(selectLegacyRedirectCandidate(candidates).source).toBe("dmit");
    expect(selectLegacyRedirectCandidate(candidates.filter((candidate) => candidate.source !== "dmit")).source).toBe("tencent");
  });

  it("opens after two successes and closes after three failures", () => {
    const generation = "stable-v1";
    let state = nextNodeHealth(undefined, generation, { ok: true, detail: "ok" }, "t1");
    expect(state.healthy).toBe(false);
    state = nextNodeHealth(state, generation, { ok: true, detail: "ok" }, "t2");
    expect(state.healthy).toBe(true);

    state = nextNodeHealth(state, generation, { ok: false, detail: "timeout" }, "t3");
    state = nextNodeHealth(state, generation, { ok: false, detail: "timeout" }, "t4");
    expect(state.healthy).toBe(true);
    state = nextNodeHealth(state, generation, { ok: false, detail: "timeout" }, "t5");
    expect(state.healthy).toBe(false);
  });

  it("immediately isolates health from an older generation", () => {
    const oldState = {
      generation: "stable-old",
      healthy: true,
      consecutiveFailures: 0,
      consecutiveSuccesses: 9,
      checkedAt: "old",
      detail: "ok",
    };
    const next = nextNodeHealth(oldState, "stable-new", { ok: true, detail: "ok" }, "new");
    expect(next.healthy).toBe(false);
    expect(next.consecutiveSuccesses).toBe(1);
  });

  it("stops routing to stale health state", () => {
    const now = Date.parse("2026-08-12T12:00:00Z");
    expect(isRoutingStateFresh("2026-08-12T11:48:01Z", now)).toBe(true);
    expect(isRoutingStateFresh("2026-08-12T11:47:59Z", now)).toBe(false);
    expect(isRoutingStateFresh("invalid", now)).toBe(false);
  });

  it("requires ready=true and the exact channel generation", () => {
    expect(isReadyHealthPayload({
      status: "bootstrap",
      ready: false,
      channels: {},
    }, "stable", "stable-1")).toBe(false);
    expect(isReadyHealthPayload({
      status: "ok",
      ready: true,
      channels: { stable: { generation: "stable-old" } },
    }, "stable", "stable-1")).toBe(false);
    expect(isReadyHealthPayload({
      status: "ok",
      ready: true,
      channels: { stable: { generation: "stable-1" } },
    }, "stable", "stable-1")).toBe(true);
  });

  it("reads publication control from the routing KV namespace", async () => {
    await env.ROUTING_STATE.delete("control:stable");
    await expect(refreshChannel(env, "stable")).rejects.toThrow(
      "publication control is missing for stable",
    );
  });

  it("redirects to GitHub when no healthy edge is available", async () => {
    await env.ROUTING_STATE.delete("routing:stable");
    const response = await SELF.fetch(
      "https://download-dispatch.syngnat.top/v1/resolve?path=/gonavi/releases/download/v1.2.3/GoNavi.zip",
      { redirect: "manual" },
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "https://github.com/Syngnat/GoNavi/releases/download/v1.2.3/GoNavi.zip",
    );
  });

  it("returns ordered fallback candidates in JSON without proxying the file", async () => {
    await env.ROUTING_STATE.delete("routing:stable");
    const response = await SELF.fetch(
      "https://download-dispatch.syngnat.top/v1/resolve?format=json&path=/gonavi/releases/download/v1.2.3/GoNavi.zip",
    );
    const body = await response.json<{ candidates: Array<{ source: string; url: string }> }>();
    expect(response.status).toBe(200);
    expect(body.candidates.map((candidate) => candidate.source)).toEqual(["github"]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("dispatches mutable app and driver pointers through the GitHub fallback", async () => {
    await env.ROUTING_STATE.delete("routing:stable");
    for (const [path, githubSuffix] of [
      ["/gonavi/releases/latest/latest.json", "/Syngnat/GoNavi/releases/latest/download/latest.json"],
      ["/drivers/releases/latest/GoNavi-DriverAgents-Index.json", "/Syngnat/GoNavi-DriverAgents/releases/latest/download/GoNavi-DriverAgents-Index.json"],
    ]) {
      const response = await SELF.fetch(
        `https://download-dispatch.syngnat.top/v1/resolve?format=json&path=${encodeURIComponent(path)}`,
      );
      const body = await response.json<{ candidates: Array<{ source: string; url: string }> }>();
      expect(response.status).toBe(200);
      expect(body.candidates.map((candidate) => candidate.source)).toEqual(["github"]);
      expect(new URL(body.candidates[0].url).pathname).toBe(githubSuffix);
    }
  });

  it("rejects paths outside immutable release roots", async () => {
    const response = await SELF.fetch(
      "https://download-dispatch.syngnat.top/v1/resolve?path=https://evil.example/file",
    );
    expect(response.status).toBe(400);
  });
});
