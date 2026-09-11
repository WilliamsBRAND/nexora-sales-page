// NEXORA payment config endpoint.
// Returns only NON-SECRET values the browser needs to open the Paystack popup.
export default function handler(req, res) {
  const publicKey = process.env.PAYSTACK_PUBLIC_KEY || "";
  const amount = process.env.PAYSTACK_AMOUNT_KOBO || "517500";
  const currency = process.env.PAYSTACK_CURRENCY || "NGN";
  const priceNaira = process.env.PAYSTACK_PRICE_NAIRA || "5,175";

  if (!publicKey) {
    return res.status(500).json({
      error: "Paystack public key is not configured yet.",
      ok: false,
    });
  }

  return res.status(200).json({
    ok: true,
    publicKey,
    amount,
    currency,
    priceNaira,
  });
}
