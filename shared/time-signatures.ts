export const TIME_DENOMINATORS = [1, 2, 4, 8, 16, 32, 64] as const;
export const COMMON_TIME_SIGNATURES = [[4,4],[3,4],[2,4],[6,8],[3,8],[2,2],[6,4],[9,8],[12,8],[5,4]] as const;
export function timeSignatureComplete(label: { numerator?: unknown; denominator?: unknown } | null | undefined): boolean {
  return !!label && Number.isInteger(label.numerator) && Number(label.numerator) >= 1 && Number(label.numerator) <= 32 &&
    (TIME_DENOMINATORS as readonly unknown[]).includes(label.denominator);
}