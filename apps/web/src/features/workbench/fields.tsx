import {
	FIELDS,
	type FieldKey,
	type ValidationIssue,
} from "@faultworks/experiment";
import { CircleAlert } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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

/** Renders a package message (key + params) in the user's language. */
export function useMessage() {
	const { t } = useTranslation();
	return (
		issue: ValidationIssue | { key: string; params?: Record<string, unknown> },
	) => {
		const m = "message" in issue ? issue.message : issue;
		const params = { ...(m.params ?? {}) } as Record<string, unknown>;
		if (typeof params.field === "string")
			params.field = t(`fields.${params.field}.label`, {
				defaultValue: params.field,
			});
		if (typeof params.unit === "string")
			params.unit = t(`units.${params.unit}`, { defaultValue: params.unit });
		return t(`messages.${m.key}`, { ...params, defaultValue: m.key });
	};
}

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
					id={`${id}-help`}
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
					id={`${id}-error`}
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
	field: FieldKey;
	/** Override the translated label (e.g. "Consumers" for a queue's capacity). */
	labelKey?: FieldKey;
	value: number | null | undefined;
	onChange: (value: number | null) => void;
	errors?: string[];
	nullable?: boolean;
	nullLabel?: string;
	integer?: boolean;
	min?: number;
	step?: number;
	/** Show the value in seconds next to the unit for ms fields. */
	showSeconds?: boolean;
	/** Edit percentages as 0–100 while the model stores 0–1. */
	percent?: boolean;
}

/**
 * Number input that keeps the user's draft text while they type ("", "1.", "-") and only
 * commits values that parse. Edits made elsewhere (undo, reset) replace the draft unless the
 * field is focused.
 */
export function NumberField({
	field,
	labelKey,
	value,
	onChange,
	errors,
	nullable,
	nullLabel,
	integer,
	min,
	step,
	showSeconds,
	percent,
}: NumberFieldProps) {
	const { t, i18n } = useTranslation();
	const id = useId();
	const info = FIELDS[field];
	const toDraft = (v: number | null | undefined) =>
		v === null || v === undefined
			? ""
			: String(percent ? Math.round(v * 10000) / 100 : v);
	const [draft, setDraft] = useState(toDraft(value));
	const focused = useRef(false);
	const [localError, setLocalError] = useState<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: toDraft only depends on `percent`, which never changes for a field
	useEffect(() => {
		if (!focused.current) setDraft(toDraft(value));
	}, [value]);

	const unitLabel = info.unit
		? t(`units.${info.unit}`, { defaultValue: info.unit })
		: "";
	const commit = (text: string) => {
		const trimmed = text.trim().replace(",", ".");
		if (trimmed === "") {
			if (nullable) {
				setLocalError(null);
				onChange(null);
			} else
				setLocalError(
					unitLabel
						? t("fields.errors.requiredUnit", { unit: unitLabel })
						: t("fields.errors.required"),
				);
			return;
		}
		const n = Number(trimmed);
		if (!Number.isFinite(n)) {
			setLocalError(t("fields.errors.notNumber", { text }));
			return;
		}
		if (integer && !Number.isInteger(n)) {
			setLocalError(t("fields.errors.integer"));
			return;
		}
		setLocalError(null);
		const next = percent ? n / 100 : n;
		if (next !== value) onChange(next);
	};

	const allErrors = [...(localError ? [localError] : []), ...(errors ?? [])];
	const seconds =
		showSeconds && typeof value === "number" && value >= 1000
			? `(${(value / 1000).toLocaleString(i18n.language, { maximumFractionDigits: 3 })} ${t("units.s")})`
			: undefined;
	const label = t(`fields.${labelKey ?? field}.label`);
	const help = t(`fields.${labelKey ?? field}.help`, { defaultValue: "" });

	return (
		<FieldShell
			id={id}
			label={label}
			help={help || undefined}
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
							const current =
								Number(draft) ||
								(typeof value === "number"
									? percent
										? value * 100
										: value
									: (min ?? 0));
							const delta =
								(step ?? 1) *
								(e.shiftKey ? 10 : 1) *
								(e.key === "ArrowUp" ? 1 : -1);
							const next = Math.max(
								min ?? Number.NEGATIVE_INFINITY,
								Number((current + delta).toFixed(6)),
							);
							setDraft(String(next));
							commit(String(next));
						}
					}}
					aria-invalid={allErrors.length > 0}
					aria-describedby={describedBy(
						id,
						Boolean(help || seconds),
						allErrors,
					)}
					className={cn("tabular pr-16", allErrors.length > 0 && "border-down")}
				/>
				{(info.unit || percent) && (
					<span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground text-xs">
						{percent ? "%" : unitLabel}
					</span>
				)}
			</div>
		</FieldShell>
	);
}

interface SelectFieldProps<T extends string> {
	field: FieldKey;
	value: T;
	/** Options and labels; defaults to the field's options translated as `options.<field>.<value>`. */
	options?: Array<{ value: T; label: string }>;
	onChange: (value: T) => void;
	errors?: string[];
	labelOverride?: string;
}

export function SelectField<T extends string>({
	field,
	value,
	options,
	onChange,
	errors,
	labelOverride,
}: SelectFieldProps<T>) {
	const { t } = useTranslation();
	const id = useId();
	const info = FIELDS[field];
	const list =
		options ??
		(info.options ?? []).map((v) => ({
			value: v as T,
			label: t(`options.${field}.${v}`, { defaultValue: v }),
		}));
	const help = t(`fields.${field}.help`, { defaultValue: "" });
	return (
		<FieldShell
			id={id}
			label={labelOverride ?? t(`fields.${field}.label`)}
			help={help || undefined}
			errors={errors}
		>
			<Select value={value} onValueChange={(v) => onChange(v as T)}>
				<SelectTrigger
					id={id}
					className="w-full"
					aria-describedby={describedBy(id, Boolean(help), errors)}
					aria-invalid={Boolean(errors?.length)}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{list.map((o) => (
						<SelectItem key={o.value} value={o.value}>
							{o.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</FieldShell>
	);
}

export function SwitchField({
	field,
	checked,
	onChange,
}: {
	field: FieldKey;
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	const { t } = useTranslation();
	const id = useId();
	const help = t(`fields.${field}.help`, { defaultValue: "" });
	return (
		<FieldShell
			id={id}
			label={t(`fields.${field}.label`)}
			help={help || undefined}
			inline
		>
			<Switch
				id={id}
				checked={checked}
				onCheckedChange={onChange}
				aria-describedby={help ? `${id}-help` : undefined}
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
	mono,
}: {
	label: string;
	value: string;
	onChange: (value: string) => void;
	multiline?: boolean;
	help?: string;
	errors?: string[];
	maxLength?: number;
	placeholder?: string;
	mono?: boolean;
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
				<Input
					{...shared}
					onChange={(e) => onChange(e.target.value)}
					className={mono ? "font-mono" : undefined}
				/>
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
