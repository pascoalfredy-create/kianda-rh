export interface PersonnelOverview {
  active: number; fixedTerm: number; interns: number;
  financial: { period: string; grossMinor: number; costMinor: number; irtMinor: number; inssMinor: number; source: string; packVersion: string | null } | null;
  birthdays: { id: string; name: string; date: string }[];
  departments: { id: string | null; name: string; costCenter: string; headcount: number; costMinor: number | null }[];
  locations: { name: string; headcount: number; costMinor: number }[];
  demographics: { women: number; men: number; unspecified: number; avgTenureYears: number | null; medianBaseMinor: number | null; salaryRatio: number | null } | null;
}
export interface PersonnelCash {
  plan: { period: string; openingMinor: number; receipts: Record<string, number>; revision: number };
  months: { period: string; openingMinor: number; receiptsMinor: number; salariesMinor: number; irtMinor: number; inssMinor: number; expensesMinor: number; closingMinor: number; estimated: boolean; overdueMinor: number }[];
  minimumMinor: number; closingMinor: number; warnings: string[]; holidayMonth: number; canProject: boolean;
}
