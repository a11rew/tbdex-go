import { createId } from '@paralleldrive/cuid2';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => createId()),
	did: text('did').notNull(),
	phoneNumber: text('phone_number').notNull(),
});

export type User = typeof users.$inferSelect;

export const credentials = sqliteTable('credentials', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => createId()),
	user_id: text('user_id')
		.references(() => users.id)
		.notNull(),
	vc: text('vc').notNull(),
});

export type Credential = typeof credentials.$inferSelect;
