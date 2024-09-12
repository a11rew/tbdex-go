ALTER TABLE `transactions` RENAME COLUMN `payin_currency_code` TO `payin_method`;--> statement-breakpoint
ALTER TABLE `transactions` RENAME COLUMN `payout_currency_code` TO `payout_method`;--> statement-breakpoint
/*
 SQLite does not support "Changing existing column type" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html
                  https://stackoverflow.com/questions/2083543/modify-a-columns-type-in-sqlite3

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
ALTER TABLE `transactions` ADD `status` text NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `payin_kind` text NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `payout_kind` text NOT NULL;