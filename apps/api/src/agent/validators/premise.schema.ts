import { z } from 'zod';

export const premiseDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    premise: z.string().trim().min(1).max(2_000),
    synopsis: z.string().trim().min(1).max(8_000),
    theme: z.string().trim().min(1).max(1_000),
  })
  .strict();

export type PremiseDraft = z.infer<typeof premiseDraftSchema>;

export function validationIssues(value: unknown) {
  const result = premiseDraftSchema.safeParse(value);
  if (result.success) return { valid: true as const, draft: result.data, issues: [] };
  return {
    valid: false as const,
    issues: result.error.issues.map((issue) => ({
      path: Array.isArray(issue.path) ? issue.path.join('.') : '',
      message: issue.message,
    })),
  };
}
