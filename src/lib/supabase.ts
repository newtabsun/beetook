import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://klxynisbmxqmyszkdrxj.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtseHluaXNibXhxbXlzemtkcnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2NzY1NDEsImV4cCI6MjEwNjI1MjU0MX0.H0IUgSBYKptEpHfkbNDD-vjawlgtJAYjRqMjoOJFCZI';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

const P = 'app_9e1318caf6_';
export const T = {
  profiles: `${P}profiles`, posts: `${P}posts`, likes: `${P}likes`, saves: `${P}saves`,
  comments: `${P}comments`, live: `${P}live_rooms`, wagers: `${P}wagers`,
  messages: `${P}messages`, messageHides: `${P}message_hides`, notifications: `${P}notifications`, groups: `${P}groups`,
  groupMembers: `${P}group_members`, market: `${P}market_items`, follows: `${P}follows`, views: `${P}post_views`, shares: `${P}shares`,
  gifts: `${P}gifts`, giftCatalog: `${P}gift_catalog`, boosts: `${P}boosts`, boostCampaigns: `${P}boost_campaigns`, reports: `${P}reports`, liveEvents: `${P}live_events`, liveSeats: `${P}live_seats`, liveViewers: `${P}live_viewers`,
  groupMessages: `${P}group_messages`, groupEarnings: `${P}group_earnings`, marketOrders: `${P}market_orders`, marketBalances: `${P}market_balances`, sounds: `${P}sounds`,
} as const;
export const RPC = {
  wallet: `${P}get_wallet`, race: `${P}place_race_wager`, gift: `${P}send_gift`, boost: `${P}boost_post`,
  grpCreate: `${P}grp_create`, grpUpdate: `${P}grp_update`, grpJoin: `${P}grp_join`, grpSend: `${P}grp_send`, grpComments: `${P}grp_set_comments`,
  grpEdit: `${P}grp_msg_edit`, grpDel: `${P}grp_msg_delete`, grpReact: `${P}grp_react`, grpUnread: `${P}grp_unread`, grpRead: `${P}grp_mark_read`,
  grpPin: `${P}grp_pin`, grpUnpin: `${P}grp_unpin`, grpFind: `${P}grp_find_user`, grpReplace: `${P}grp_replace_owner`, grpAddOwner: `${P}grp_add_owner`, grpRemoveOwner: `${P}grp_remove_owner`, grpDelete: `${P}grp_delete`,
  mktBalance: `${P}mkt_balance`, mktTransfer: `${P}mkt_transfer`, mktRequest: `${P}mkt_request`, mktAct: `${P}mkt_act`,
  unread: `${P}unread_counts`, markAll: `${P}mark_all_read`,
  mktInquiry: `${P}market_inquiry`, mktTimers: `${P}mkt_timers`, mktDelete: `${P}mkt_delete_item`, mktRating: `${P}mkt_seller_rating`, ensureSound: `${P}ensure_sound`,
} as const;
export const BUCKET = `${P}media`;
