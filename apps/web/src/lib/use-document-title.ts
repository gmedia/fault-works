import { useEffect } from "react";

/** Unique, descriptive page titles (WCAG 2.4.2) for a client-rendered app. */
export function useDocumentTitle(title: string | null) {
	useEffect(() => {
		document.title = title ? `${title} · FaultWorks` : "FaultWorks";
	}, [title]);
}
