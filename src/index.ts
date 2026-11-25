import { DurableObject } from "cloudflare:workers";
import { parseBatch, type ParseResult } from "./validate";
import type { SyncBatch } from "./types";

export interface Env {
  PLANNER: DurableObjectNamespace<Planner>;
}

// One object for this worker. Logins are out of scope, so phone and laptop
// both talk to the same planner.
export class Planner extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/sessions") {
      return Response.json({ sessions: [], totalMinutes: 0 });
    }

    if (request.method === "POST" && url.pathname === "/sync") {
      const parsed = await readBatch(request);
      if (!parsed.ok) {
        return Response.json({ error: parsed.error }, { status: parsed.status });
      }
      return Response.json(
        {
          error: "merge is not wired up yet",
          ops: parsed.batch.ops.length,
        },
        { status: 501 },
      );
    }

    return Response.json({ error: "not found" }, { status: 404 });
  }
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
