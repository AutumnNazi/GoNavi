import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  isReadyHealthPayload,
  isRoutingStateFresh,
  nextNodeHealth,
  orderedNodeIds,
  probeEdge,
  refreshChannel,
  selectLegacyRedirectCandidate,
} from "../src/core";

describe("download dispatcher", () => {
  it("uses DMIT as the only static edge in every region", () => {
    expect(orderedNodeIds()).toEqual(["dmit"]);
  });

  it("keeps legacy 302 downloads on healthy DMIT before GitHub", () => {
    const candidates = [
      { source: "dmit", url: "https://download.syngnat.top/asset" },
      { source: "github", url: "https://github.com/example/asset" },
    ];
    expect(selectLegacyRedirectCandidate(candidates).source).toBe("dmit");
    expect(selectLegacyRedirectCandidate(candidates.filter((candidate) => candidate.source !== "dmit")).source).toBe("github");
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

  it("uses manual redirect handling for Worker edge probes", async () => {
    const requests: RequestInit[] = [];
    const control = {
      schemaVersion: 1 as const,
      channel: "dev" as const,
      generation: "dev-1",
      appTag: "dev-1",
      driverTag: null,
      probePath: "/gonavi/dev/releases/download/dev-1/GoNavi-dev-1-Windows-Amd64-Portable.exe",
      probeSize: 1024,
      probeSha256: "a".repeat(64),
      nodes: {
        dmit: { baseUrl: "https://download.syngnat.top", enabled: true },
      },
    };
    const fetchImpl: typeof fetch = async (_input, init) => {
      requests.push(init ?? {});
      if (requests.length === 1) {
        return Response.json({
          status: "ok",
          ready: true,
          channels: { dev: { generation: "dev-1" } },
        });
      }
      return new Response(new Uint8Array(1024), {
        status: 206,
        headers: {
          "Content-Length": "1024",
          "Content-Range": "bytes 0-1023/1024",
        },
      });
    };

    await expect(probeEdge(control, "dmit", fetchImpl)).resolves.toEqual({ ok: true, detail: "ok" });
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.redirect)).toEqual(["manual", "manual"]);
  });

  it("accepts legacy dual-node routing state but routes only through DMIT", async () => {
    const generation = "stable-legacy";
    await env.ROUTING_STATE.put("routing:stable", JSON.stringify({
      schemaVersion: 1,
      channel: "stable",
      generation,
      control: {
        schemaVersion: 1,
        channel: "stable",
        generation,
        probePath: "/gonavi/releases/download/v1.2.3/GoNavi.zip",
        probeSize: 1024,
        probeSha256: "a".repeat(64),
        nodes: {
          dmit: { baseUrl: "https://download.syngnat.top", enabled: true },
          tencent: { baseUrl: "https://legacy-edge.invalid", enabled: true },
        },
      },
      nodes: {
        dmit: {
          generation,
          healthy: true,
          consecutiveFailures: 0,
          consecutiveSuccesses: 2,
          checkedAt: new Date().toISOString(),
          detail: "ok",
        },
        tencent: {
          generation,
          healthy: true,
          consecutiveFailures: 0,
          consecutiveSuccesses: 2,
          checkedAt: new Date().toISOString(),
          detail: "ok",
        },
      },
      checkedAt: new Date().toISOString(),
    }));

    try {
      const response = await SELF.fetch(
        "https://download-dispatch.syngnat.top/v1/resolve?format=json&path=/gonavi/releases/download/v1.2.3/GoNavi.zip",
      );
      const body = await response.json<{ candidates: Array<{ source: string }> }>();
      expect(body.candidates.map((candidate) => candidate.source)).toEqual(["dmit", "github"]);
    } finally {
      await env.ROUTING_STATE.delete("routing:stable");
    }
  });

  it("routes immutable assets to DMIT only when their app or driver tag matches the active control", async () => {
    const generation = "stable-run-1";
    await env.ROUTING_STATE.put("routing:stable", JSON.stringify({
      schemaVersion: 1,
      channel: "stable",
      generation,
      control: {
        schemaVersion: 1,
        channel: "stable",
        generation,
        appTag: "v1.2.3",
        driverTag: "driver-v1",
        probePath: "/gonavi/releases/download/v1.2.3/GoNavi.zip",
        probeSize: 1024,
        probeSha256: "a".repeat(64),
        nodes: {
          dmit: { baseUrl: "https://download.syngnat.top", enabled: true },
        },
      },
      nodes: {
        dmit: {
          generation,
          healthy: true,
          consecutiveFailures: 0,
          consecutiveSuccesses: 2,
          checkedAt: new Date().toISOString(),
          detail: "ok",
        },
      },
      checkedAt: new Date().toISOString(),
    }));

    try {
      const resolveSources = async (path: string): Promise<string[]> => {
        const response = await SELF.fetch(
          `https://download-dispatch.syngnat.top/v1/resolve?format=json&path=${encodeURIComponent(path)}`,
        );
        const body = await response.json<{ candidates: Array<{ source: string }> }>();
        return body.candidates.map((candidate) => candidate.source);
      };

      await expect(resolveSources("/gonavi/releases/download/v1.2.3/GoNavi.zip")).resolves.toEqual(["dmit", "github"]);
      await expect(resolveSources("/gonavi/releases/download/v1.2.4/GoNavi.zip")).resolves.toEqual(["github"]);
      await expect(resolveSources("/drivers/releases/download/driver-v1/mysql.zip")).resolves.toEqual(["dmit", "github"]);
      await expect(resolveSources("/drivers/releases/download/driver-v2/mysql.zip")).resolves.toEqual(["github"]);
      await expect(resolveSources("/gonavi/releases/latest/latest.json")).resolves.toEqual(["dmit", "github"]);
      await expect(resolveSources("/drivers/releases/latest/GoNavi-DriverAgents-Index.json")).resolves.toEqual(["dmit", "github"]);
    } finally {
      await env.ROUTING_STATE.delete("routing:stable");
    }
  });

  it("keeps a newly published dev tag on GitHub until the matching DMIT generation is active", async () => {
    const generation = "dev-run-1";
    await env.ROUTING_STATE.put("routing:dev", JSON.stringify({
      schemaVersion: 1,
      channel: "dev",
      generation,
      control: {
        schemaVersion: 1,
        channel: "dev",
        generation,
        appTag: "dev-current",
        driverTag: "driver-current",
        probePath: "/gonavi/dev/releases/download/dev-current/GoNavi.zip",
        probeSize: 1024,
        probeSha256: "a".repeat(64),
        nodes: {
          dmit: { baseUrl: "https://download.syngnat.top", enabled: true },
        },
      },
      nodes: {
        dmit: {
          generation,
          healthy: true,
          consecutiveFailures: 0,
          consecutiveSuccesses: 2,
          checkedAt: new Date().toISOString(),
          detail: "ok",
        },
      },
      checkedAt: new Date().toISOString(),
    }));

    try {
      const resolveSources = async (path: string): Promise<string[]> => {
        const response = await SELF.fetch(
          `https://download-dispatch.syngnat.top/v1/resolve?format=json&path=${encodeURIComponent(path)}`,
        );
        const body = await response.json<{ candidates: Array<{ source: string }> }>();
        return body.candidates.map((candidate) => candidate.source);
      };

      await expect(resolveSources("/gonavi/dev/releases/download/dev-current/GoNavi.zip")).resolves.toEqual(["dmit", "github"]);
      await expect(resolveSources("/gonavi/dev/releases/download/dev-next/GoNavi.zip")).resolves.toEqual(["github"]);
      await expect(resolveSources("/drivers/dev/releases/download/driver-current/mysql.zip")).resolves.toEqual(["dmit", "github"]);
      await expect(resolveSources("/drivers/dev/releases/download/driver-next/mysql.zip")).resolves.toEqual(["github"]);
      await expect(resolveSources("/gonavi/dev/releases/latest/latest-dev.json")).resolves.toEqual(["dmit", "github"]);
      await expect(resolveSources("/drivers/dev/releases/latest/GoNavi-DriverAgents-Index.json")).resolves.toEqual(["dmit", "github"]);
    } finally {
      await env.ROUTING_STATE.delete("routing:dev");
    }
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
