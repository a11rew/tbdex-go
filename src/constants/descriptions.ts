export const currencyDescriptions = {
	USD: 'US Dollar',
	USDC: 'US Dollar Coin',
	EUR: 'Euro',
	KES: 'Kenyan Shilling',
	GBP: 'British Pound',
	BTC: 'Bitcoin',
	AUD: 'Australian Dollar',
	MXN: 'Mexican Peso',
	GHS: 'Ghanaian Cedi',
	NGN: 'Nigerian Naira',
} as Record<string, string>;

export function makeHumanReadablePaymentMethod(method: string) {
	const segments = method.split('_');

	if (!Object.keys(currencyDescriptions).includes(segments[0])) {
		// We don't know about this currency
		return method;
	}

	return `${currencyDescriptions[segments[0]]} ${toTitleCase(segments.slice(1).join(' '))}`;
}

export function toTitleCase(str: string) {
	return str.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}
