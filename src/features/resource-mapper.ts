/**
 * Resource Mapper — Map every food resource within transit distance.
 * @module resource-mapper
 * @license GPL-3.0
 * @author OliWoods Foundation
 */
import { z } from 'zod';

export const FoodResourceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.enum(['grocery', 'food-bank', 'community-garden', 'farmers-market', 'free-meal-site', 'food-pantry', 'wic-vendor', 'snap-retailer', 'mobile-market']),
  address: z.object({ street: z.string(), city: z.string(), state: z.string(), zip: z.string(), lat: z.number(), lng: z.number() }),
  acceptsSNAP: z.boolean(),
  acceptsWIC: z.boolean(),
  acceptsDoubleUp: z.boolean().default(false),
  hours: z.array(z.object({ day: z.string(), open: z.string(), close: z.string() })),
  phone: z.string().optional(),
  website: z.string().url().optional(),
  transitAccessible: z.boolean(),
  freshProduceAvailable: z.boolean(),
  lastVerified: z.string().datetime(),
});

export const FoodDesertAnalysisSchema = z.object({
  censusTrack: z.string(),
  isDesert: z.boolean(),
  population: z.number().int(),
  nearestGroceryMiles: z.number(),
  groceriesWithin1Mile: z.number().int(),
  groceriesWithin5Miles: z.number().int(),
  snapRetailersNearby: z.number().int(),
  foodBanksNearby: z.number().int(),
  medianIncome: z.number(),
  vehicleAccessPercent: z.number(),
  transitScore: z.number().min(0).max(100),
  recommendations: z.array(z.string()),
});

export type FoodResource = z.infer<typeof FoodResourceSchema>;
export type FoodDesertAnalysis = z.infer<typeof FoodDesertAnalysisSchema>;

export function findNearbyResources(
  location: { lat: number; lng: number },
  resources: FoodResource[],
  radiusMiles: number = 5,
  filters?: { acceptsSNAP?: boolean; acceptsWIC?: boolean; types?: string[] },
): Array<FoodResource & { distanceMiles: number }> {
  return resources
    .map(r => ({ ...r, distanceMiles: haversine(location.lat, location.lng, r.address.lat, r.address.lng) }))
    .filter(r => r.distanceMiles <= radiusMiles)
    .filter(r => !filters?.acceptsSNAP || r.acceptsSNAP)
    .filter(r => !filters?.acceptsWIC || r.acceptsWIC)
    .filter(r => !filters?.types || filters.types.includes(r.type))
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

export function analyzeFoodDesert(
  tract: { id: string; population: number; medianIncome: number; vehicleAccessPercent: number },
  resources: FoodResource[],
  tractCenter: { lat: number; lng: number },
): FoodDesertAnalysis {
  const distances = resources.filter(r => r.type === 'grocery').map(r => haversine(tractCenter.lat, tractCenter.lng, r.address.lat, r.address.lng));
  const nearest = distances.length > 0 ? Math.min(...distances) : 99;
  const within1 = distances.filter(d => d <= 1).length;
  const within5 = distances.filter(d => d <= 5).length;
  const snapNearby = resources.filter(r => r.acceptsSNAP && haversine(tractCenter.lat, tractCenter.lng, r.address.lat, r.address.lng) <= 5).length;
  const foodBanks = resources.filter(r => ['food-bank', 'food-pantry'].includes(r.type) && haversine(tractCenter.lat, tractCenter.lng, r.address.lat, r.address.lng) <= 10).length;
  const isDesert = (nearest > 1 && tract.vehicleAccessPercent < 50) || (nearest > 10);
  const transitScore = Math.min(100, tract.vehicleAccessPercent + within1 * 20);
  const recommendations: string[] = [];
  if (isDesert) recommendations.push('Apply for USDA Healthy Food Financing Initiative funding');
  if (snapNearby < 3) recommendations.push('Advocate for additional SNAP-authorized retailers in the area');
  if (foodBanks === 0) recommendations.push('Contact Feeding America for mobile food bank deployment');
  if (tract.vehicleAccessPercent < 30) recommendations.push('Explore SNAP online purchasing and delivery options (DoorDash, Instacart)');
  return FoodDesertAnalysisSchema.parse({
    censusTrack: tract.id, isDesert, population: tract.population, nearestGroceryMiles: Math.round(nearest * 10) / 10,
    groceriesWithin1Mile: within1, groceriesWithin5Miles: within5, snapRetailersNearby: snapNearby,
    foodBanksNearby: foodBanks, medianIncome: tract.medianIncome, vehicleAccessPercent: tract.vehicleAccessPercent,
    transitScore, recommendations,
  });
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; const dLat = (lat2 - lat1) * Math.PI / 180; const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
