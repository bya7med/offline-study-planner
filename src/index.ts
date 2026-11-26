import { DurableObject } from "cloudflare:workers";
import {
  applyBatch,
  emptyState,
  totalMinutes,
  visibleSessions,
  type ServerState,
} from "./merge";
import { parseBatch, type ParseResult } from "./validate";
import type { SyncBatch } from "./types";

const STATE_KEY = "state";

export interface Env {
  PLANNER: DurableObjectNamespace<Planner>;
}

// One object for this worker. Logins are out of scope, so phone and laptop
// both talk to the same planner.
export class Planner extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/sessions") {
      const state = await this.load();
      return Response.json({
        sessions: visibleSessions(state),
        totalMinutes: totalMinutes(state),
      });
    }

    if (request.method === "POST" && url.pathname === "/sync") {
      const parsed = await readBatch(request);
      if (!parsed.ok) {
        return Response.json({ error: parsed.error }, { status: parsed.status });
      }

      // One object, so phone and laptop syncs run one after another.
      // A repeated op id is ignored. Two durations for one sitting are not summed.
      const applied = await this.ctx.storage.transaction(async (txn) => {
        const current = normalise(await txn.get<ServerState>(STATE_KEY));
        const next = applyBatch(current, parsed.batch);
        await txn.put(STATE_KEY, next.state);
        return next;
      });

      return Response.json({
        results: applied.results,
        sessions: visibleSessions(applied.state),
        totalMinutes: totalMinutes(applied.state),
      });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  }

  private async load(): Promise<ServerState> {
    return normalise(await this.ctx.storage.get<ServerState>(STATE_KEY));
  }
}

function normalise(stored: ServerState | undefined): ServerState {
  if (!stored) return emptyState();
  return {
    sessions: stored.sessions ?? [],
    appliedOpIds: stored.appliedOpIds ?? [],
    aliases: stored.aliases ?? {},
  };
}

type ReadBatch =
  | { ok: true; batch: SyncBatch }
  | { ok: false; error: string; status: number };

async function readBatch(request: Request): Promise<ReadBatch> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, error: "invalid json", status: 400 };
  }

  const parsed: ParseResult = parseBatch(body);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, status: 400 };
  }
  return { ok: true, batch: parsed.batch };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/sessions" || url.pathname === "/sync") {
      const id = env.PLANNER.idFromName("planner");
      return env.PLANNER.get(id).fetch(request);
    }

    return Response.json({ error: "not found" }, { status: 404 });
  },
};
