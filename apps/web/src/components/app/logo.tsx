/** Mark: a load balancer routing to two backends, one of them failed (open ring, broken link). */
export function LogoMark({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 32 32" className={className} aria-hidden="true">
			<rect width="32" height="32" rx="7" fill="currentColor" />
			<g
				fill="none"
				stroke="var(--background)"
				strokeWidth="2.4"
				strokeLinecap="round"
			>
				<path d="M9 16h6M17 16l6-6M17 16l2 2" />
			</g>
			<circle cx="9" cy="16" r="2.6" fill="var(--background)" />
			<circle cx="23" cy="10" r="2.6" fill="var(--background)" />
			<circle
				cx="23"
				cy="22"
				r="2.6"
				fill="none"
				stroke="var(--gap-band)"
				strokeWidth="2"
			/>
		</svg>
	);
}
