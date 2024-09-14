CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`exchange_id` text NOT NULL,
	`pfi_did` text NOT NULL,
	`payin_amount` text NOT NULL,
	`payin_currency` text NOT NULL,
	`fee` text,
	`expires_at` integer,
	`payout_amount` text,
	`payout_currency` text,
	`created_at` integer DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `transactions` DROP COLUMN `rfq_id`;--> statement-breakpoint
ALTER TABLE `transactions` DROP COLUMN `payin_method`;--> statement-breakpoint
ALTER TABLE `transactions` DROP COLUMN `payout_method`;
ALTER TABLE `transactions` ADD `pfi_did` text NOT NULL;
