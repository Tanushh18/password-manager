export interface BankSms { address: string; body: string; date: number }
export const smsSupported: boolean;
export function hasPermission(): boolean;
export function requestPermission(): Promise<boolean>;
export function readBankSms(options: { sinceMs: number; limit?: number; match?: string }): Promise<BankSms[]>;
export function getNewestBankSmsDate(match?: string): number | null;
export function getLastArrival(): number;
export function hasNewSince(lastSeenMs: number): boolean;
export function setArrivalMatch(match: string): void;
