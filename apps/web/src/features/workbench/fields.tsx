import type { FieldInfo } from "@faultworks/experiment";
import { CircleAlert } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select.tsx";
import { Switch } from "#/components/ui/switch.tsx";
import { cn } from "#/lib/utils.ts";

interface FieldShellProps {
	id: string;
	label: string;
	help?: string;
	hint?: ReactNode;
	errors?: string[];
	children: ReactNode;
	inline?: boolean;
}

function FieldShell({
	id,
	label,
	help,
	hint,
	errors,
	children,
	inline,
}: FieldShellProps) {
	const helpId = `${id}-help`;
	const errorId = `${id}-error`;
	return (
		<div
			className={cn(
				"grid gap-1.5",
				inline && "grid-cols-[1fr_auto] items-center gap-x-3",
			)}
		>
			<Label htmlFor={id} className="font-medium text-sm">
				{label}
			</Label>
			{children}
			{(help || hint) && (
				<p
					id={helpId}
					className={cn(
						"text-muted-foreground text-xs",
						inline && "col-span-2",
					)}
				>
					{help}
					{hint && <span className="ml-1 font-mono">{hint}</span>}
				</p>
			)}
			{errors && errors.length > 0 && (
				<p
					id={errorId}
					className={cn(
						"flex items-start gap-1.5 text-down text-xs",
						inline && "col-span-2",
					)}
				>
					<CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
					<span>{errors.join(" ")}</span>
				</p>
			)}
		</div>
	);
}

function describedBy(id: string, help: boolean, errors?: string[]) {
	return (
		[help ? `${id}-help` : null, errors?.length ? `${id}-error` : null]
			.filter(Boolean)
			.join(" ") || undefined
	);
}

interface NumberFieldProps {
	info: Pick<FieldInfo, "label" | "unit" | "help">;
	value: number | null | undefined;
	onChange: (value: number | null) => void;
	errors?: string[];
	/** Allow clearing the field to `null` (e.g. "never recovers", "auto horizon"). */
	nullable?: boolean;
	nullLabel?: string;
	integer?: boolean;
	min?: number;
	step?: number;
	/** Show the value in seconds next to the unit for ms fields. */
	showSeconds?: boolean;
}

/**
 * Number input that keeps the user's draft text while they type ("", "1.", "-") and only
 * commits values that parse. Edits made elsewhere (undo, reset) replace the draft unless the
 * field is focused.
 */
export function NumberField({
	info,
	value,
	onChange,
	errors,
	nullable,
	nullLabel = "none",
	integer,
	min,
	step,
	showSeconds,
}: NumberFieldProps) {
	const id = useId();
	const [draft, setDraft] = useState(
		value === null || value === undefined ? "" : String(value),
	);
	const focused = useRef(false);
	const [localError, setLocalError] = useState<string | null>(null);

	useEffect(() => {
		if (!focused.current)
			setDraft(value === null || value === undefined ? "" : String(value));
	}, [value]);

	const commit = (text: string) => {
		const trimmed = text.trim().replace(",", ".");
		if (trimmed === "") {
			if (nullable) {
				setLocalError(null);
				onChange(null);
			} else
				setLocalError(`Enter a number${info.unit ? ` in ${info.unit}` : ""}.`);
			return;
		}
		const n = Number(trimmed);
		if (!Number.isFinite(n)) {
			setLocalError(`“${text}” is not a number.`);
			return;
		}
		if (integer && !Number.isInteger(n)) {
			setLocalError("Use a whole number.");
			return;
		}
		setLocalError(null);
		if (n !== value) onChange(n);
	};

	const allErrors = [...(localError ? [localError] : []), ...(errors ?? [])];
	const seconds =
		showSeconds && typeof value === "number" && value >= 1000
			? `(${(value / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 })} s)`
			: undefined;

	return (
		<FieldShell
			id={id}
			label={info.label}
			help={info.help}
			hint={seconds}
			errors={allErrors}
		>
			<div className="relative">
				<Input
					id={id}
					inputMode={integer ? "numeric" : "decimal"}
					value={draft}
					placeholder={nullable ? nullLabel : undefined}
					onFocus={() => {
						focused.current = true;
					}}
					onBlur={() => {
						focused.current = false;
						commit(draft);
					}}
					onChange={(e) => {
						setDraft(e.target.value);
						commit(e.target.value);
					}}
					onKeyDown={(e) => {
						if (e.key === "ArrowUp" || e.key === "ArrowDown") {
							e.preventDefault();
							const base = typeof value === "number" ? value : (min ?? 0);
							const delta =
								(step ?? 1) *
								(e.shiftKey ? 10 : 1) *
								(e.key === "ArrowUp" ? 1 : -1);
							const next = Math.max(
								min ?? Number.NEGATIVE_INFINITY,
								Number((base + delta).toFixed(6)),
							);
							setDraft(String(next));
							commit(String(next));
						}
					}}
					aria-invalid={allErrors.length > 0}
					aria-describedby={describedBy(
						id,
						Boolean(info.help || seconds),
						allErrors,
					)}
					className={cn("tabular pr-16", allErrors.length > 0 && "border-down")}
				/>
				{info.unit && (
					<span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground text-xs">
						{info.unit}
					</span>
				)}
			</div>
		</FieldShell>
	);
}

interface SelectFieldProps<T extends string> {
	info: Pick<FieldInfo, "label" | "help">;
	value: T;
	options: Record<T, string>;
	onChange: (value: T) => void;
	errors?: string[];
}

export function SelectField<T extends string>({
	info,
	value,
	options,
	onChange,
	errors,
}: SelectFieldProps<T>) {
	const id = useId();
	return (
		<FieldShell id={id} label={info.label} help={info.help} errors={errors}>
			<Select value={value} onValueChange={(v) => onChange(v as T)}>
				<SelectTrigger
					id={id}
					className="w-full"
					aria-describedby={describedBy(id, Boolean(info.help), errors)}
					aria-invalid={Boolean(errors?.length)}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{(Object.entries(options) as Array<[T, string]>).map(
						([key, label]) => (
							<SelectItem key={key} value={key}>
								{label}
							</SelectItem>
						),
					)}
				</SelectContent>
			</Select>
		</FieldShell>
	);
}

export function SwitchField({
	info,
	checked,
	onChange,
}: {
	info: Pick<FieldInfo, "label" | "help">;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	const id = useId();
	return (
		<FieldShell id={id} label={info.label} help={info.help} inline>
			<Switch
				id={id}
				checked={checked}
				onCheckedChange={onChange}
				aria-describedby={info.help ? `${id}-help` : undefined}
			/>
		</FieldShell>
	);
}

export function TextField({
	label,
	value,
	onChange,
	multiline,
	help,
	errors,
	maxLength,
	placeholder,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	multiline?: boolean;
	help?: string;
	errors?: string[];
	maxLength?: number;
	placeholder?: string;
}) {
	const id = useId();
	const shared = {
		id,
		value,
		maxLength,
		placeholder,
		"aria-invalid": Boolean(errors?.length),
		"aria-describedby": describedBy(id, Boolean(help), errors),
	};
	return (
		<FieldShell id={id} label={label} help={help} errors={errors}>
			{multiline ? (
				<textarea
					{...shared}
					rows={3}
					onChange={(e) => onChange(e.target.value)}
					className="min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
				/>
			) : (
				<Input {...shared} onChange={(e) => onChange(e.target.value)} />
			)}
		</FieldShell>
	);
}

/** A list of short strings (assumptions, expected observations) edited one per line. */
export function LinesField({
	label,
	help,
	value,
	onChange,
}: {
	label: string;
	help: string;
	value: string[];
	onChange: (lines: string[]) => void;
}) {
	const id = useId();
	const [draft, setDraft] = useState(value.join("\n"));
	const focused = useRef(false);
	useEffect(() => {
		if (!focused.current) setDraft(value.join("\n"));
	}, [value]);
	return (
		<FieldShell id={id} label={label} help={help}>
			<textarea
				id={id}
				value={draft}
				rows={Math.min(8, Math.max(3, value.length + 1))}
				onFocus={() => {
					focused.current = true;
				}}
				onBlur={() => {
					focused.current = false;
				}}
				onChange={(e) => {
					setDraft(e.target.value);
					onChange(
						e.target.value
							.split("\n")
							.map((l) => l.trim())
							.filter(Boolean)
							.slice(0, 20),
					);
				}}
				aria-describedby={`${id}-help`}
				className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
			/>
		</FieldShell>
	);
}

export function FieldGroup({
	title,
	children,
	description,
}: {
	title: string;
	children: ReactNode;
	description?: string;
}) {
	return (
		<fieldset className="grid gap-4">
			<legend className="mb-1 font-semibold text-sm">{title}</legend>
			{description && (
				<p className="-mt-2 text-muted-foreground text-xs">{description}</p>
			)}
			{children}
		</fieldset>
	);
}
