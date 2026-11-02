-- 053: new accounts start with 0 coins (the 5,000 free starting balance is removed). Existing wallets are untouched.
ALTER TABLE app_9e1318caf6_wallets ALTER COLUMN purchased_balance SET DEFAULT 0;
-- Make PostgREST see posts.partner_enabled (added in 052) immediately.
NOTIFY pgrst, 'reload schema';
