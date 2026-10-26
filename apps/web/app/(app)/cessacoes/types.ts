import type { SettlementItem, TerminationReason } from '@kianda/core';

export interface TerminationDetail {
  id: string; employeeId: string; reason: TerminationReason; reasonLabel: string; legal: string; status: string; effectiveDate: string; noticeDate: string | null; period: string;
  agreedCompensationMinor: number | null; items: SettlementItem[]; note: string | null; cancelNote: string | null; confirmedAt: string | null;
  proposal: { seniority: { label: string }; notice: { requiredDays: number; givenDays: number; missingDays: number }; notes: string[] };
  company: { name: string; nif: string; address: string | null };
  employee: { id: string; name: string; number: string; jobTitle: string; biNumber: string | null; nif: string | null; status: string };
  hireDate: string; pay: { baseMinor: number };
  totals: { earningsMinor: number; deductionsMinor: number };
  payslip: { lines: { code: string; name: string; kind: string; amountMinor: number }[]; netMinor: number } | null;
  warnings: string[];
}
