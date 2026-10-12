/** Saves text as a file through a temporary object URL. Nothing leaves the browser. */
export function downloadText(
	filename: string,
	text: string,
	type = "application/json",
) {
	const blob = new Blob([text], { type: `${type};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
