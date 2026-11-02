// Money is stored in minor units (centavos); dates are ISO YYYY-MM-DD in the user's timezone.

/** Positive decimal amount from the model → minor units, or null if not a valid amount. */
export function toMinor(amount: number): number | null {
	if (!Number.isFinite(amount) || amount < 0) return null;
	const minor = Math.round(amount * 100);
	return Math.abs(minor - amount * 100) < 1e-6 ? minor : null;
}

const moneyFormats = new Map<string, Intl.NumberFormat>();

/** "₱4,750", or "₱4,750.50" when there are centavos. */
export function money(minor: number, currency: string): string {
	const whole = minor % 100 === 0;
	const key = `${currency}:${whole}`;
	let format = moneyFormats.get(key);
	if (!format) {
		format = new Intl.NumberFormat("en", {
			style: "currency",
			currency,
			currencyDisplay: "narrowSymbol",
			minimumFractionDigits: whole ? 0 : 2,
			maximumFractionDigits: 2,
		});
		moneyFormats.set(key, format);
	}
	return format.format(minor / 100);
}

export function todayIn(timezone: string, now = new Date()): string {
	return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

export function isIsoDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

const dayFormat = new Intl.DateTimeFormat("en-GB", {
	timeZone: "UTC",
	weekday: "short",
	day: "numeric",
	month: "short",
});

/** "2026-11-01" → "Sun 1 Nov" */
export function day(iso: string): string {
	return dayFormat.format(new Date(`${iso}T00:00:00Z`)).replace(",", "");
}

export function isTimezone(value: string): boolean {
	try {
		new Intl.DateTimeFormat("en", { timeZone: value });
		return true;
	} catch {
		return false;
	}
}

export function addDays(iso: string, days: number): string {
	const date = new Date(`${iso}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/** "2026-10-22", "2026-10-31" → "22–31 Oct"; across months "28 Sep–3 Oct". */
export function period(start: string, end: string): string {
	if (start === end) return day(start);
	const [, , a] = day(start).split(" ");
	const [, d2, b] = day(end).split(" ");
	const d1 = String(Number(start.slice(8)));
	return a === b ? `${d1}–${d2} ${b}` : `${d1} ${a}–${d2} ${b}`;
}
