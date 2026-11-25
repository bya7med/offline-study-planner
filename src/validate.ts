import type { StudySession, SyncBatch, SyncOp } from "./types";

export type ParseResult =
  | { ok: true; batch: SyncBatch }
  | { ok: false; error: string };

const MAX_OPS = 100;
const MAX_ID = 80;
const MAX_SUBJECT = 80;
const MAX_NOTE = 500;
const MAX_MINUTES = 18 * 60;

export function parseBatch(input: unknown): ParseResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "body must be an object" };
  }

  const body = input as Record<string, unknown>;
  const deviceId = readId(body.deviceId, "deviceId");
  if (isFailure(deviceId)) return deviceId;

  if (!Array.isArray(body.ops)) {
    return { ok: false, error: "ops must be an array" };
  }
  if (body.ops.length > MAX_OPS) {
    return { ok: false, error: "a batch can hold at most 100 ops" };
  }

  const ops: SyncOp[] = [];
  for (let i = 0; i < body.ops.length; i++) {
    const parsed = parseOp(body.ops[i], deviceId, i);
    if (!parsed.ok) return parsed;
    ops.push(parsed.op);
  }

  return { ok: true, batch: { deviceId, ops } };
}

function parseOp(
  input: unknown,
  batchDeviceId: string,
  index: number,
): { ok: true; op: SyncOp } | { ok: false; error: string } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: `ops[${index}] must be an object` };
  }

  const raw = input as Record<string, unknown>;
  const opId = readId(raw.opId, `ops[${index}].opId`);
  if (isFailure(opId)) return opId;

  const deviceId = readId(raw.deviceId, `ops[${index}].deviceId`);
  if (isFailure(deviceId)) return deviceId;
  if (deviceId !== batchDeviceId) {
    return { ok: false, error: `ops[${index}].deviceId must match the batch` };
  }

  const session = parseSession(raw.session, deviceId, index);
  if (!session.ok) return session;

  return { ok: true, op: { opId, deviceId, session: session.session } };
}

function parseSession(
  input: unknown,
  deviceId: string,
  index: number,
): { ok: true; session: StudySession } | { ok: false; error: string } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: `ops[${index}].session must be an object` };
  }

  const raw = input as Record<string, unknown>;
  const prefix = `ops[${index}].session`;

  const id = readId(raw.id, `${prefix}.id`);
  if (isFailure(id)) return id;

  const subject = readSubject(raw.subject, `${prefix}.subject`);
  if (isFailure(subject)) return subject;

  const startedAt = readTime(raw.startedAt, `${prefix}.startedAt`);
  if (isFailure(startedAt)) return startedAt;

  const durationMin = readMinutes(raw.durationMin, `${prefix}.durationMin`);
  if (isFailure(durationMin)) return durationMin;

  const note = readNote(raw.note, `${prefix}.note`);
  if (isFailure(note)) return note;

  const updatedAt = readTime(raw.updatedAt, `${prefix}.updatedAt`);
  if (isFailure(updatedAt)) return updatedAt;

  const sessionDevice = readId(raw.deviceId, `${prefix}.deviceId`);
  if (isFailure(sessionDevice)) return sessionDevice;
  if (sessionDevice !== deviceId) {
    return { ok: false, error: `${prefix}.deviceId must match the op` };
  }

  const deleted = readDeleted(raw.deleted, `${prefix}.deleted`);
  if (isFailure(deleted)) return deleted;

  return {
    ok: true,
    session: {
      id,
      subject,
      startedAt,
      durationMin,
      note,
      updatedAt,
      deviceId: sessionDevice,
      deleted,
    },
  };
}

type Failure = { ok: false; error: string };

function isFailure<T>(value: T | Failure): value is Failure {
  return typeof value === "object" && value !== null && "ok" in value;
}

function readId(value: unknown, field: string): string | Failure {
  if (typeof value !== "string") {
    return { ok: false, error: `${field} must be a string` };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ID) {
    return { ok: false, error: `${field} must be 1 to ${MAX_ID} characters` };
  }
  return trimmed;
}

function readSubject(value: unknown, field: string): string | Failure {
  if (typeof value !== "string") {
    return { ok: false, error: `${field} must be a string` };
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SUBJECT) {
    return {
      ok: false,
      error: `${field} must be 1 to ${MAX_SUBJECT} characters`,
    };
  }
  return trimmed;
}

function readTime(value: unknown, field: string): string | Failure {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return { ok: false, error: `${field} must be a time string` };
  }
  // Store the UTC instant so 10:00Z and 10:00+00:00 count as the same start.
  return new Date(value).toISOString();
}

function readMinutes(value: unknown, field: string): number | Failure {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_MINUTES
  ) {
    return {
      ok: false,
      error: `${field} must be a whole number of minutes from 0 to ${MAX_MINUTES}`,
    };
  }
  return value;
}

function readNote(value: unknown, field: string): string | Failure {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > MAX_NOTE) {
    return {
      ok: false,
      error: `${field} must be a string of at most ${MAX_NOTE} characters`,
    };
  }
  return value;
}

function readDeleted(value: unknown, field: string): boolean | Failure {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    return { ok: false, error: `${field} must be true or false` };
  }
  return value;
}
