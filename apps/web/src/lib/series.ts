/** Server identity color by round-robin position. Color follows the server, never its rank. */
export function serverColor(index: number): string {
	return `var(--series-${(index % 8) + 1})`;
}
