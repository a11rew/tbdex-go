import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { integer, sqliteTable, sqliteView, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => `user_${createId()}`),
	did: text('did').notNull().unique(),
	phoneNumber: text('phone_number').notNull().unique(),
	createdAt: text('created_at')
		.notNull()
		.default(sql`(current_timestamp)`),
});

export type DbUser = typeof users.$inferSelect;

export const credentials = sqliteTable('credentials', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => `credential_${createId()}`),
	user_id: text('user_id')
		.references(() => users.id)
		.notNull(),
	vc: text('vc').notNull(),
	createdAt: text('created_at')
		.notNull()
		.default(sql`(current_timestamp)`),
});

export type DbCredential = typeof credentials.$inferSelect;

export const transactions = sqliteTable('transactions', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => `transaction_${createId()}`),
	user_id: text('user_id')
		.references(() => users.id)
		.notNull(),
	exchangeId: text('exchange_id').notNull(),
	offeringId: text('offering_id').notNull(),
	pfiDid: text('pfi_did').notNull(),
	amount: text('amount').notNull(),
	status: text('status', {
		enum: ['pending', 'quote', 'order', 'cancelled', 'complete'],
	}).notNull(),
	type: text('type', {
		enum: ['regular', 'wallet-in', 'wallet-out'],
	})
		.default('regular')
		.notNull(),
	payinKind: text('payin_kind').notNull(),
	payoutKind: text('payout_kind').notNull(),
	createdAt: text('created_at')
		.notNull()
		.default(sql`(current_timestamp)`),
});

export type DbTransaction = typeof transactions.$inferSelect;

export const quotes = sqliteTable('quotes', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => `quote_${createId()}`),
	user_id: text('user_id')
		.references(() => users.id)
		.notNull(),
	transaction_id: text('transaction_id')
		.references(() => transactions.id)
		.notNull(),
	exchangeId: text('exchange_id').notNull(),
	pfiDid: text('pfi_did').notNull(),
	payinAmount: text('payin_amount').notNull(),
	payinCurrency: text('payin_currency').notNull(),
	fee: text('fee'),
	expiresAt: text('expires_at'),
	payoutAmount: text('payout_amount'),
	payoutCurrency: text('payout_currency'),
	createdAt: text('created_at')
		.notNull()
		.default(sql`(current_timestamp)`),
});

export type DbQuote = typeof quotes.$inferSelect;

export const notifications = sqliteTable('notifications', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => `notification_${createId()}`),
	user_id: text('user_id')
		.references(() => users.id)
		.notNull(),
	transaction_id: text('transaction_id')
		.references(() => transactions.id)
		.notNull(),
	type: text('type', {
		enum: ['quote', 'order', 'status-update', 'close'],
	}).notNull(),
	data: text('data'),
	created_at: text('created_at')
		.notNull()
		.default(sql`(current_timestamp)`),
});

export type DbNotification = typeof notifications.$inferSelect;

export const go_credit_transactions = sqliteTable('go_credit_transactions', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => `go_credit_transaction_${createId()}`),
	user_id: text('user_id')
		.references(() => users.id)
		.notNull(),
	amount: integer('amount').notNull(),
	reference: text('reference'),
	created_at: text('created_at')
		.notNull()
		.default(sql`(current_timestamp)`),
});

export type DbGoCreditTransaction = typeof go_credit_transactions.$inferSelect;

export const go_credit_balance_view = sqliteView('go_credit_balance_view', {
	user_id: text('user_id')
		.references(() => users.id)
		.notNull(),
	balance: integer('balance').notNull(),
}).existing();

export const ratings = sqliteTable('ratings', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => `rating_${createId()}`),
	transaction_id: text('transaction_id')
		.references(() => transactions.id)
		.notNull(),
	rating: integer('rating').notNull(),
	created_at: text('created_at')
		.notNull()
		.default(sql`(current_timestamp)`),
});
export type DbRating = typeof ratings.$inferSelect;

export const go_wallet_transactions = sqliteTable('go_wallet_transactions', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => `go_wallet_transaction_${createId()}`),
	user_id: text('user_id')
		.references(() => users.id)
		.notNull(),
	source_transaction_id: text('source_transaction_id')
		.references(() => transactions.id)
		.notNull(),
	pfi_did: text('pfi_did').notNull(),
	currency_code: text('currency_code').notNull(),
	amount: integer('amount').notNull(),
	reference: text('reference'),
	created_at: text('created_at')
		.notNull()
		.default(sql`(current_timestamp)`),
});
export type DbGoWalletTransaction = typeof go_wallet_transactions.$inferSelect;
