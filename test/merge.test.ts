import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyBatch,
  emptyState,
  totalMinutes,
  visibleSessions,
  type ServerState,
} from "../src/merge";
import { parseBatch } from "../src/validate";
import type { StudySession } from "../src/types";

const START = "2026-11-22T10:00:00.000Z";

function session(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: "maths-sat",
    subject: "Maths",
    startedAt: START,
    durationMin: 45,
    note: "",
    updatedAt: "2026-11-22T11:00:00.000Z",
    deviceId: "phone",
    deleted: false,
    ...overrides,
  };
}

function push(
  state: ServerState,
  deviceId: string,
  row: StudySession,
  opId: string,
) {
  return applyBatch(state, {
    deviceId,
    ops: [{ opId, deviceId, session: { ...row, deviceId } }],
  });
}

test("phone and laptop edits of one session do not add the minutes", () => {
  const phone = push(
    emptyState(),
    "phone",
    session({ durationMin: 45, updatedAt: "2026-11-22T11:00:00.000Z" }),
    "phone-op-1",
  );
  const both = push(
    phone.state,
    "laptop",
    session({
      durationMin: 50,
      deviceId: "laptop",
      updatedAt: "2026-11-22T11:05:00.000Z",
    }),
    "laptop-op-1",
  );

  assert.equal(both.results[0]?.status, "applied");
  assert.equal(both.state.sessions.length, 1);
  assert.equal(both.state.sessions[0]?.durationMin, 50);
  assert.equal(totalMinutes(both.state), 50);
  assert.equal(visibleSessions(both.state).length, 1);
});

test("equal clocks pick the device id that sorts first", () => {
  const sameTime = "2026-11-22T11:00:00.000Z";
  const phone = push(
    emptyState(),
    "phone",
    session({ durationMin: 45, updatedAt: sameTime }),
    "phone-op-1",
  );
  const both = push(
    phone.state,
    "laptop",
    session({ durationMin: 50, updatedAt: sameTime }),
    "laptop-op-1",
  );

  assert.equal(both.state.sessions.length, 1);
  assert.equal(both.state.sessions[0]?.durationMin, 50);
  assert.equal(both.state.sessions[0]?.deviceId, "laptop");
  assert.equal(totalMinutes(both.state), 50);
});

test("sending the same sync again does not count the minutes twice", () => {
  const batch = {
    deviceId: "phone",
    ops: [
      {
        opId: "phone-op-1",
        deviceId: "phone",
        session: session({ durationMin: 45 }),
      },
    ],
  };

  const first = applyBatch(emptyState(), batch);
  const second = applyBatch(first.state, batch);

  assert.equal(second.results[0]?.status, "duplicate");
  assert.equal(second.state.sessions.length, 1);
  assert.equal(second.state.appliedOpIds.length, 1);
  assert.equal(totalMinutes(second.state), 45);
  assert.equal(totalMinutes(first.state), totalMinutes(second.state));
});

test("two offline creates of one sitting collapse, and a later edit still finds it", () => {
  const phone = push(
    emptyState(),
    "phone",
    session({
      id: "phone-maths",
      durationMin: 45,
      updatedAt: "2026-11-22T11:00:00.000Z",
    }),
    "phone-op-1",
  );
  const folded = push(
    phone.state,
    "laptop",
    session({
      id: "laptop-maths",
      subject: "maths",
      startedAt: "2026-11-22T10:00:00+00:00",
      durationMin: 50,
      updatedAt: "2026-11-22T11:05:00.000Z",
    }),
    "laptop-op-1",
  );

  assert.equal(folded.state.sessions.length, 1);
  assert.equal(totalMinutes(folded.state), 50);
  assert.equal(folded.state.aliases["laptop-maths"], "phone-maths");

  const edited = push(
    folded.state,
    "laptop",
    session({
      id: "laptop-maths",
      durationMin: 55,
      updatedAt: "2026-11-22T12:00:00.000Z",
    }),
    "laptop-op-2",
  );

  assert.equal(edited.state.sessions.length, 1);
  assert.equal(edited.state.sessions[0]?.id, "phone-maths");
  assert.equal(totalMinutes(edited.state), 55);
});

test("different sittings each count", () => {
  const maths = push(
    emptyState(),
    "phone",
    session({ id: "maths", subject: "Maths", durationMin: 45 }),
    "op-maths",
  );
  const physics = push(
    maths.state,
    "laptop",
    session({
      id: "physics",
      subject: "Physics",
      startedAt: START,
      durationMin: 30,
      updatedAt: "2026-11-22T12:00:00.000Z",
    }),
    "op-physics",
  );
  const secondPaper = push(
    physics.state,
    "phone",
    session({
      id: "maths-later",
      subject: "Maths",
      startedAt: "2026-11-22T14:00:00.000Z",
      durationMin: 20,
      updatedAt: "2026-11-22T14:30:00.000Z",
    }),
    "op-maths-later",
  );

  assert.equal(secondPaper.state.sessions.length, 3);
  assert.equal(totalMinutes(secondPaper.state), 95);
});

test("a later delete drops the minutes, a later edit brings back one duration", () => {
  const logged = push(
    emptyState(),
    "phone",
    session({ durationMin: 45, updatedAt: "2026-11-22T11:00:00.000Z" }),
    "op-log",
  );
  const removed = push(
    logged.state,
    "laptop",
    session({
      deleted: true,
      durationMin: 45,
      updatedAt: "2026-11-22T11:10:00.000Z",
    }),
    "op-delete",
  );

  assert.equal(visibleSessions(removed.state).length, 0);
  assert.equal(totalMinutes(removed.state), 0);

  const restored = push(
    removed.state,
    "phone",
    session({ durationMin: 40, updatedAt: "2026-11-22T11:20:00.000Z" }),
    "op-restore",
  );

  assert.equal(visibleSessions(restored.state).length, 1);
  assert.equal(totalMinutes(restored.state), 40);
  assert.equal(restored.state.sessions.length, 1);
});

test("a bad duration is refused and can be sent again once fixed", () => {
  const parsed = parseBatch({
    deviceId: "phone",
    ops: [
      {
        opId: "phone-op-1",
        deviceId: "phone",
        session: { ...session(), durationMin: -5 },
      },
    ],
  });
  assert.equal(parsed.ok, false);

  const rejected = push(
    emptyState(),
    "phone",
    session({ durationMin: -5 }),
    "phone-op-1",
  );
  assert.equal(rejected.results[0]?.status, "rejected");
  assert.equal(rejected.state.sessions.length, 0);
  assert.equal(rejected.state.appliedOpIds.length, 0);

  const fixed = push(
    rejected.state,
    "phone",
    session({ durationMin: 45 }),
    "phone-op-1",
  );
  assert.equal(fixed.results[0]?.status, "applied");
  assert.equal(totalMinutes(fixed.state), 45);
});

test("the batch parser rejects a device id that does not match", () => {
  const parsed = parseBatch({
    deviceId: "phone",
    ops: [
      {
        opId: "phone-op-1",
        deviceId: "laptop",
        session: session({ deviceId: "laptop" }),
      },
    ],
  });

  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.match(parsed.error, /deviceId/);
  }
});
