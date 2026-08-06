// Predefined sponsor business categories.
//
// Campaigns sharing a category are never scheduled into the same break —
// see the conflict-avoidance logic in app/api/campaigns/generate/route.ts.
//
// To add, remove, or rename a category: just edit this list. Renaming a
// category here does NOT update existing campaigns already saved with the
// old name — it only changes what's offered in the dropdown going forward.
export const BUSINESS_CATEGORIES: string[] = [
  "Car Dealership",
  "Furniture Manufacturer",
  "Real Estate Agency",
  "Hardware Store",
  "Restaurant / Cafe",
  "Medical / Health Services",
  "Legal Services",
  "Financial Services",
  "Insurance",
  "Home & Garden",
  "Automotive Services",
  "Retail",
  "Trade Services",
  "Education",
  "Government",
  "REGFM - Station Promo",
  "REGFM - Community Service Announcement",
]
