/**
 * InMemoryPrisma
 *
 * Deterministic, stateful stand-in for PrismaService used by WhatsApp conversation tests.
 *
 * Why this exists:
 * - Several WhatsApp specs previously ran against the REAL development database
 *   (non-deterministic, polluted by other data, and they mutated real rows).
 * - Other specs used hand-rolled `jest.fn()` mocks that silently drifted from the
 *   production query surface (e.g. `user.findFirst is not a function`).
 *
 * This fake implements exactly the Prisma surface used by `src/modules/channels/whatsapp/**`
 * with real persistence semantics (writes are visible to subsequent reads, `@updatedAt`
 * is maintained, relations used in `where`/`include` are resolved).
 */
import { randomUUID } from 'crypto';

type Row = Record<string, any>;

export interface SeedData {
  salons?: Row[];
  users?: Row[];
  salonUsers?: Row[];
  conversations?: Row[];
  appointments?: Row[];
}

/**
 * Realm-safe deep clone.
 * NOTE: `structuredClone` must NOT be used here. Under Jest it returns objects from the
 * host realm, so `value instanceof Date` is false inside the test VM. Production code
 * (TimeUtility) relies on `instanceof Date`, which would silently format dates as ''.
 * Real Prisma returns same-realm Date objects, so this clone mirrors production.
 */
const clone = <T>(v: T): T => {
  if (v === undefined || v === null || typeof v !== 'object') return v;
  if (v instanceof Date) return new Date(v.getTime()) as any;
  if (Array.isArray(v)) return v.map((x) => clone(x)) as any;
  const out: Record<string, any> = {};
  for (const [k, val] of Object.entries(v as Record<string, any>)) out[k] = clone(val);
  return out as T;
};

export class InMemoryPrisma {
  readonly tables = {
    salon: [] as Row[],
    user: [] as Row[],
    salonUser: [] as Row[],
    conversation: [] as Row[],
    appointment: [] as Row[],
    whatsAppLog: [] as Row[],
    whatsAppAccount: [] as Row[],
  };

  /** Chronological record of every conversation write (used by invariant tests). */
  readonly conversationWrites: Array<{ op: string; data: Row; at: number }> = [];

  constructor(seed: SeedData = {}) {
    this.tables.salon = (seed.salons || []).map((r) => clone(r));
    this.tables.user = (seed.users || []).map((r) => ({ createdAt: new Date(), ...clone(r) }));
    this.tables.salonUser = (seed.salonUsers || []).map((r) => ({ id: randomUUID(), isBookingBlocked: false, ...clone(r) }));
    this.tables.conversation = (seed.conversations || []).map((r) => this.withConversationDefaults(clone(r)));
    this.tables.appointment = (seed.appointments || []).map((r) => ({ createdAt: new Date(), ...clone(r) }));
  }

  // ---------------------------------------------------------------------------
  // Generic matching helpers
  // ---------------------------------------------------------------------------

  private matchScalar(value: any, cond: any): boolean {
    if (cond === undefined) return true;
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond) return (cond.in as any[]).some((c) => this.eq(value, c));
      if ('notIn' in cond) return !(cond.notIn as any[]).some((c) => this.eq(value, c));
      if ('not' in cond) return !this.eq(value, cond.not);
      if ('equals' in cond) return this.eq(value, cond.equals);
      if ('gte' in cond || 'lte' in cond || 'gt' in cond || 'lt' in cond) {
        const v = value instanceof Date ? value.getTime() : value;
        const n = (x: any) => (x instanceof Date ? x.getTime() : x);
        if ('gte' in cond && !(v >= n(cond.gte))) return false;
        if ('lte' in cond && !(v <= n(cond.lte))) return false;
        if ('gt' in cond && !(v > n(cond.gt))) return false;
        if ('lt' in cond && !(v < n(cond.lt))) return false;
        return true;
      }
      if ('contains' in cond) return String(value ?? '').includes(cond.contains);
    }
    return this.eq(value, cond);
  }

  private eq(a: any, b: any): boolean {
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    return a === b;
  }

  private salonUserMatches(salonUserId: string, where: Row): boolean {
    const su = this.tables.salonUser.find((s) => s.id === salonUserId);
    if (!su) return false;
    for (const [k, cond] of Object.entries(where)) {
      if (k === 'user') {
        const user = this.tables.user.find((u) => u.id === su.userId);
        if (!user || !this.rowMatches(user, cond as Row)) return false;
      } else if (!this.matchScalar(su[k], cond)) {
        return false;
      }
    }
    return true;
  }

  private rowMatches(row: Row, where: Row = {}): boolean {
    for (const [key, cond] of Object.entries(where)) {
      if (key === 'AND') {
        if (!(cond as Row[]).every((c) => this.rowMatches(row, c))) return false;
        continue;
      }
      if (key === 'OR') {
        if (!(cond as Row[]).some((c) => this.rowMatches(row, c))) return false;
        continue;
      }
      if (key === 'salonUser' && cond && typeof cond === 'object') {
        if (!this.salonUserMatches(row.salonUserId, cond as Row)) return false;
        continue;
      }
      if (key === 'salonId_customerPhone') {
        if (row.salonId !== (cond as Row).salonId || row.customerPhone !== (cond as Row).customerPhone) return false;
        continue;
      }
      if (key === 'salonId_userId') {
        if (row.salonId !== (cond as Row).salonId || row.userId !== (cond as Row).userId) return false;
        continue;
      }
      if (!this.matchScalar(row[key], cond)) return false;
    }
    return true;
  }

  private sort(rows: Row[], orderBy?: Row | Row[]): Row[] {
    if (!orderBy) return rows;
    const orders = Array.isArray(orderBy) ? orderBy : [orderBy];
    return [...rows].sort((a, b) => {
      for (const o of orders) {
        const [field, dir] = Object.entries(o)[0] as [string, string];
        const av = a[field] instanceof Date ? a[field].getTime() : a[field];
        const bv = b[field] instanceof Date ? b[field].getTime() : b[field];
        if (av === bv) continue;
        const cmp = av > bv ? 1 : -1;
        return dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  }

  private includeAppointment(row: Row, include?: Row): Row {
    const out = clone(row);
    if (!include) return out;
    const salon = this.tables.salon.find((s) => s.id === row.salonId);
    if (include.service) out.service = clone((salon?.services || []).find((s: Row) => s.id === row.serviceId) || null);
    if (include.stylist) out.stylist = clone((salon?.stylists || []).find((s: Row) => s.id === row.stylistId) || null);
    return out;
  }

  private withConversationDefaults(row: Row): Row {
    return {
      id: randomUUID(),
      state: 'START',
      selectedServiceId: null,
      selectedCategoryId: null,
      tempBookingGender: null,
      selectedStaffId: null,
      selectedDate: null,
      selectedStartTime: null,
      customerName: null,
      activeAppointmentId: null,
      pendingAddonServiceId: null,
      isBotPaused: false,
      botPausedUntil: null,
      quickCodeVerifiedAt: null,
      quickCodeAttempts: 0,
      quickCodeLockedUntil: null,
      updatedAt: new Date(),
      ...row,
    };
  }

  private recordConversationWrite(op: string, data: Row) {
    this.conversationWrites.push({ op, data: clone(data), at: Date.now() });
  }

  /** Mirrors Prisma `@updatedAt`: refreshed on every write unless explicitly provided. */
  private applyConversationUpdate(row: Row, data: Row) {
    Object.assign(row, clone(data));
    if (!('updatedAt' in data)) row.updatedAt = new Date();
  }

  // ---------------------------------------------------------------------------
  // Model delegates (only the surface used by the WhatsApp module)
  // ---------------------------------------------------------------------------

  salon = {
    findUnique: jest.fn(async ({ where }: Row) => clone(this.tables.salon.find((s) => this.rowMatches(s, where)) || null)),
    findFirst: jest.fn(async ({ where }: Row = {}) => clone(this.tables.salon.find((s) => this.rowMatches(s, where)) || null)),
    update: jest.fn(async ({ where, data }: Row) => {
      const row = this.tables.salon.find((s) => this.rowMatches(s, where));
      if (!row) throw new Error('Salon not found');
      Object.assign(row, clone(data));
      return clone(row);
    }),
  };

  user = {
    findFirst: jest.fn(async ({ where, orderBy }: Row = {}) => {
      const rows = this.sort(this.tables.user.filter((u) => this.rowMatches(u, where)), orderBy);
      return clone(rows[0] || null);
    }),
    findUnique: jest.fn(async ({ where }: Row) => clone(this.tables.user.find((u) => this.rowMatches(u, where)) || null)),
    create: jest.fn(async ({ data }: Row) => {
      const row = { id: randomUUID(), createdAt: new Date(), name: null, ...clone(data) };
      this.tables.user.push(row);
      return clone(row);
    }),
    update: jest.fn(async ({ where, data }: Row) => {
      const row = this.tables.user.find((u) => this.rowMatches(u, where));
      if (!row) throw new Error('User not found');
      Object.assign(row, clone(data));
      return clone(row);
    }),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const rows = this.tables.user.filter((u) => this.rowMatches(u, where));
      rows.forEach((r) => Object.assign(r, clone(data)));
      return { count: rows.length };
    }),
  };

  salonUser = {
    upsert: jest.fn(async ({ where, create, update }: Row) => {
      let row = this.tables.salonUser.find((s) => this.rowMatches(s, where));
      if (row) {
        Object.assign(row, clone(update || {}));
      } else {
        row = { id: randomUUID(), isBookingBlocked: false, ...clone(create) };
        this.tables.salonUser.push(row);
      }
      return clone(row);
    }),
    findUnique: jest.fn(async ({ where }: Row) => clone(this.tables.salonUser.find((s) => this.rowMatches(s, where)) || null)),
  };

  conversation = {
    findUnique: jest.fn(async ({ where }: Row) => clone(this.tables.conversation.find((c) => this.rowMatches(c, where)) || null)),
    findFirst: jest.fn(async ({ where, orderBy }: Row = {}) => {
      const rows = this.sort(this.tables.conversation.filter((c) => this.rowMatches(c, where)), orderBy);
      return clone(rows[0] || null);
    }),
    create: jest.fn(async ({ data }: Row) => {
      const row = this.withConversationDefaults(clone(data));
      this.tables.conversation.push(row);
      this.recordConversationWrite('create', data);
      return clone(row);
    }),
    update: jest.fn(async ({ where, data }: Row) => {
      const row = this.tables.conversation.find((c) => this.rowMatches(c, where));
      if (!row) throw new Error(`Conversation not found for ${JSON.stringify(where)}`);
      this.applyConversationUpdate(row, data);
      this.recordConversationWrite('update', data);
      return clone(row);
    }),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const rows = this.tables.conversation.filter((c) => this.rowMatches(c, where));
      rows.forEach((r) => this.applyConversationUpdate(r, data));
      this.recordConversationWrite('updateMany', data);
      return { count: rows.length };
    }),
    upsert: jest.fn(async ({ where, create, update }: Row) => {
      const row = this.tables.conversation.find((c) => this.rowMatches(c, where));
      if (row) {
        this.applyConversationUpdate(row, update || {});
        this.recordConversationWrite('upsert:update', update || {});
        return clone(row);
      }
      const created = this.withConversationDefaults(clone(create));
      this.tables.conversation.push(created);
      this.recordConversationWrite('upsert:create', create);
      return clone(created);
    }),
  };

  appointment = {
    findUnique: jest.fn(async ({ where, include }: Row) => {
      const row = this.tables.appointment.find((a) => this.rowMatches(a, where));
      return row ? this.includeAppointment(row, include) : null;
    }),
    findFirst: jest.fn(async ({ where, include, orderBy }: Row = {}) => {
      const rows = this.sort(this.tables.appointment.filter((a) => this.rowMatches(a, where)), orderBy);
      return rows[0] ? this.includeAppointment(rows[0], include) : null;
    }),
    findMany: jest.fn(async ({ where, include, orderBy, take }: Row = {}) => {
      let rows = this.sort(this.tables.appointment.filter((a) => this.rowMatches(a, where)), orderBy);
      if (typeof take === 'number') rows = rows.slice(0, take);
      return rows.map((r) => this.includeAppointment(r, include));
    }),
    create: jest.fn(async ({ data }: Row) => {
      const row = { id: randomUUID(), createdAt: new Date(), ...clone(data) };
      this.tables.appointment.push(row);
      return clone(row);
    }),
    update: jest.fn(async ({ where, data }: Row) => {
      const row = this.tables.appointment.find((a) => this.rowMatches(a, where));
      if (!row) throw new Error('Appointment not found');
      Object.assign(row, clone(data));
      return clone(row);
    }),
  };

  stylist = {
    findUnique: jest.fn(async ({ where }: Row) => {
      for (const salon of this.tables.salon) {
        const st = (salon.stylists || []).find((s: Row) => s.id === where.id);
        if (st) return clone(st);
      }
      return null;
    }),
  };

  whatsAppLog = {
    create: jest.fn(async ({ data }: Row) => {
      const row = { id: randomUUID(), createdAt: new Date(), ...clone(data) };
      this.tables.whatsAppLog.push(row);
      return clone(row);
    }),
    findFirst: jest.fn(async ({ where }: Row = {}) => clone(this.tables.whatsAppLog.find((l) => this.rowMatches(l, where)) || null)),
    findUnique: jest.fn(async ({ where }: Row) => clone(this.tables.whatsAppLog.find((l) => this.rowMatches(l, where)) || null)),
    findMany: jest.fn(async ({ where }: Row = {}) => this.tables.whatsAppLog.filter((l) => this.rowMatches(l, where)).map(clone)),
    update: jest.fn(async ({ where, data }: Row) => {
      const row = this.tables.whatsAppLog.find((l) => this.rowMatches(l, where));
      if (row) Object.assign(row, clone(data));
      return clone(row || null);
    }),
  };

  whatsAppAccount = {
    findFirst: jest.fn(async () => null),
    upsert: jest.fn(async ({ create }: Row) => clone(create)),
    deleteMany: jest.fn(async () => ({ count: 0 })),
  };

  $transaction = jest.fn(async (arg: any) => (typeof arg === 'function' ? arg(this) : Promise.all(arg)));

  // ---------------------------------------------------------------------------
  // Test-only accessors
  // ---------------------------------------------------------------------------

  /** Returns the live conversation row (no clone) for assertions. */
  getConversation(salonId: string, customerPhone: string): Row | undefined {
    return this.tables.conversation.find((c) => c.salonId === salonId && c.customerPhone === customerPhone);
  }
}
