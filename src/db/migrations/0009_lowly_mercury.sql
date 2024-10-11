CREATE TABLE `go_credit_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reference` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);

--> statement-breakpoint
-- Insert +50 credit transaction for existing users without transactions
INSERT INTO go_credit_transactions (id, user_id, amount, reference)
SELECT 
    hex(randomblob(16)), -- Generate a random UUID
    users.id,
    50,
    'Initial balance'
FROM users
WHERE NOT EXISTS (
    SELECT 1 
    FROM go_credit_transactions 
    WHERE go_credit_transactions.user_id = users.id
);
