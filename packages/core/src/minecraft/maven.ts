export type MavenCoordinate = {
	readonly group: string
	readonly artifact: string
	readonly version: string
	readonly classifier?: string
	readonly extension: string
}

export class InvalidMavenCoordinateError extends Error {
	readonly coordinate: string

	constructor(coordinate: string) {
		super(`Invalid Maven coordinate: "${coordinate}"`)
		this.name = "InvalidMavenCoordinateError"
		this.coordinate = coordinate
	}
}

export function parseMavenCoordinate(coordinate: string): MavenCoordinate {
	const atIndex = coordinate.indexOf("@")
	const body = atIndex === -1 ? coordinate : coordinate.slice(0, atIndex)
	const extension = atIndex === -1 ? "jar" : coordinate.slice(atIndex + 1)
	const parts = body.split(":")

	const group = parts[0] ?? ""
	const artifact = parts[1] ?? ""
	const version = parts[2] ?? ""
	const classifier = parts[3]

	if (group === "" || artifact === "" || version === "" || extension === "") {
		throw new InvalidMavenCoordinateError(coordinate)
	}

	return {
		group,
		artifact,
		version,
		classifier: classifier === undefined || classifier === "" ? undefined : classifier,
		extension,
	}
}

export function mavenFileName(coordinate: MavenCoordinate): string {
	const suffix = coordinate.classifier === undefined ? "" : `-${coordinate.classifier}`
	return `${coordinate.artifact}-${coordinate.version}${suffix}.${coordinate.extension}`
}

export function mavenRelativePath(coordinate: MavenCoordinate): string {
	return [
		...coordinate.group.split("."),
		coordinate.artifact,
		coordinate.version,
		mavenFileName(coordinate),
	].join("/")
}

export function mavenUrl(repository: string, coordinate: MavenCoordinate): string {
	const base = repository.endsWith("/") ? repository : `${repository}/`
	return `${base}${mavenRelativePath(coordinate)}`
}

export function withClassifier(
	coordinate: MavenCoordinate,
	classifier: string | undefined,
): MavenCoordinate {
	return { ...coordinate, classifier }
}

export function coordinateKey(coordinate: MavenCoordinate): string {
	const suffix = coordinate.classifier === undefined ? "" : `:${coordinate.classifier}`
	return `${coordinate.group}:${coordinate.artifact}${suffix}`
}
