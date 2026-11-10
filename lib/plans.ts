// One place for what each plan includes, used both by the limits the app
// enforces and by the checkout page that describes them.

export const PLANS = {
  free: {
    name: "Free",
    taskLimit: 5, // active assignments at a time
    dailyQuickAdds: 20, // AI reads per day for "Just type it"
  },
  premium: {
    name: "Selfwind Premium",
    priceUsd: 15,
    interval: "month",
    taskLimit: Infinity,
    dailyQuickAdds: 100,
  },
} as const;

/**
 * Flip to true once payments are connected (e.g. a Stripe Checkout session
 * created by a server action, which redirects to Stripe's hosted page and
 * sets users.has_paid from a webhook). Until then the checkout button is
 * shown but disabled, and nobody can be charged.
 */
export const CHECKOUT_ENABLED = false;

export const formatPrice = (usd: number) => `$${usd.toFixed(2)}`;
