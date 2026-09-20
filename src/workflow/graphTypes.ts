import { ToolValue } from '../tools'
import { PortDataType } from '../constants'

export interface GraphPosition {
	x: number
	y: number
}

export interface GraphBinding {
	port: string
	from: {
		stepId: string
		output: string
	}
}

export interface GraphStep {
	id: string
	tool: string
	with?: Record<string, ToolValue>
	needs?: readonly GraphBinding[]
	ui?: GraphPosition
}

export interface WorkflowGraph {
	version: 1
	steps: readonly GraphStep[]
}

export type WorkflowPortType = PortDataType
