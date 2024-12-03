CREATE TABLE `go_wallet_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source_transaction_id` text NOT NULL,
	`pfi_did` text NOT NULL,
	`currency_code` text NOT NULL,
	`amount` integer NOT NULL,
	`reference` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `transactions` ADD `type` text DEFAULT 'regular' NOT NULL;