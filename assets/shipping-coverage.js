/* Bev Connect shipping coverage — shared across all brand portals.
 *
 * SINGLE SOURCE OF TRUTH. When carrier coverage changes, update this file
 * and push it to every portal repo. Nothing brand-specific belongs here.
 *
 * Effective August 2026. Origin: Ventura, CA.
 * Retailer of record: Go-To Gifting LLC.
 */
export const COVERAGE = {
  effective: "August 2026",

  // Never served, either category.
  notServed: ["AR", "DE", "MS", "UT"],

  // Spirits only: reachable on a second carrier account, held pending
  // confirmation. Beer/wine ship to these normally.
  spiritsUnderReview: ["ME", "MI", "NJ", "RI", "SD", "VT"],

  categories: {
    beer: {
      label: "Beer, wine, and malt- or wine-based canned cocktails",
      short: "Beer and wine",
      count: "46 states and DC"
    },
    spirits: {
      label: "Spirits and spirits-based canned cocktails",
      short: "Spirits",
      count: "40 states and DC"
    }
  },

  // Tile-grid coordinates [row, column] on an 11-column grid.
  grid: {
    AK: [1, 1],  ME: [1, 11],
    VT: [2, 10], NH: [2, 11],
    WA: [3, 1],  ID: [3, 2],  MT: [3, 3],  ND: [3, 4],  MN: [3, 5],  IL: [3, 6],
    WI: [3, 7],  MI: [3, 8],  NY: [3, 9],  CT: [3, 10], MA: [3, 11],
    OR: [4, 1],  NV: [4, 2],  WY: [4, 3],  SD: [4, 4],  IA: [4, 5],  IN: [4, 6],
    OH: [4, 7],  PA: [4, 8],  NJ: [4, 9],  RI: [4, 10],
    CA: [5, 1],  UT: [5, 2],  CO: [5, 3],  NE: [5, 4],  MO: [5, 5],  KY: [5, 6],
    WV: [5, 7],  VA: [5, 8],  MD: [5, 9],  DE: [5, 10],
    AZ: [6, 2],  NM: [6, 3],  KS: [6, 4],  AR: [6, 5],  TN: [6, 6],  NC: [6, 7],
    SC: [6, 8],  DC: [6, 9],
    OK: [7, 4],  LA: [7, 5],  MS: [7, 6],  AL: [7, 7],  GA: [7, 8],
    HI: [8, 1],  TX: [8, 4],  FL: [8, 9]
  },

  names: {
    AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
    CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "Washington, D.C.",
    FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
    IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
    ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
    MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
    NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
    NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
    OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
    RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
    TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
    WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming"
  },

  /* Returns "ships" | "review" | "no" for a state in a given category. */
  status: function (code, category) {
    if (this.notServed.indexOf(code) !== -1) return "no";
    if (category === "spirits" && this.spiritsUnderReview.indexOf(code) !== -1) return "review";
    return "ships";
  }
};
