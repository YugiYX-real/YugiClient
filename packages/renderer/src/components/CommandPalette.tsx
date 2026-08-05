import { useEffect, useMemo, useRef, useState } from "react"
import { Icon } from "./Icon.tsx"
import type { IconName } from "./Icon.tsx"

export type Command = {
	readonly id: string
	readonly label: string
	readonly hint?: string
	readonly icon?: IconName
	run(): void
}

export function CommandPalette({
	commands,
	onClose,
}: {
	commands: readonly Command[]
	onClose: () => void
}): JSX.Element {
	const [query, setQuery] = useState("")
	const [index, setIndex] = useState(0)
	const inputRef = useRef<HTMLInputElement | null>(null)

	useEffect(() => {
		inputRef.current?.focus()
	}, [])

	const matches = useMemo(() => {
		const needle = query.trim().toLowerCase()
		const filtered =
			needle === ""
				? commands
				: commands.filter(
						(command) =>
							command.label.toLowerCase().includes(needle) ||
							(command.hint ?? "").toLowerCase().includes(needle),
					)
		return filtered.slice(0, 40)
	}, [commands, query])

	const activeIndex = Math.min(index, Math.max(0, matches.length - 1))

	const onKeyDown = (event: React.KeyboardEvent): void => {
		if (event.key === "Escape") {
			onClose()
			return
		}
		if (event.key === "ArrowDown") {
			event.preventDefault()
			setIndex((current) => (current + 1) % Math.max(1, matches.length))
			return
		}
		if (event.key === "ArrowUp") {
			event.preventDefault()
			setIndex((current) => (current - 1 + matches.length) % Math.max(1, matches.length))
			return
		}
		if (event.key === "Enter") {
			event.preventDefault()
			const command = matches[activeIndex]
			if (command !== undefined) {
				onClose()
				command.run()
			}
		}
	}

	return (
		<div
			className="palette"
			onClick={(event) => {
				if (event.target === event.currentTarget) {
					onClose()
				}
			}}
		>
			<div className="palette-box" onKeyDown={onKeyDown}>
				<input
					ref={inputRef}
					type="text"
					value={query}
					placeholder="Search instances, pages and actions"
					onChange={(event) => {
						setQuery(event.target.value)
						setIndex(0)
					}}
				/>
				<div className="palette-list">
					{matches.length === 0 ? (
						<div style={{ padding: 16, color: "var(--muted)" }}>
							Nothing matched that search.
						</div>
					) : (
						matches.map((command, position) => (
							<button
								key={command.id}
								type="button"
								className="palette-item"
								data-active={position === activeIndex}
								onMouseEnter={() => {
									setIndex(position)
								}}
								onClick={() => {
									onClose()
									command.run()
								}}
							>
								<Icon name={command.icon ?? "sparkle"} size={16} />
								<span>{command.label}</span>
								{command.hint === undefined ? null : <small>{command.hint}</small>}
							</button>
						))
					)}
				</div>
			</div>
		</div>
	)
}
