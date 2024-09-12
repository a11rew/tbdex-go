ALTER TABLE `transactions` RENAME COLUMN `payin_currency_code` TO `payin_method`;

ALTER TABLE `transactions` RENAME COLUMN `payout_currency_code` TO `payout_method`;

ALTER TABLE `transactions` ADD `status` text NOT NULL;

ALTER TABLE `transactions` ADD `payin_kind` text NOT NULL;

ALTER TABLE `transactions` ADD `payout_kind` text NOT NULL;