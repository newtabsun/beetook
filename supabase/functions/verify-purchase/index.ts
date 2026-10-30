import { handle } from '../_shared/wallet_payments.ts';

Deno.serve((req) => handle('verify-purchase', req));
