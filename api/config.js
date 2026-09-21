// NEXORA payment config endpoint.
// Returns only NON-SECRET values the browser needs to open the Paystack popup.

// Offer matrix supporting multiple pricing tiers for the same product
const OFFERS = {
  "partner": { amount: "760000", priceNaira: "7,600" },
  "marketplace": { amount: "760000", priceNaira: "7,600" },
  "bday": { amount: "517800", priceNaira: "5,178" },
  "nexora": { amount: "517800", priceNaira: "5,178" },
  "promo": { amount: "517800", priceNaira: "5,178" },
  "regular": { amount: "760000", priceNaira: "7,600" }
};

export default function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pp = url.searchParams.get("pp") || url.searchParams.get("partner") || url.searchParams.get("ref") || "";
  let offer = url.searchParams.get("offer") || url.searchParams.get("tier") || "nexora";

  // When a partner referral code is present, use standard partner marketplace price (₦7,600)
  if (pp || offer === "partner" || offer === "marketplace") {
    offer = "partner";
  }

  const offerConfig = OFFERS[offer] || OFFERS["nexora"];

  const publicKey = process.env.PAYSTACK_PUBLIC_KEY || "";
  const amount = offerConfig.amount;
  const currency = process.env.PAYSTACK_CURRENCY || "NGN";
  const priceNaira = offerConfig.priceNaira;

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
    offer,
    discountPercent: offerConfig.discountPercent || 0,
    originalPriceNaira: offerConfig.originalPriceNaira || priceNaira,
    partnerCode: pp || null,
  });
}

