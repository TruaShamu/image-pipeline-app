/**
 * An error that already knows how it should reach the client.
 *
 * Everything thrown in a route otherwise becomes a 500, which reads as "the server is broken" even
 * when the real cause is an expired credential the caller can fix with one command. Carrying the
 * status keeps that distinction intact all the way to the browser's network log.
 */
export class HttpError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message)
		this.name = 'HttpError'
	}
}

/** The status a thrown value should produce. Anything unrecognised is a genuine server fault. */
export function errorStatus(e: unknown): number {
	return e instanceof HttpError ? e.status : 500
}

/** The message a thrown value should produce. */
export function errorMessage(e: unknown): string {
	return e instanceof Error ? e.message : 'Server error'
}
