const NODE_IDS = ["tencent", "dmit"] as const;
const CHANNELS = ["stable", "dev"] as const;
const SUCCESS_THRESHOLD = 2;
const FAILURE_THRESHOLD = 3;
const RANGE_PROBE_BYTES = 1024;
const ROUTING_STATE_MAX_AGE_MS = 12 * 60 * 1000;

type NodeId = (typeof NODE_IDS)[number];
type Channel = (typeof CHANNELS)[number];

type EdgeConfig = {
  baseUrl: string;
  enabled: boolean;
};

type PublicationControl = {
  schemaVersion: 1;
  channel: Channel;
  generation: string;
  probePath: string;
  probeSize: number;
  probeSha256: string;
  nodes: Record<NodeId, EdgeConfig>;
};

type NodeHealth = {
  generation: string;
  healthy: boolean;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  checkedAt: string;
  detail: string;
};

type RoutingState = {
  schemaVersion: 1;
  channel: Channel;
  generation: string;
  control: PublicationControl;
  nodes: Record<NodeId, NodeHealth>;
  checkedAt: string;
};

type AssetCoordinates = {
  channel: Channel;
  relativePath: string;
  githubUrl: string;
};

const MUTABLE_PATHS: Record<string, AssetCoordinates> = {
  "/gonavi/releases/latest/latest.json": {
    channel: "stable",
    relativePath: "/gonavi/releases/latest/latest.json",
    githubUrl: "https://github.com/Syngnat/GoNavi/releases/latest/download/latest.json",
  },
  "/gonavi/dev/releases/latest/latest-dev.json": {
    channel: "dev",
    relativePath: "/gonavi/dev/releases/latest/latest-dev.json",
    githubUrl: "https://github.com/Syngnat/GoNavi/releases/download/dev-latest/latest-dev.json",
  },
  "/drivers/releases/latest/GoNavi-DriverAgents-Index.json": {
    channel: "stable",
    relativePath: "/drivers/releases/latest/GoNavi-DriverAgents-Index.json",
    githubUrl: "https://github.com/Syngnat/GoNavi-DriverAgents/releases/latest/download/GoNavi-DriverAgents-Index.json",
  },
  "/drivers/dev/releases/latest/GoNavi-DriverAgents-Index.json": {
    channel: "dev",
    relativePath: "/drivers/dev/releases/latest/GoNavi-DriverAgents-Index.json",
    githubUrl: "https://github.com/Syngnat/GoNavi-DriverAgents/releases/download/dev-latest/GoNavi-DriverAgents-Index.json",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && CHANNELS.includes(value as Channel);
}

function isNodeId(value: unknown): value is NodeId {
  return typeof value === "string" && NODE_IDS.includes(value as NodeId);
}

function normalizeHttpsBaseUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return null;
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function validateControl(value: unknown, expectedChannel: Channel): PublicationControl {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.channel !== expectedChannel) {
    throw new Error("invalid publication control envelope");
  }
  if (
    typeof value.generation !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.generation)
    || typeof value.probePath !== "string"
    || !isAllowedAssetPath(value.probePath)
    || typeof value.probeSize !== "number"
    || !Number.isSafeInteger(value.probeSize)
    || value.probeSize <= 0
    || typeof value.probeSha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(value.probeSha256)
    || !isRecord(value.nodes)
  ) {
    throw new Error("invalid publication control metadata");
  }

  const nodes = {} as Record<NodeId, EdgeConfig>;
  for (const nodeId of NODE_IDS) {
    const rawNode = value.nodes[nodeId];
    if (!isRecord(rawNode) || typeof rawNode.enabled !== "boolean") {
      throw new Error(`invalid edge config for ${nodeId}`);
    }
    const baseUrl = normalizeHttpsBaseUrl(rawNode.baseUrl);
    if (!baseUrl) {
      throw new Error(`invalid HTTPS base URL for ${nodeId}`);
    }
    nodes[nodeId] = { baseUrl, enabled: rawNode.enabled };
  }

  return {
    schemaVersion: 1,
    channel: expectedChannel,
    generation: value.generation,
    probePath: value.probePath,
    probeSize: value.probeSize,
    probeSha256: value.probeSha256,
    nodes,
  };
}

function isAllowedAssetPath(value: string): boolean {
  if (!value.startsWith("/") || value.includes("\\") || value.includes("..")) return false;
  const parts = value.split("/").filter(Boolean);
  if (parts.length !== 5 && parts.length !== 6) return false;
  if (parts[0] === "gonavi") {
    if (parts[1] === "releases") {
      return parts.length === 5 && parts[2] === "download";
    }
    return parts.length === 6 && parts[1] === "dev" && parts[2] === "releases" && parts[3] === "download";
  }
  if (parts[0] === "drivers") {
    if (parts[1] === "releases") {
      return parts.length === 5 && parts[2] === "download";
    }
    return parts.length === 6 && parts[1] === "dev" && parts[2] === "releases" && parts[3] === "download";
  }
  return false;
}

function parseAssetCoordinates(rawPath: string): AssetCoordinates | null {
  const mutable = MUTABLE_PATHS[rawPath];
  if (mutable) return { ...mutable };
  if (!isAllowedAssetPath(rawPath)) return null;
  const parts = rawPath.split("/").filter(Boolean);
  const isDriver = parts[0] === "drivers";
  const isDev = parts[1] === "dev";
  const tagIndex = isDev ? 4 : 3;
  const assetIndex = isDev ? 5 : 4;
  const tag = parts[tagIndex];
  const asset = parts[assetIndex];
  if (!tag || !asset) return null;
  const githubTag = isDev ? "dev-latest" : tag;
  const repository = isDriver ? "Syngnat/GoNavi-DriverAgents" : "Syngnat/GoNavi";
  return {
    channel: isDev ? "dev" : "stable",
    relativePath: "/" + parts.map(encodeURIComponent).join("/"),
    githubUrl: `https://github.com/${repository}/releases/download/${encodeURIComponent(githubTag)}/${encodeURIComponent(asset)}`,
  };
}

function parseContentRange(value: string | null): { start: number; end: number; total: number } | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? "");
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total) || start < 0 || end < start || total <= end) {
    return null;
  }
  return { start, end, total };
}

export function isReadyHealthPayload(value: unknown, channel: Channel, generation: string): boolean {
  if (!isRecord(value) || value.status !== "ok" || value.ready !== true || !isRecord(value.channels)) {
    return false;
  }
  const channelHealth = value.channels[channel];
  return isRecord(channelHealth) && channelHealth.generation === generation;
}

export async function probeEdge(
  control: PublicationControl,
  nodeId: NodeId,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; detail: string }> {
  const node = control.nodes[nodeId];
  if (!node.enabled) return { ok: false, detail: "disabled by publication control" };

  try {
    const healthResponse = await fetchImpl(node.baseUrl + "/healthz", {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
      // Workers supports only follow/manual; manual makes a redirect fail the status checks below.
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (!healthResponse.ok) return { ok: false, detail: `healthz status ${healthResponse.status}` };
    const healthValue: unknown = await healthResponse.json();
    if (!isReadyHealthPayload(healthValue, control.channel, control.generation)) {
      return { ok: false, detail: "healthz is not ready for generation" };
    }

    const rangeEnd = Math.min(control.probeSize, RANGE_PROBE_BYTES) - 1;
    const rangeResponse = await fetchImpl(node.baseUrl + control.probePath, {
      headers: {
        Range: `bytes=0-${rangeEnd}`,
        "Cache-Control": "no-cache",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const contentRange = parseContentRange(rangeResponse.headers.get("Content-Range"));
    const body = await rangeResponse.arrayBuffer();
    if (
      rangeResponse.status !== 206
      || !contentRange
      || contentRange.start !== 0
      || contentRange.end !== rangeEnd
      || contentRange.total !== control.probeSize
      || Number(rangeResponse.headers.get("Content-Length")) !== rangeEnd + 1
      || body.byteLength !== rangeEnd + 1
    ) {
      return { ok: false, detail: "immutable Range verification failed" };
    }
    return { ok: true, detail: "ok" };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "probe failed" };
  }
}

export function nextNodeHealth(
  previous: NodeHealth | undefined,
  generation: string,
  sample: { ok: boolean; detail: string },
  checkedAt: string,
): NodeHealth {
  if (previous?.generation !== generation) {
    return {
      generation,
      healthy: false,
      consecutiveFailures: sample.ok ? 0 : 1,
      consecutiveSuccesses: sample.ok ? 1 : 0,
      checkedAt,
      detail: sample.detail,
    };
  }
  if (sample.ok) {
    const successes = previous.consecutiveSuccesses + 1;
    return {
      generation,
      healthy: previous.healthy || successes >= SUCCESS_THRESHOLD,
      consecutiveFailures: 0,
      consecutiveSuccesses: successes,
      checkedAt,
      detail: sample.detail,
    };
  }
  const failures = previous.consecutiveFailures + 1;
  return {
    generation,
    healthy: previous.healthy && failures < FAILURE_THRESHOLD,
    consecutiveFailures: failures,
    consecutiveSuccesses: 0,
    checkedAt,
    detail: sample.detail,
  };
}

async function readRoutingState(env: Env, channel: Channel): Promise<RoutingState | null> {
  const value: unknown = await env.ROUTING_STATE.get(`routing:${channel}`, "json");
  if (!isRecord(value) || value.schemaVersion !== 1 || value.channel !== channel || !isRecord(value.nodes) || !isRecord(value.control)) {
    return null;
  }
  try {
    const control = validateControl(value.control, channel);
    const nodes = {} as Record<NodeId, NodeHealth>;
    for (const nodeId of NODE_IDS) {
      const raw = value.nodes[nodeId];
      if (
        !isRecord(raw)
        || typeof raw.generation !== "string"
        || typeof raw.healthy !== "boolean"
        || typeof raw.consecutiveFailures !== "number"
        || typeof raw.consecutiveSuccesses !== "number"
        || typeof raw.checkedAt !== "string"
        || typeof raw.detail !== "string"
      ) {
        return null;
      }
      nodes[nodeId] = {
        generation: raw.generation,
        healthy: raw.healthy,
        consecutiveFailures: raw.consecutiveFailures,
        consecutiveSuccesses: raw.consecutiveSuccesses,
        checkedAt: raw.checkedAt,
        detail: raw.detail,
      };
    }
    return {
      schemaVersion: 1,
      channel,
      generation: control.generation,
      control,
      nodes,
      checkedAt: typeof value.checkedAt === "string" ? value.checkedAt : "",
    };
  } catch {
    return null;
  }
}

export async function refreshChannel(env: Env, channel: Channel): Promise<RoutingState> {
  const controlValue: unknown = await env.ROUTING_STATE.get(`control:${channel}`, "json");
  if (controlValue === null) throw new Error(`publication control is missing for ${channel}`);
  const control = validateControl(controlValue, channel);
  const previous = await readRoutingState(env, channel);
  const checkedAt = new Date().toISOString();
  const probeResults = await Promise.all(NODE_IDS.map((nodeId) => probeEdge(control, nodeId)));
  const nodes = {} as Record<NodeId, NodeHealth>;
  for (let index = 0; index < NODE_IDS.length; index += 1) {
    const nodeId = NODE_IDS[index];
    nodes[nodeId] = nextNodeHealth(previous?.nodes[nodeId], control.generation, probeResults[index], checkedAt);
  }
  const state: RoutingState = {
    schemaVersion: 1,
    channel,
    generation: control.generation,
    control,
    nodes,
    checkedAt,
  };
  await env.ROUTING_STATE.put(`routing:${channel}`, JSON.stringify(state));
  console.log(JSON.stringify({
    message: "routing health refreshed",
    channel,
    generation: control.generation,
    nodes: Object.fromEntries(NODE_IDS.map((nodeId) => [nodeId, nodes[nodeId].healthy])),
  }));
  return state;
}

export function orderedNodeIds(country: string | undefined): NodeId[] {
  return country?.toUpperCase() === "CN" ? ["tencent", "dmit"] : ["dmit", "tencent"];
}

export function isRoutingStateFresh(checkedAt: string, now: number = Date.now()): boolean {
  const checkedAtMillis = Date.parse(checkedAt);
  return Number.isFinite(checkedAtMillis)
    && checkedAtMillis <= now
    && now - checkedAtMillis <= ROUTING_STATE_MAX_AGE_MS;
}

function joinBaseAndPath(baseUrl: string, relativePath: string): string {
  return baseUrl.replace(/\/+$/, "") + relativePath;
}

export function selectLegacyRedirectCandidate<T extends { source: string }>(candidates: T[]): T {
  return candidates.find((candidate) => candidate.source === "dmit")
    ?? candidates.find((candidate) => candidate.source === "tencent")
    ?? candidates[0];
}

async function resolveDownload(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const coordinates = parseAssetCoordinates(url.searchParams.get("path") ?? "");
  if (!coordinates) {
    return Response.json({ error: "invalid asset path" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const state = await readRoutingState(env, coordinates.channel);
  const candidates: Array<{ source: string; url: string }> = [];
  const cfCountry = typeof request.cf?.country === "string" ? request.cf.country : undefined;
  if (state && isRoutingStateFresh(state.checkedAt)) {
    for (const nodeId of orderedNodeIds(cfCountry)) {
      const node = state.nodes[nodeId];
      const config = state.control.nodes[nodeId];
      if (config.enabled && node.healthy && node.generation === state.generation) {
        candidates.push({ source: nodeId, url: joinBaseAndPath(config.baseUrl, coordinates.relativePath) });
      }
    }
  }
  candidates.push({ source: "github", url: coordinates.githubUrl });

  const wantsJSON = url.searchParams.get("format") === "json";
  const selected = wantsJSON ? candidates[0] : selectLegacyRedirectCandidate(candidates);
  console.log(JSON.stringify({
    message: "download source selected",
    channel: coordinates.channel,
    country: cfCountry ?? "",
    generation: state?.generation ?? "",
    source: selected.source,
  }));
  const headers = new Headers({
    "Cache-Control": "no-store",
    Location: selected.url,
    Vary: "CF-IPCountry",
    "X-GoNavi-Download-Source": selected.source,
  });
  if (wantsJSON) {
    return Response.json(
      {
        url: selected.url,
        source: selected.source,
        generation: state?.generation ?? "",
        candidates,
      },
      { headers },
    );
  }
  return new Response(null, { status: 302, headers });
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } });
  }
  if (url.pathname === "/healthz") {
    return Response.json({ status: "ok", ready: true }, { headers: { "Cache-Control": "no-store" } });
  }
  if (url.pathname !== "/v1/resolve") {
    return Response.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return resolveDownload(request, env);
}

export { CHANNELS };
