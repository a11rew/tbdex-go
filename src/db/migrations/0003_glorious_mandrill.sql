CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`rfq_id` text NOT NULL,
	`exchange_id` text NOT NULL,
	`offering_id` text NOT NULL,
	`amount` text NOT NULL,
	`payin_currency_code` text NOT NULL,
	`payout_currency_code` text NOT NULL,
	`created_at` integer DEFAULT current_timestamp NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);

ALTER TABLE `credentials` ADD COLUMN `created_at` integer NOT NULL DEFAULT 0;
ALTER TABLE `users` ADD COLUMN `created_at` integer NOT NULL DEFAULT 0;

UPDATE `credentials` SET `created_at` = current_timestamp;
UPDATE `users` SET `created_at` = current_timestamp;