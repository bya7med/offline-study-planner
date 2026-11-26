import type { StudySession, SyncBatch, SyncOp } from "./types";

// Phone and laptop edits meet here.
//
// Same session id: one row. The later updatedAt wins, and the two durations
// are never added. The same op id a second time is ignored. Two ids for the
// same subject and the same start instant fold into the row already stored,
// and the other id is remembered so a later edit still hits that row.

export interface ServerState {
  sessions: StudySession[];
  appliedOpIds: string[];
  aliases: Record<string, string>;
}

export interface OpResult {
  opId: string;
  status: "applied" | "duplicate" | "rejected";
  sessionId?: string;
  reason?: string;
}

const MAX_MINUTES = 18 * 60;

export function emptyState(): ServerState {
  return { sessions: [], appliedOpIds: [], aliases: {} };
}

export function applyBatch(
  state: ServerState,
  batch: SyncBatch,
): { state: ServerState; results: OpResult[] } {
  const next = cloneState(state);
  const results: OpResult[] = [];
  for (const op of batch.ops) {
    results.push(applyOp(next, op, batch.deviceId));
  }
  return { state: next, results };
}

export function totalMinutes(state: ServerState): number {
  return state.sessions.reduce((sum, session) => {
    if (session.deleted) return sum;
    return sum + session.durationMin;
  }, 0);
}

export function visibleSessions(state: ServerState): StudySession[] {
  return state.sessions
    .filter((session) => !session.deleted)
    .map((session) => ({ ...session }))
    .sort((a, b) => {
      const byStart = a.startedAt.localeCompare(b.startedAt);
      if (byStart !== 0) return byStart;
      return a.id.localeCompare(b.id);
    });
}

function applyOp(state: ServerState, op: SyncOp, batchDeviceId: string): OpResult {
  if (state.appliedOpIds.includes(op.opId)) {
    return {
      opId: op.opId,
      status: "duplicate",
      sessionId: resolveId(state, op.session.id),
    };
  }

  if (op.deviceId !== batchDeviceId || op.session.deviceId !== op.deviceId) {
    return {
      opId: op.opId,
      status: "rejected",
      reason: "device id does not match the batch",
    };
  }

  const reason = sessionProblem(op.session);
  if (reason) {
    return { opId: op.opId, status: "rejected", reason };
  }

  const incoming = op.session;
  const canonical = resolveId(state, incoming.id);
  const existingIndex = state.sessions.findIndex((session) => session.id === canonical);

  if (existingIndex >= 0) {
    const existing = state.sessions[existingIndex];
    state.sessions[existingIndex] = {
      ...prefer(existing, incoming),
      id: existing.id,
    };
    if (incoming.id !== existing.id) state.aliases[incoming.id] = existing.id;
  } else {
    const dupIndex = state.sessions.findIndex((session) => sameSitting(session, incoming));
    if (dupIndex >= 0) {
      const kept = state.sessions[dupIndex];
      state.sessions[dupIndex] = { ...prefer(kept, incoming), id: kept.id };
      state.aliases[incoming.id] = kept.id;
    } else {
      state.sessions.push({ ...incoming });
    }
  }

  state.appliedOpIds.push(op.opId);
  return {
    opId: op.opId,
    status: "applied",
    sessionId: resolveId(state, incoming.id),
  };
}

function prefer(current: StudySession, incoming: StudySession): StudySession {
  const currentTime = Date.parse(current.updatedAt);
  const incomingTime = Date.parse(incoming.updatedAt);
  if (incomingTime !== currentTime) {
    return incomingTime > currentTime ? incoming : current;
  }
  if (incoming.deviceId === current.deviceId) return incoming;
  return incoming.deviceId < current.deviceId ? incoming : current;
}

function sameSitting(a: StudySession, b: StudySession): boolean {
  if (normSubject(a.subject) !== normSubject(b.subject)) return false;
  const startA = Date.parse(a.startedAt);
  const startB = Date.parse(b.startedAt);
  return Number.isFinite(startA) && startA === startB;
}

function normSubject(subject: string): string {
  return subject.trim().toLowerCase();
}

function resolveId(state: ServerState, id: string): string {
  const seen = new Set<string>();
  let current = id;
  while (state.aliases[current] && !seen.has(current)) {
    seen.add(current);
    current = state.aliases[current];
  }
  return current;
}

function sessionProblem(session: StudySession): string | null {
  if (!session.id.trim() || !session.deviceId.trim() || !session.subject.trim()) {
    return "session is missing an id, device, or subject";
  }
  if (
    !Number.isInteger(session.durationMin) ||
    session.durationMin < 0 ||
    session.durationMin > MAX_MINUTES
  ) {
    return `duration must be a whole number of minutes from 0 to ${MAX_MINUTES}`;
  }
  if (Number.isNaN(Date.parse(session.startedAt)) || Number.isNaN(Date.parse(session.updatedAt))) {
    return "startedAt and updatedAt must be time strings";
  }
  return null;
}

function cloneState(state: ServerState): ServerState {
  return {
    sessions: state.sessions.map((session) => ({ ...session })),
    appliedOpIds: [...state.appliedOpIds],
    aliases: { ...state.aliases },
  };
}
