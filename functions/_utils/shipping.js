export const SHIPPING_COUNTRIES = {
  UK: ["GB"],

  EUROPE: [
    "BE", // Belgium
    "DK", // Denmark
    "FI", // Finland
    "FR", // France
    "DE", // Germany
    "IE", // Ireland
    "IT", // Italy
    "NL", // Netherlands
    "NO", // Norway
    "PL", // Poland
    "PT", // Portugal
    "ES", // Spain
    "SE", // Sweden
    "CH", // Switzerland
  ],

  INTERNATIONAL: [
    "AU", // Australia
    "CA", // Canada
    "HK", // Hong Kong
    "IL", // Israel
    "JP", // Japan
    "NZ", // New Zealand
    "SG", // Singapore
    "AE", // UAE
    "US", // USA
  ],
};

export const ALLOWED_COUNTRIES = [
  ...SHIPPING_COUNTRIES.UK,
  ...SHIPPING_COUNTRIES.EUROPE,
  ...SHIPPING_COUNTRIES.INTERNATIONAL,
];

export function shippingRateIdForCountry(countryCode, env) {
  const country = String(countryCode || "").toUpperCase();

  if (SHIPPING_COUNTRIES.UK.includes(country)) return env.STRIPE_SHIPPING_RATE_UK;
  if (SHIPPING_COUNTRIES.EUROPE.includes(country)) return env.STRIPE_SHIPPING_RATE_EUROPE;
  if (SHIPPING_COUNTRIES.INTERNATIONAL.includes(country)) return env.STRIPE_SHIPPING_RATE_INTERNATIONAL;

  return null;
}
