/**
 * Packages never hold user-facing sentences: they emit a message key plus parameters, and the
 * app translates them. zod only carries strings, so a message travels through it as JSON.
 */
export interface Message {
	key: string;
	params?: Record<string, string | number | boolean | null>;
}

const PREFIX = "\u0001msg:";

export function msg(key: string, params?: Message["params"]): string {
	return `${PREFIX}${JSON.stringify(params ? { key, params } : { key })}`;
}

/** Turns a zod issue message back into a Message; foreign strings become `validation.generic`. */
export function decodeMessage(text: string): Message {
	if (text.startsWith(PREFIX)) {
		try {
			return JSON.parse(text.slice(PREFIX.length)) as Message;
		} catch {
			// fall through
		}
	}
	return { key: "validation.generic", params: { detail: text } };
}
