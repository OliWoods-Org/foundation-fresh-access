/**
 * SNAP Screener — Eligibility checker and application assistant.
 * @module snap-screener
 * @license GPL-3.0
 * @author OliWoods Foundation
 */
import { z } from 'zod';

export const HouseholdSchema = z.object({
  size: z.number().int().positive(),
  monthlyGrossIncome: z.number().nonnegative(),
  monthlyNetIncome: z.number().nonnegative(),
  state: z.string(),
  hasElderly: z.boolean().default(false),
  hasDisabled: z.boolean().default(false),
  liquidAssets: z.number().nonnegative().default(0),
  monthlyRent: z.number().nonnegative().default(0),
  monthlyUtilities: z.number().nonnegative().default(0),
  dependentCareExpenses: z.number().nonnegative().default(0),
  medicalExpensesElderly: z.number().nonnegative().default(0),
  citizenshipStatus: z.enum(['citizen', 'legal-resident-5yr', 'legal-resident-under5', 'refugee', 'undocumented', 'mixed']),
});

export const EligibilityResultSchema = z.object({
  eligible: z.enum(['likely-eligible', 'possibly-eligible', 'likely-ineligible']),
  estimatedMonthlyBenefit: z.number().nonnegative(),
  maxMonthlyBenefit: z.number().nonnegative(),
  grossIncomeTest: z.object({ passed: z.boolean(), income: z.number(), limit: z.number() }),
  netIncomeTest: z.object({ passed: z.boolean(), income: z.number(), limit: z.number() }),
  assetTest: z.object({ passed: z.boolean(), assets: z.number(), limit: z.number() }),
  additionalPrograms: z.array(z.object({ name: z.string(), description: z.string(), likelyEligible: z.boolean() })),
  nextSteps: z.array(z.string()),
  disclaimer: z.string(),
});

export const MealPlanSchema = z.object({
  weeklyBudget: z.number().positive(),
  householdSize: z.number().int().positive(),
  days: z.array(z.object({
    day: z.string(),
    meals: z.array(z.object({ meal: z.string(), items: z.array(z.string()), estimatedCost: z.number() })),
    dailyCost: z.number(),
  })),
  totalWeeklyCost: z.number(),
  nutritionScore: z.number().min(0).max(100),
  tips: z.array(z.string()),
});

export type Household = z.infer<typeof HouseholdSchema>;
export type EligibilityResult = z.infer<typeof EligibilityResultSchema>;
export type MealPlan = z.infer<typeof MealPlanSchema>;

// Federal poverty guidelines 2026 (approximate)
const FPL_2026: Record<number, number> = { 1: 1580, 2: 2137, 3: 2694, 4: 3250, 5: 3807, 6: 4364, 7: 4921, 8: 5478 };
const SNAP_MAX_ALLOTMENT: Record<number, number> = { 1: 292, 2: 536, 3: 768, 4: 975, 5: 1158, 6: 1390, 7: 1536, 8: 1756 };
const ASSET_LIMIT = 2750;
const ASSET_LIMIT_ELDERLY = 4250;

export function screenSNAPEligibility(household: Household): EligibilityResult {
  const size = Math.min(household.size, 8);
  const grossLimit = Math.round(FPL_2026[size] * 1.30);
  const netLimit = FPL_2026[size];
  const assetLimit = household.hasElderly || household.hasDisabled ? ASSET_LIMIT_ELDERLY : ASSET_LIMIT;
  const grossPassed = household.monthlyGrossIncome <= grossLimit || household.hasElderly || household.hasDisabled;
  const netPassed = household.monthlyNetIncome <= netLimit;
  const assetPassed = household.liquidAssets <= assetLimit;
  const allPassed = grossPassed && netPassed && assetPassed;
  const maxBenefit = SNAP_MAX_ALLOTMENT[size] || SNAP_MAX_ALLOTMENT[8];
  const estimatedBenefit = allPassed ? Math.max(0, maxBenefit - Math.round(household.monthlyNetIncome * 0.3)) : 0;

  const additionalPrograms = [
    { name: 'WIC', description: 'Women, Infants & Children nutrition program', likelyEligible: household.monthlyGrossIncome <= grossLimit },
    { name: 'LIHEAP', description: 'Low Income Home Energy Assistance', likelyEligible: household.monthlyGrossIncome <= grossLimit * 1.15 },
    { name: 'School Meals', description: 'Free/reduced school breakfast and lunch', likelyEligible: household.monthlyGrossIncome <= grossLimit },
    { name: 'Medicaid', description: 'Health insurance for low-income households', likelyEligible: household.monthlyGrossIncome <= Math.round(FPL_2026[size] * 1.38) },
  ];

  return EligibilityResultSchema.parse({
    eligible: allPassed ? 'likely-eligible' : (grossPassed || netPassed) ? 'possibly-eligible' : 'likely-ineligible',
    estimatedMonthlyBenefit: Math.min(maxBenefit, Math.max(23, estimatedBenefit)),
    maxMonthlyBenefit: maxBenefit,
    grossIncomeTest: { passed: grossPassed, income: household.monthlyGrossIncome, limit: grossLimit },
    netIncomeTest: { passed: netPassed, income: household.monthlyNetIncome, limit: netLimit },
    assetTest: { passed: assetPassed, assets: household.liquidAssets, limit: assetLimit },
    additionalPrograms,
    nextSteps: allPassed ? [
      'Apply at your local SNAP office or online at your state\'s benefits portal',
      'Bring ID, proof of income, rent receipts, and utility bills',
      'You may receive expedited (7-day) benefits if income is very low',
      'Dial 211 for help with the application process',
    ] : [
      'Your income appears above standard limits, but deductions may qualify you',
      'Contact your local SNAP office for a full eligibility determination',
      'Ask about categorical eligibility through TANF or SSI',
    ],
    disclaimer: 'This is a screening tool only. Actual eligibility is determined by your state SNAP agency. Apply even if this tool shows "possibly eligible" — many deductions are not captured here.',
  });
}

export function generateBudgetMealPlan(weeklyBudget: number, householdSize: number): MealPlan {
  const dailyBudget = weeklyBudget / 7;
  const perPersonDaily = dailyBudget / householdSize;
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const mealPlans = days.map(day => {
    const meals = [
      { meal: 'Breakfast', items: ['Oatmeal with banana', 'Toast with peanut butter'], estimatedCost: Math.round(perPersonDaily * 0.25 * householdSize * 100) / 100 },
      { meal: 'Lunch', items: ['Rice and beans with vegetables', 'Fruit'], estimatedCost: Math.round(perPersonDaily * 0.35 * householdSize * 100) / 100 },
      { meal: 'Dinner', items: ['Pasta with tomato sauce and frozen vegetables', 'Bread'], estimatedCost: Math.round(perPersonDaily * 0.40 * householdSize * 100) / 100 },
    ];
    return { day, meals, dailyCost: Math.round(dailyBudget * 100) / 100 };
  });
  return MealPlanSchema.parse({
    weeklyBudget, householdSize, days: mealPlans,
    totalWeeklyCost: weeklyBudget,
    nutritionScore: perPersonDaily >= 4 ? 70 : perPersonDaily >= 3 ? 55 : 40,
    tips: [
      'Buy in bulk: rice, beans, oats, and frozen vegetables are cheapest per serving',
      'Use the Double Up Food Bucks program at farmers markets for free produce',
      'Plan meals around weekly sales at your nearest SNAP-accepting store',
      'Cook large batches and freeze portions to reduce waste and save time',
    ],
  });
}
