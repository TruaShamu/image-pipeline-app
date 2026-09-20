/**
 * Minimal typings for gifenc, which ships no types of its own.
 *
 * Only the surface this project uses is declared; the encoder has more options.
 */
declare module 'gifenc' {
	export type GifPalette = number[][]
	export type GifFormat = 'rgb565' | 'rgb444' | 'rgba4444'

	export interface GifFrameOptions {
		/**
		 * The colour table for this frame. gifenc writes it as the *global* table on the first
		 * frame and as a per-frame local table on any later frame, so pass it once.
		 */
		palette?: GifPalette
		/** Frame delay in milliseconds; gifenc rounds it to GIF's 1/100s resolution. */
		delay?: number
		/** -1 plays once, 0 loops forever, any positive number is a repeat count. */
		repeat?: number
		transparent?: boolean
		transparentIndex?: number
	}

	export interface GifEncoder {
		writeFrame(index: Uint8Array, width: number, height: number, options?: GifFrameOptions): void
		finish(): void
		bytes(): Uint8Array
	}

	export function GIFEncoder(options?: { auto?: boolean }): GifEncoder

	export function quantize(
		rgba: Uint8Array | Uint8ClampedArray,
		maxColors: number,
		options?: { format?: GifFormat; oneBitAlpha?: boolean | number; clearAlpha?: boolean }
	): GifPalette

	export function applyPalette(
		rgba: Uint8Array | Uint8ClampedArray,
		palette: GifPalette,
		format?: GifFormat
	): Uint8Array
}
