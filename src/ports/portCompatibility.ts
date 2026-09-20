import { elementDataType, isCollectionDataType, PortDataType } from '../constants'
import { ShapePort } from './Port'

/**
 * Whether an output of type `source` may feed an input of type `target`.
 *
 * This is deliberately asymmetric. A collection may feed a scalar input, because
 * `runToolMapped` runs the tool once per element and collects the results back into a
 * collection. The reverse is not allowed: a tool declaring a collection input reads it
 * with `Array.isArray` and would throw on a lone value.
 */
export function canConnectPortDataTypes(source: PortDataType, target: PortDataType): boolean {
	if (source === 'any' || target === 'any') return true
	if (source === target) return true
	return isCollectionDataType(source) && elementDataType(source) === target
}

export function findFirstCompatiblePort(
	ports: ShapePort[],
	terminal: ShapePort['terminal'],
	dataType: ShapePort['dataType']
) {
	// `terminal` is the terminal being searched for, so it also says which side of the
	// connection each candidate sits on: an 'end' port is an input fed by `dataType`, and a
	// 'start' port is an output feeding `dataType`.
	const candidates = ports.filter((port) => {
		if (port.terminal !== terminal) return false
		return terminal === 'end'
			? canConnectPortDataTypes(dataType, port.dataType)
			: canConnectPortDataTypes(port.dataType, dataType)
	})
	// Prefer an exact match, then a mapped one, and only then a generic 'any' port, so that
	// e.g. a text source connects to the 'prompt' port rather than a catch-all.
	return (
		candidates.find((port) => port.dataType === dataType) ??
		candidates.find((port) => port.dataType !== 'any' && dataType !== 'any') ??
		candidates[0]
	)
}

