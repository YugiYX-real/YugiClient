import { deflateSync } from "node:zlib"

/**
 * Turns an uploaded gif into the frames the client plays.
 *
 * <p>An owner should be able to draw an animation in whatever they already use, export one gif and
 * be done, so the server takes the gif apart here: every frame is composed onto a canvas the way a
 * viewer would show it, honouring transparency and the disposal rules, and written back out as a
 * plain png. The client then only ever deals with pngs, which is the one image format Minecraft
 * loads, and the animation speed comes straight out of the gif's own frame delays.
 *
 * <p>This is written by hand on purpose: it keeps the service free of native dependencies, so the
 * vps only ever needs node itself.
 */

/** The most frames one animation may be built from. */
export const MAX_FRAMES = 64

/** A ceiling on the canvas, so a silly upload cannot ask for gigabytes of memory. */
const MAX_SIDE = 2048

const INTERLACE_PASSES = [
	{ start: 0, step: 8 },
	{ start: 4, step: 8 },
	{ start: 2, step: 4 },
	{ start: 1, step: 2 },
]

const CRC_TABLE = (() => {
	const table = new Int32Array(256)
	for (let index = 0; index < 256; index += 1) {
		let value = index
		for (let bit = 0; bit < 8; bit += 1) {
			value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
		}
		table[index] = value
	}
	return table
})()

function crc32(bytes) {
	let crc = -1
	for (let index = 0; index < bytes.length; index += 1) {
		crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
	}
	return (crc ^ -1) >>> 0
}

function chunk(type, data) {
	const length = Buffer.alloc(4)
	length.writeUInt32BE(data.length, 0)

	const body = Buffer.concat([Buffer.from(type, "ascii"), data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(body), 0)

	return Buffer.concat([length, body, crc])
}

/** Writes straight rgba pixels out as a png. */
export function encodePng(width, height, rgba) {
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	header[8] = 8 // eight bits per channel
	header[9] = 6 // truecolour with alpha

	const stride = width * 4
	const raw = Buffer.alloc((stride + 1) * height)
	for (let y = 0; y < height; y += 1) {
		const at = y * (stride + 1)
		raw[at] = 0 // no filter, which keeps this simple and still compresses well
		raw.set(rgba.subarray(y * stride, y * stride + stride), at + 1)
	}

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	])
}

/** Unpacks one image's lzw stream into palette indices. */
function inflateLzw(minCodeSize, data, expected) {
	const clearCode = 1 << minCodeSize
	const endCode = clearCode + 1
	const output = new Uint8Array(expected)

	let dictionary = []
	let codeSize = minCodeSize + 1

	const reset = () => {
		dictionary = []
		for (let index = 0; index < clearCode; index += 1) {
			dictionary.push([index])
		}
		dictionary.push([], [])
		codeSize = minCodeSize + 1
	}
	reset()

	let written = 0
	let buffer = 0
	let bits = 0
	let at = 0
	let previous = null

	for (;;) {
		while (bits < codeSize && at < data.length) {
			buffer |= data[at] << bits
			at += 1
			bits += 8
		}
		if (bits < codeSize) {
			break
		}

		const code = buffer & ((1 << codeSize) - 1)
		buffer >>>= codeSize
		bits -= codeSize

		if (code === clearCode) {
			reset()
			previous = null
			continue
		}
		if (code === endCode) {
			break
		}

		let entry = null
		if (code < dictionary.length && dictionary[code].length > 0) {
			entry = dictionary[code]
		} else if (code === dictionary.length && previous !== null) {
			entry = [...previous, previous[0]]
		} else {
			break
		}

		for (const value of entry) {
			if (written < output.length) {
				output[written] = value
				written += 1
			}
		}

		if (previous !== null && dictionary.length < 4096) {
			dictionary.push([...previous, entry[0]])
			if (dictionary.length === 1 << codeSize && codeSize < 12) {
				codeSize += 1
			}
		}
		previous = entry
	}

	return output
}

/** Reads a gif and returns every composed frame as rgba pixels. */
export function decodeGif(bytes) {
	if (bytes.length < 14) {
		throw new Error("that file is too short to be a gif")
	}
	if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) {
		throw new Error("that file is not a gif")
	}

	let at = 6
	const byte = () => bytes[at++]
	const short = () => {
		const value = bytes[at] | (bytes[at + 1] << 8)
		at += 2
		return value
	}

	const width = short()
	const height = short()
	if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) {
		throw new Error(`the gif has to be between 1 and ${MAX_SIDE} pixels on each side`)
	}

	const flags = byte()
	byte() // background colour index
	byte() // pixel aspect ratio

	let table = null
	if ((flags & 0x80) !== 0) {
		const entries = 2 << (flags & 0x07)
		table = bytes.subarray(at, at + entries * 3)
		at += entries * 3
	}

	const subBlocks = (keep) => {
		const parts = []
		for (;;) {
			if (at >= bytes.length) {
				break
			}
			const size = byte()
			if (size === 0) {
				break
			}
			if (keep) {
				parts.push(bytes.subarray(at, at + size))
			}
			at += size
		}
		return keep ? Buffer.concat(parts) : null
	}

	const canvas = new Uint8Array(width * height * 4)
	const frames = []

	let delayMs = 100
	let transparent = -1
	let disposal = 0

	while (at < bytes.length) {
		const marker = byte()

		if (marker === 0x3b) {
			break
		}

		if (marker === 0x21) {
			const label = byte()
			if (label === 0xf9) {
				const size = byte()
				const packed = bytes[at]
				disposal = (packed >> 2) & 0x07
				delayMs = (bytes[at + 1] | (bytes[at + 2] << 8)) * 10
				transparent = (packed & 0x01) !== 0 ? bytes[at + 3] : -1
				at += size
			}
			subBlocks(false)
			continue
		}

		if (marker !== 0x2c) {
			// Something unexpected: stop rather than walk off into the file.
			break
		}

		const left = short()
		const top = short()
		const frameWidth = short()
		const frameHeight = short()
		const packed = byte()
		const interlaced = (packed & 0x40) !== 0

		let frameTable = table
		if ((packed & 0x80) !== 0) {
			const entries = 2 << (packed & 0x07)
			frameTable = bytes.subarray(at, at + entries * 3)
			at += entries * 3
		}
		if (frameTable === null || frameTable.length < 3) {
			throw new Error("that gif carries no colour table")
		}

		const minCodeSize = byte()
		const data = subBlocks(true)
		const indices = inflateLzw(minCodeSize, data, frameWidth * frameHeight)

		const before = disposal === 3 ? canvas.slice() : null

		let source = 0
		for (let row = 0; row < frameHeight; row += 1) {
			let y = top + row
			if (interlaced) {
				let counted = 0
				for (const pass of INTERLACE_PASSES) {
					const lines = Math.max(0, Math.ceil((frameHeight - pass.start) / pass.step))
					if (row < counted + lines) {
						y = top + pass.start + (row - counted) * pass.step
						break
					}
					counted += lines
				}
			}

			for (let column = 0; column < frameWidth; column += 1) {
				const index = indices[source]
				source += 1

				const x = left + column
				if (index === transparent || x < 0 || y < 0 || x >= width || y >= height) {
					continue
				}

				const target = (y * width + x) * 4
				const colour = index * 3
				canvas[target] = frameTable[colour] ?? 0
				canvas[target + 1] = frameTable[colour + 1] ?? 0
				canvas[target + 2] = frameTable[colour + 2] ?? 0
				canvas[target + 3] = 255
			}
		}

		frames.push({ delayMs: delayMs > 0 ? delayMs : 100, pixels: canvas.slice() })
		if (frames.length >= 512) {
			break
		}

		if (disposal === 2) {
			for (let row = 0; row < frameHeight; row += 1) {
				const y = top + row
				if (y < 0 || y >= height) {
					continue
				}
				for (let column = 0; column < frameWidth; column += 1) {
					const x = left + column
					if (x < 0 || x >= width) {
						continue
					}
					canvas.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4)
				}
			}
		} else if (disposal === 3 && before !== null) {
			canvas.set(before)
		}
	}

	if (frames.length === 0) {
		throw new Error("that gif holds no frames")
	}

	return { width, height, frames }
}

/**
 * The whole job in one call: gif in, pngs out.
 *
 * Long animations are thinned out evenly rather than cut off, so a two hundred frame gif still
 * plays from beginning to end, only with fewer steps, and the frame time is stretched to match so
 * it keeps its original speed.
 */
export function gifToFrames(bytes, limit = MAX_FRAMES) {
	const decoded = decodeGif(bytes)
	const step = Math.max(1, Math.ceil(decoded.frames.length / limit))
	const kept = decoded.frames.filter((frame, index) => index % step === 0).slice(0, limit)

	const delays = kept.map((frame) => frame.delayMs).filter((delay) => delay >= 10)
	const average =
		delays.length > 0 ? delays.reduce((total, delay) => total + delay, 0) / delays.length : 100

	return {
		width: decoded.width,
		height: decoded.height,
		total: decoded.frames.length,
		frameMs: Math.min(5000, Math.max(20, Math.round(average * step))),
		frames: kept.map((frame) => encodePng(decoded.width, decoded.height, frame.pixels)),
	}
}
