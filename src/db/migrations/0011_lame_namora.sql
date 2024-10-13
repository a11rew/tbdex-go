CREATE TABLE `saved_beneficiaries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`beneficiary_name` text NOT NULL,
	`pfi_did` text NOT NULL,
	`offering_id` text NOT NULL,
	`payout_currency` text NOT NULL,
	`payout_method` text NOT NULL,
	`payout_details` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
