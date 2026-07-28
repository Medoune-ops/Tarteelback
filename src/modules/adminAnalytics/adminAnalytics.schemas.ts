import { z } from 'zod';

/** GET /backoffice/analytics/signups-timeseries?days=30 */
export const signupsTimeseriesQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(365).default(30),
  })
  .strict();

export type SignupsTimeseriesQuery = z.infer<typeof signupsTimeseriesQuerySchema>;

/** GET /backoffice/analytics/requests-timeseries?days=30 */
export const requestsTimeseriesQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(365).default(30),
  })
  .strict();

export type RequestsTimeseriesQuery = z.infer<typeof requestsTimeseriesQuerySchema>;

/** GET /backoffice/analytics/requests-monthly?months=12 */
export const requestsMonthlyQuerySchema = z
  .object({
    months: z.coerce.number().int().min(1).max(36).default(12),
  })
  .strict();

export type RequestsMonthlyQuery = z.infer<typeof requestsMonthlyQuerySchema>;

/** GET /backoffice/analytics/top-streaks?limit=5 */
export const topStreaksQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(5),
  })
  .strict();

export type TopStreaksQuery = z.infer<typeof topStreaksQuerySchema>;
