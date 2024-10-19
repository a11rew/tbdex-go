export function makeIDHumanReadable(id: string) {
	return (id[0] + id.slice(id.length - 4, id.length)).toUpperCase();
}
