import { DEFAULT_WORKFLOW_DOC, WORKFLOW_DOCS_BUNDLE } from './workflow-docs-bundle'

export type AgentWorkflowDocPayload = {
  name: string
  content: string
  availableDocs: string[]
}

export function listAgentWorkflowDocNames(): string[] {
  return Object.keys(WORKFLOW_DOCS_BUNDLE)
}

export function readAgentWorkflowDoc(
  params: Record<string, unknown>,
): AgentWorkflowDocPayload {
  const availableDocs = listAgentWorkflowDocNames()
  const rawName = params.name
  const name =
    typeof rawName === 'string' && rawName.trim() !== ''
      ? rawName.trim()
      : DEFAULT_WORKFLOW_DOC
  const content = WORKFLOW_DOCS_BUNDLE[name]
  if (content === undefined) {
    throw new Error(
      `Unknown workflow doc: ${name}. Available docs: ${availableDocs.join(', ')}`,
    )
  }
  return {
    name,
    content,
    availableDocs,
  }
}
