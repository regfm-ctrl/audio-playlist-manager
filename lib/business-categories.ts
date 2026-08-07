// Predefined sponsor business categories.
//
// Campaigns sharing a category are never scheduled into the same break —
// see the conflict-avoidance logic in app/api/campaigns/generate/route.ts.
//
// To add, remove, or rename a category: just edit this list. Renaming a
// category here does NOT update existing campaigns already saved with the
// old name — it only changes what's offered in the dropdown going forward.
export const BUSINESS_CATEGORIES: string[] = [
  "Automotive Services",
  "Boats & Marine",
  "Car Dealership",
  "Clothing & Fashion",
  "Computers & IT",
  "Education",
  "Financial Services",
  "Furniture Manufacturer",
  "Garden",
  "Government",
  "Hardware Store",
  "Health Services",
  "Heating",
  "Home Interior",
  "Insurance",
  "Jewellery",
  "Legal Services",
  "Medical / Health Services",
  "Real Estate Agency",
  "Restaurant / Cafe",
  "Retirement",
  "Retail",
  "Trade Services",
  "Tyre Services",
  "Travel",
  "REGFM - Community Service Announcement",
  "REGFM - Station Promo",
]
