// Pure Go Live rule, shared by the app and the tests: VIP members may go live, and so may any account with
// at least 1000 followers even without VIP. Marketplace access and profile edits are free for everybody.
export const LIVE_FREE_FOLLOWERS = 1000;

export const liveAllowed = (isVip: boolean, followers: number | null | undefined): boolean =>
  isVip || Number(followers ?? 0) >= LIVE_FREE_FOLLOWERS;

export const LIVE_DENIED_MESSAGE =
  `Going live needs VIP, or at least ${LIVE_FREE_FOLLOWERS.toLocaleString('en-US')} followers. Profile → Menu → VIP.`;
