import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * 全局变更序号。
 *
 * 所有业务表的 seq 列都从这里取 nextval()，因此一个 `since=<seq>` 游标就能拉全部实体的增量
 * （每张表按 seq > since 查询，客户端合并后前移游标）。
 */
export const changeSeq = pgSequence('change_seq', { startWith: 1 });

/** 统一的"同步/审计"公共列 */
const syncColumns = () => ({
  userId: uuid('user_id')
    .notNull()
    .references(() => appUser.id, { onDelete: 'cascade' }),
  /** 乐观锁版本号，每次写入 +1 */
  version: integer('version').notNull().default(1),
  /** 全局单调序号：增量同步游标 */
  seq: bigint('seq', { mode: 'number' })
    .notNull()
    .default(sql`nextval('change_seq')`),
  /** 客户端时间，仅供参考，不参与定序 */
  clientUpdatedAt: timestamp('client_updated_at', { withTimezone: true }),
  /** 软删墓碑：防止"删掉的数据被旧端复活" */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ────────────────────────────── 账号 ────────────────────────────── */

export const appUser = pgTable(
  'app_user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 登录名（先只支持邮箱；手机号后续加列） */
    email: text('email'),
    passwordHash: text('password_hash').notNull(),
    nickname: text('nickname').notNull().default(''),
    /** user | support | auditor | admin | super_admin */
    role: text('role').notNull().default('user'),
    /** active | disabled | pending */
    status: text('status').notNull().default('active'),
    /** 改密/踢下线时 +1，使已签发的访问令牌立即失效 */
    tokenVersion: integer('token_version').notNull().default(0),
    /** 管理端二次验证密钥（应用层加密后存储），暂未启用 */
    totpSecret: text('totp_secret'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastLoginIp: text('last_login_ip').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [uniqueIndex('app_user_email_idx').on(t.email)],
);

export const userSession = pgTable(
  'user_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    /** 只存 refresh token 的哈希（含 pepper），泄库也无法重放 */
    tokenHash: text('token_hash').notNull(),
    deviceName: text('device_name').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    ip: text('ip').notNull().default(''),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [
    uniqueIndex('user_session_token_idx').on(t.tokenHash),
    index('user_session_user_idx').on(t.userId, t.createdAt),
  ],
);

/** 幂等日志：同一 opId 只生效一次（同步 push 的重试保护） */
export const syncOpLog = pgTable(
  'sync_op_log',
  {
    opId: text('op_id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    entity: text('entity').notNull(),
    status: text('status').notNull(),
    result: jsonb('result'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [index('sync_op_log_user_idx').on(t.userId, t.createdAt)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => appUser.id, { onDelete: 'set null' }),
    /** 如 login.success / user.disable / data.view */
    action: text('action').notNull(),
    targetType: text('target_type').notNull().default(''),
    targetId: text('target_id').notNull().default(''),
    ip: text('ip').notNull().default(''),
    userAgent: text('user_agent').notNull().default(''),
    detail: jsonb('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [index('audit_log_created_idx').on(t.createdAt), index('audit_log_actor_idx').on(t.actorId)],
);

/* ────────────────────────────── 文件 ────────────────────────────── */

export const fileObject = pgTable(
  'file_object',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    /** 对象存储里的 key */
    objectKey: text('object_key').notNull().default(''),
    mime: text('mime').notNull().default(''),
    size: integer('size').notNull().default(0),
    sha256: text('sha256').notNull().default(''),
    width: integer('width'),
    height: integer('height'),
    /** pending（已预签名待上传）| ready | deleted */
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  t => [
    uniqueIndex('file_object_user_sha_idx').on(t.userId, t.sha256),
    index('file_object_user_idx').on(t.userId, t.createdAt),
  ],
);

/* ────────────────────────────── 业务数据 ────────────────────────────── */

/** 应用设置：每用户一行，内容用 JSONB 装（主题/货币/提醒开关等） */
export const userSetting = pgTable('user_setting', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => appUser.id, { onDelete: 'cascade' }),
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
  version: integer('version').notNull().default(1),
  seq: bigint('seq', { mode: 'number' })
    .notNull()
    .default(sql`nextval('change_seq')`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const category = pgTable(
  'category',
  {
    id: text('id').notNull(),
    ...syncColumns(),
    name: text('name').notNull(),
    icon: text('icon').notNull().default(''),
    color: text('color').notNull().default(''),
    isPreset: boolean('is_preset').notNull().default(false),
    source: text('source').notNull().default('user'),
  },
  t => [primaryKey({ columns: [t.userId, t.id] }), index('category_seq_idx').on(t.userId, t.seq)],
);

export const asset = pgTable(
  'asset',
  {
    id: text('id').notNull(),
    ...syncColumns(),
    name: text('name').notNull(),
    categoryId: text('category_id').notNull(),
    purchasePrice: numeric('purchase_price', { precision: 12, scale: 2 }).notNull(),
    purchaseDate: date('purchase_date').notNull(),
    imageFileId: uuid('image_file_id').references(() => fileObject.id, { onDelete: 'set null' }),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    note: text('note').notNull().default(''),
    /** active | sold | retired */
    status: text('status').notNull().default('active'),
    expectedLifeDays: integer('expected_life_days'),
    sellPrice: numeric('sell_price', { precision: 12, scale: 2 }),
    endDate: date('end_date'),
    profitLoss: numeric('profit_loss', { precision: 12, scale: 2 }),
    actualDailyCost: numeric('actual_daily_cost', { precision: 12, scale: 4 }),
    source: text('source').notNull().default('user'),
  },
  t => [
    primaryKey({ columns: [t.userId, t.id] }),
    index('asset_seq_idx').on(t.userId, t.seq),
    index('asset_live_idx').on(t.userId, t.updatedAt),
  ],
);

export const wishItem = pgTable(
  'wish_item',
  {
    id: text('id').notNull(),
    ...syncColumns(),
    name: text('name').notNull(),
    targetPrice: numeric('target_price', { precision: 12, scale: 2 }).notNull().default('0'),
    savedAmount: numeric('saved_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    monthlySaving: numeric('monthly_saving', { precision: 12, scale: 2 }),
    targetDate: date('target_date'),
    note: text('note'),
    imageFileId: uuid('image_file_id').references(() => fileObject.id, { onDelete: 'set null' }),
    /** pending | achieved | purchased */
    status: text('status').notNull().default('pending'),
    source: text('source').notNull().default('user'),
  },
  t => [primaryKey({ columns: [t.userId, t.id] }), index('wish_item_seq_idx').on(t.userId, t.seq)],
);

export const experience = pgTable(
  'experience',
  {
    id: text('id').notNull(),
    ...syncColumns(),
    /** good | bad */
    type: text('type').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    city: text('city').notNull().default(''),
    location: text('location'),
    shopName: text('shop_name'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    rating: integer('rating'),
    /** 图片文件的 id 列表（保序），真实地址通过 /files/:id 换取签名 URL */
    imageFileIds: text('image_file_ids').array().notNull().default(sql`'{}'::text[]`),
    experienceDate: date('experience_date').notNull(),
    lat: numeric('lat', { precision: 9, scale: 6 }),
    lng: numeric('lng', { precision: 9, scale: 6 }),
    source: text('source').notNull().default('user'),
  },
  t => [
    primaryKey({ columns: [t.userId, t.id] }),
    index('experience_seq_idx').on(t.userId, t.seq),
    index('experience_city_idx').on(t.userId, t.city),
  ],
);

export const mealRecord = pgTable(
  'meal_record',
  {
    id: text('id').notNull(),
    ...syncColumns(),
    mealDate: date('meal_date').notNull(),
    /** HH:mm */
    mealTime: text('meal_time'),
    item: text('item').notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    /** breakfast | lunch | dinner | snack | other */
    mealType: text('meal_type'),
    note: text('note'),
    source: text('source').notNull().default('user'),
  },
  t => [
    primaryKey({ columns: [t.userId, t.id] }),
    index('meal_record_seq_idx').on(t.userId, t.seq),
    index('meal_record_date_idx').on(t.userId, t.mealDate),
  ],
);

export const schema = {
  appUser,
  userSession,
  syncOpLog,
  auditLog,
  fileObject,
  userSetting,
  category,
  asset,
  wishItem,
  experience,
  mealRecord,
};
