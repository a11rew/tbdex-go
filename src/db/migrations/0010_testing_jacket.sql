CREATE VIEW go_credit_balance_view AS
SELECT user_id, COALESCE(SUM(amount), 0) AS balance
FROM go_credit_transactions
GROUP BY user_id;