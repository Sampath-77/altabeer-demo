export interface NotifRec { id: string; type: string; title: string; body: string; fineId: string | null; readAt: Date | null; createdAt: Date }
export interface NotifRepo {
  list(userId: string, limit: number): Promise<NotifRec[]>;
  unread(userId: string): Promise<number>;
  markRead(id: string, userId: string): Promise<boolean>;
  create(userId: string, n: { type: string; title: string; body: string; fineId?: string }): Promise<void>;
}
