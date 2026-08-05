import { useEffect, useRef, useState } from "react"
import type { ChangeEvent, ReactNode } from "react"
import { Icon } from "./Icon.tsx"
import type { IconName } from "./Icon.tsx"
import { filePathOf } from "../lib/client.ts"

export function Button({
	children,
	icon,
	onClick,
	variant = "default",
	size = "medium",
	disabled = false,
	block = false,
	title,
	busy = false,
}: {
	children?: ReactNode
	icon?: IconName
	onClick?: () => void
	variant?: "default" | "primary" | "ghost" | "danger"
	size?: "small" | "medium"
	disabled?: boolean
	block?: boolean
	title?: string
	busy?: boolean
}): JSX.Element {
	const classes = ["btn"]
	if (variant !== "default") {
		classes.push(variant)
	}
	if (size === "small") {
		classes.push("small")
	}
	if (block) {
		classes.push("block")
	}
	if (children === undefined && icon !== undefined) {
		classes.push("icon")
	}

	return (
		<button
			type="button"
			className={classes.join(" ")}
			onClick={onClick}
			disabled={disabled || busy}
			title={title}
		>
			{busy ? (
				<span className="spinner" />
			) : icon !== undefined ? (
				<Icon name={icon} size={16} />
			) : null}
			{children}
		</button>
	)
}

export function Card({
	children,
	interactive = false,
	flat = false,
	onClick,
	onContextMenu,
	className = "",
}: {
	children: ReactNode
	interactive?: boolean
	flat?: boolean
	onClick?: () => void
	onContextMenu?: (event: React.MouseEvent) => void
	className?: string
}): JSX.Element {
	const classes = ["card"]
	if (interactive) {
		classes.push("interactive")
	}
	if (flat) {
		classes.push("flat")
	}
	if (className !== "") {
		classes.push(className)
	}

	return (
		<div className={classes.join(" ")} onClick={onClick} onContextMenu={onContextMenu}>
			{children}
		</div>
	)
}

export function SectionHeader({
	title,
	subtitle,
	action,
}: {
	title: string
	subtitle?: string
	action?: ReactNode
}): JSX.Element {
	return (
		<div className="row between">
			<div className="col" style={{ gap: 2 }}>
				<h2>{title}</h2>
				{subtitle === undefined ? null : <small>{subtitle}</small>}
			</div>
			{action}
		</div>
	)
}

export function Badge({
	children,
	tone = "neutral",
	icon,
}: {
	children: ReactNode
	tone?: "neutral" | "accent" | "success" | "warning" | "danger"
	icon?: IconName
}): JSX.Element {
	return (
		<span className={tone === "neutral" ? "badge" : `badge ${tone}`}>
			{icon === undefined ? null : <Icon name={icon} size={12} />}
			{children}
		</span>
	)
}

export function Toggle({
	checked,
	onChange,
	label,
}: {
	checked: boolean
	onChange: (value: boolean) => void
	label?: string
}): JSX.Element {
	return (
		<label className="toggle">
			<input
				type="checkbox"
				checked={checked}
				onChange={(event: ChangeEvent<HTMLInputElement>) => {
					onChange(event.target.checked)
				}}
			/>
			<span className="toggle-track" />
			{label === undefined ? null : <span>{label}</span>}
		</label>
	)
}

export function Field({
	label,
	hint,
	children,
}: {
	label: string
	hint?: string
	children: ReactNode
}): JSX.Element {
	return (
		<div className="field">
			<label>{label}</label>
			{children}
			{hint === undefined ? null : <span className="hint">{hint}</span>}
		</div>
	)
}

export function TextInput({
	value,
	onChange,
	placeholder,
	type = "text",
	disabled = false,
}: {
	value: string
	onChange: (value: string) => void
	placeholder?: string
	type?: "text" | "password" | "search"
	disabled?: boolean
}): JSX.Element {
	return (
		<input
			type={type}
			value={value}
			placeholder={placeholder}
			disabled={disabled}
			onChange={(event: ChangeEvent<HTMLInputElement>) => {
				onChange(event.target.value)
			}}
		/>
	)
}

export function NumberInput({
	value,
	onChange,
	min,
	max,
	step = 1,
}: {
	value: number
	onChange: (value: number) => void
	min?: number
	max?: number
	step?: number
}): JSX.Element {
	return (
		<input
			type="number"
			value={value}
			min={min}
			max={max}
			step={step}
			onChange={(event: ChangeEvent<HTMLInputElement>) => {
				const parsed = Number(event.target.value)
				onChange(Number.isFinite(parsed) ? parsed : 0)
			}}
		/>
	)
}

export function Slider({
	value,
	onChange,
	min,
	max,
	step = 1,
}: {
	value: number
	onChange: (value: number) => void
	min: number
	max: number
	step?: number
}): JSX.Element {
	return (
		<input
			type="range"
			value={value}
			min={min}
			max={max}
			step={step}
			onChange={(event: ChangeEvent<HTMLInputElement>) => {
				onChange(Number(event.target.value))
			}}
		/>
	)
}

export function Select<T extends string>({
	value,
	onChange,
	options,
}: {
	value: T
	onChange: (value: T) => void
	options: readonly { readonly value: T; readonly label: string }[]
}): JSX.Element {
	return (
		<select
			value={value}
			onChange={(event: ChangeEvent<HTMLSelectElement>) => {
				onChange(event.target.value as T)
			}}
		>
			{options.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	)
}

export function SearchInput({
	value,
	onChange,
	placeholder = "Search",
}: {
	value: string
	onChange: (value: string) => void
	placeholder?: string
}): JSX.Element {
	return (
		<div className="search">
			<Icon name="search" size={15} />
			<input
				type="search"
				value={value}
				placeholder={placeholder}
				onChange={(event: ChangeEvent<HTMLInputElement>) => {
					onChange(event.target.value)
				}}
			/>
		</div>
	)
}

export function Tabs<T extends string>({
	value,
	onChange,
	tabs,
}: {
	value: T
	onChange: (value: T) => void
	tabs: readonly { readonly value: T; readonly label: string }[]
}): JSX.Element {
	return (
		<div className="tabs" role="tablist">
			{tabs.map((tab) => (
				<button
					key={tab.value}
					type="button"
					role="tab"
					className="tab"
					aria-selected={tab.value === value}
					onClick={() => {
						onChange(tab.value)
					}}
				>
					{tab.label}
				</button>
			))}
		</div>
	)
}

export function ProgressBar({
	fraction,
	indeterminate = false,
}: {
	fraction: number
	indeterminate?: boolean
}): JSX.Element {
	const percent = Math.min(100, Math.max(0, Math.round(fraction * 100)))
	return (
		<div className={indeterminate ? "progress indeterminate" : "progress"}>
			<i style={indeterminate ? undefined : { width: `${percent}%` }} />
		</div>
	)
}

export function Spinner(): JSX.Element {
	return <span className="spinner" />
}

export function Skeleton({ lines = 3 }: { lines?: number }): JSX.Element {
	return (
		<div className="col">
			{Array.from({ length: lines }, (_value, index) => (
				<div
					key={index}
					className="skeleton"
					style={{ width: index % 3 === 0 ? "78%" : index % 3 === 1 ? "92%" : "64%" }}
				/>
			))}
		</div>
	)
}

export function EmptyState({
	icon = "sparkle",
	title,
	description,
	action,
}: {
	icon?: IconName
	title: string
	description?: string
	action?: ReactNode
}): JSX.Element {
	return (
		<div className="empty">
			<div className="empty-art">
				<Icon name={icon} size={42} strokeWidth={1.3} />
			</div>
			<div className="col" style={{ gap: 4, alignItems: "center" }}>
				<h3>{title}</h3>
				{description === undefined ? null : <small>{description}</small>}
			</div>
			{action}
		</div>
	)
}

export function Modal({
	title,
	subtitle,
	children,
	footer,
	onClose,
	wide = false,
}: {
	title: string
	subtitle?: string
	children: ReactNode
	footer?: ReactNode
	onClose: () => void
	wide?: boolean
}): JSX.Element {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				onClose()
			}
		}
		window.addEventListener("keydown", onKeyDown)
		return () => {
			window.removeEventListener("keydown", onKeyDown)
		}
	}, [onClose])

	return (
		<div
			className="modal-backdrop"
			onClick={(event) => {
				if (event.target === event.currentTarget) {
					onClose()
				}
			}}
		>
			<div className={wide ? "modal wide" : "modal"}>
				<div className="row between">
					<div className="col" style={{ gap: 2 }}>
						<h2>{title}</h2>
						{subtitle === undefined ? null : <small>{subtitle}</small>}
					</div>
					<Button
						icon="close"
						variant="ghost"
						size="small"
						onClick={onClose}
						title="Close"
					/>
				</div>
				{children}
				{footer === undefined ? null : <div className="modal-footer">{footer}</div>}
			</div>
		</div>
	)
}

export function ConfirmDialog({
	title,
	message,
	confirmLabel = "Confirm",
	destructive = false,
	onConfirm,
	onCancel,
}: {
	title: string
	message: string
	confirmLabel?: string
	destructive?: boolean
	onConfirm: () => void
	onCancel: () => void
}): JSX.Element {
	return (
		<Modal
			title={title}
			onClose={onCancel}
			footer={
				<>
					<Button variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
					<Button variant={destructive ? "danger" : "primary"} onClick={onConfirm}>
						{confirmLabel}
					</Button>
				</>
			}
		>
			<p style={{ color: "var(--muted)" }}>{message}</p>
		</Modal>
	)
}

export type ContextMenuItem = {
	readonly label: string
	readonly icon?: IconName
	readonly danger?: boolean
	onSelect(): void
}

export function ContextMenu({
	position,
	items,
	onClose,
}: {
	position: { x: number; y: number }
	items: readonly ContextMenuItem[]
	onClose: () => void
}): JSX.Element {
	const reference = useRef<HTMLDivElement | null>(null)

	useEffect(() => {
		const onPointerDown = (event: MouseEvent): void => {
			if (reference.current !== null && !reference.current.contains(event.target as Node)) {
				onClose()
			}
		}
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				onClose()
			}
		}
		window.addEventListener("mousedown", onPointerDown)
		window.addEventListener("keydown", onKeyDown)
		return () => {
			window.removeEventListener("mousedown", onPointerDown)
			window.removeEventListener("keydown", onKeyDown)
		}
	}, [onClose])

	return (
		<div
			className="context-menu"
			ref={reference}
			style={{ left: position.x, top: position.y }}
			role="menu"
		>
			{items.map((item) => (
				<button
					key={item.label}
					type="button"
					className={item.danger === true ? "context-item danger" : "context-item"}
					onClick={() => {
						onClose()
						item.onSelect()
					}}
				>
					{item.icon === undefined ? null : <Icon name={item.icon} size={15} />}
					{item.label}
				</button>
			))}
		</div>
	)
}

export function DropZone({
	label,
	onFiles,
}: {
	label: string
	onFiles: (paths: readonly string[]) => void
}): JSX.Element {
	const [active, setActive] = useState(false)

	return (
		<div
			className="dropzone"
			data-active={active}
			onDragOver={(event) => {
				event.preventDefault()
				setActive(true)
			}}
			onDragLeave={() => {
				setActive(false)
			}}
			onDrop={(event) => {
				event.preventDefault()
				setActive(false)
				const paths = [...event.dataTransfer.files]
					.map((file) => filePathOf(file))
					.filter((path): path is string => path !== undefined && path !== "")
				if (paths.length > 0) {
					onFiles(paths)
				}
			}}
		>
			<Icon name="upload" size={22} />
			<div style={{ marginTop: 8 }}>{label}</div>
		</div>
	)
}

export function StatTile({
	label,
	value,
	hint,
}: {
	label: string
	value: string
	hint?: string
}): JSX.Element {
	return (
		<Card flat>
			<div className="stat-tile">
				<small>{label}</small>
				<strong>{value}</strong>
				{hint === undefined ? null : <small>{hint}</small>}
			</div>
		</Card>
	)
}

export function Avatar({
	source,
	fallback,
	size = 36,
}: {
	source: string | null
	fallback: string
	size?: number
}): JSX.Element {
	if (source === null || source === "") {
		return (
			<div className="avatar" style={{ width: size, height: size }}>
				{fallback}
			</div>
		)
	}
	return <img className="avatar" style={{ width: size, height: size }} src={source} alt="" />
}
