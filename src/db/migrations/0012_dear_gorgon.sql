CREATE VIEW `go_wallet_balance_view` AS
SELECT user_id, currency_code, COALESCE(SUM(amount), 0) AS balance
FROM `go_wallet_transactions`
GROUP BY user_id, currency_code;