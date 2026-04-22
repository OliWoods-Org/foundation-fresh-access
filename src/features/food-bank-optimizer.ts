/**
 * Food Bank Optimizer — Match surplus donations to highest-need locations.
 * @module food-bank-optimizer
 * @license GPL-3.0
 * @author OliWoods Foundation
 */
import { z } from 'zod';

export const DonationSchema = z.object({
  id: z.string().uuid(), donorName: z.string(), foodType: z.enum(['produce', 'dairy', 'protein', 'grains', 'canned', 'frozen', 'prepared', 'mixed']),
  weightLbs: z.number().positive(), expiresAt: z.string().datetime(), pickupLocation: z.object({ lat: z.number(), lng: z.number(), address: z.string() }),
  availableUntil: z.string().datetime(), requiresRefrigeration: z.boolean(),
});

export const DistributionSiteSchema = z.object({
  id: z.string().uuid(), name: z.string(), address: z.object({ lat: z.number(), lng: z.number(), address: z.string() }),
  weeklyDemandLbs: z.number().positive(), currentInventoryLbs: z.number().nonnegative(),
  hasRefrigeration: z.boolean(), servesPopulation: z.number().int().positive(),
  foodDesertScore: z.number().min(0).max(100),
});

export const MatchResultSchema = z.object({
  donationId: z.string().uuid(), siteId: z.string().uuid(), siteName: z.string(),
  distanceMiles: z.number(), needScore: z.number().min(0).max(100),
  logisticsNotes: z.array(z.string()),
});

export type Donation = z.infer<typeof DonationSchema>;
export type DistributionSite = z.infer<typeof DistributionSiteSchema>;
export type MatchResult = z.infer<typeof MatchResultSchema>;

export function matchDonationsToSites(donations: Donation[], sites: DistributionSite[], maxDistanceMiles = 30): MatchResult[] {
  const results: MatchResult[] = [];
  for (const donation of donations) {
    const candidates = sites
      .filter(s => !donation.requiresRefrigeration || s.hasRefrigeration)
      .map(s => {
        const dist = haversine(donation.pickupLocation.lat, donation.pickupLocation.lng, s.address.lat, s.address.lng);
        const inventoryGap = Math.max(0, s.weeklyDemandLbs - s.currentInventoryLbs);
        const needScore = Math.min(100, Math.round((inventoryGap / s.weeklyDemandLbs) * 50 + s.foodDesertScore * 0.5));
        return { site: s, dist, needScore };
      })
      .filter(c => c.dist <= maxDistanceMiles)
      .sort((a, b) => b.needScore - a.needScore || a.dist - b.dist);

    if (candidates.length > 0) {
      const best = candidates[0];
      const notes: string[] = [];
      const hoursUntilExpiry = (new Date(donation.expiresAt).getTime() - Date.now()) / 3600000;
      if (hoursUntilExpiry < 24) notes.push('URGENT: Expires within 24 hours');
      if (donation.requiresRefrigeration) notes.push('Requires refrigerated transport');
      if (best.dist > 15) notes.push(`Long distance: ${Math.round(best.dist)} miles`);
      results.push(MatchResultSchema.parse({
        donationId: donation.id, siteId: best.site.id, siteName: best.site.name,
        distanceMiles: Math.round(best.dist * 10) / 10, needScore: best.needScore, logisticsNotes: notes,
      }));
    }
  }
  return results.sort((a, b) => b.needScore - a.needScore);
}

export function calculateFoodWasteMetrics(donations: Donation[], matched: MatchResult[]): {
  totalDonatedLbs: number; totalMatchedLbs: number; wastePreventedLbs: number; matchRate: number; mealsProvided: number;
} {
  const matchedIds = new Set(matched.map(m => m.donationId));
  const totalLbs = donations.reduce((s, d) => s + d.weightLbs, 0);
  const matchedLbs = donations.filter(d => matchedIds.has(d.id)).reduce((s, d) => s + d.weightLbs, 0);
  return {
    totalDonatedLbs: Math.round(totalLbs),
    totalMatchedLbs: Math.round(matchedLbs),
    wastePreventedLbs: Math.round(matchedLbs),
    matchRate: totalLbs > 0 ? Math.round((matchedLbs / totalLbs) * 100) : 0,
    mealsProvided: Math.round(matchedLbs / 1.2), // ~1.2 lbs per meal
  };
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; const dLat = (lat2 - lat1) * Math.PI / 180; const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
