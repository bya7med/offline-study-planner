// A session is one sitting. The id stays stable once a device has synced it,
// so a later edit from the other device updates this row instead of adding one.

export interface StudySession {
  id: string;
  subject: string;
  startedAt: string;
  durationMin: number;
  note: string;
  updatedAt: string;
  deviceId: string;
  deleted: boolean;
}

export interface SyncOp {
  opId: string;
  deviceId: string;
  session: StudySession;
}

export interface SyncBatch {
  deviceId: string;
  ops: SyncOp[];
}
