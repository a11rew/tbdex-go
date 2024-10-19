export function makeIDHumanReadable(id: string) {
	return (id[0] + id.slice(id.length - 4, id.length)).toUpperCase();
}

// Returns date in format HH:MM, DD MMM YYYY
export function formatDate(date: Date | string) {
	const dateObj = typeof date === 'string' ? new Date(date) : date;

	return (
		dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) +
		', ' +
		dateObj.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
	);
}
