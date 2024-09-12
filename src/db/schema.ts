import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => `user_${createId()}`),
	did: text('did').notNull().unique(),
	phoneNumber: text('phone_number').notNull().unique(),
	createdAt: integer('created_at')
		.notNull()
		.default(sql`(current_timestamp)`),
});

export type User = typeof users.$inferSelect;

export const credentials = sqliteTable('credentials', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => `credential_${createId()}`),
	user_id: text('user_id')
		.references(() => users.id)
		.notNull(),
	vc: text('vc').notNull(),
	createdAt: integer('created_at')
		.notNull()
		.default(sql`(current_timestamp)`),
});

export type Credential = typeof credentials.$inferSelect;

export const transactions = sqliteTable('transactions', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => `transaction_${createId()}`),
	user_id: text('user_id')
		.references(() => users.id)
		.notNull(),
	rfqId: text('rfq_id').notNull(),
	exchangeId: text('exchange_id').notNull(),
	offeringId: text('offering_id').notNull(),
	amount: text('amount').notNull(),
	status: text('status', {
		enum: ['pending', 'quote', 'order', 'close'],
	}).notNull(),
	payinMethod: text('payin_method').notNull(),
	payoutMethod: text('payout_method').notNull(),
	payinKind: text('payin_kind').notNull(),
	payoutKind: text('payout_kind').notNull(),
	createdAt: text('created_at')
		.notNull()
		.default(sql`(current_timestamp)`),
});

export type Transaction = typeof transactions.$inferSelect;
