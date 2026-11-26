# Offline study planner

I revise on my phone on the bus and on my laptop at home. Both ends go offline. When I get signal again, the two lists of study sessions have to become one list, and the same block of work must not be counted twice.

This is a Cloudflare Worker that takes those offline edits and merges them.

## Run it

```bash
npm install
npm run dev
```

`wrangler dev` runs the worker on your machine. One Durable Object holds the merged log for that process.

- `GET /health` returns `{ "ok": true }`
- `GET /sessions` returns the stored sittings and `totalMinutes`
- `POST /sync` merges one device's offline batch

A sync body looks like this:

```json
{
  "deviceId": "phone",
  "ops": [
    {
      "opId": "phone-1",
      "deviceId": "phone",
      "session": {
        "id": "maths-sat",
        "subject": "Maths",
        "startedAt": "2026-11-22T10:00:00.000Z",
        "durationMin": 45,
        "note": "paper 1",
        "updatedAt": "2026-11-22T10:50:00.000Z",
        "deviceId": "phone"
      }
    }
  ]
}
```

`opId` belongs to the device. Send that same `opId` again and the stored minutes do not move. `wrangler.toml` already declares the Durable Object migration used by `wrangler deploy`.

The rules below are what the merge enforces.

## What a session is

A session is one sitting: the subject, when it started, and how many minutes it lasted. The phone and the laptop each mint an id for a new session. Once that session has synced, both devices keep the same id, so a later edit updates the row instead of inserting a second copy.

## The double count

Same past paper, started at 10:00, written down on the train and then corrected at my desk before either device could sync:

- Phone: 45 minutes
- Laptop: 50 minutes

Add those and Saturday Maths becomes 95 minutes. That is the bug. The merge keeps one session and one duration. The later edit wins, so the total moves by 50. The 45 is dropped, not added on top.

If the phone sends the same sync again because the first request timed out, the second send does not add another 45.

Two sittings that are actually different stay separate. A different subject, or a different start time, should still add.

## Merge rules

1. Same session id from both devices: one row. If both sides changed the minutes, keep one number. Do not add them. The later `updatedAt` replaces the whole row.
2. Same sync request delivered twice: the second one is a no-op. Stored minutes do not move.
3. Two offline creates for the same sitting (same subject, same start time, two devices, two ids) collapse into the row already stored. A later edit that still uses the other id updates that same row.
4. Any other create is a new session and counts on its own.

If both edits carry the same `updatedAt`, the device id that comes first alphabetically wins. `laptop` beats `phone`. The total is still one of the two numbers, never the sum.

## Out of scope

No login and no timetable UI in this repo. The worker is the merge step. A phone client and a laptop client can call it once the rules are in place.
