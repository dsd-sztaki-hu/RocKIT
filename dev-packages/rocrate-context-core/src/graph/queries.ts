import type { IReference } from '../types'
import { toArray } from '../utils'
import { SchemaGraph } from './schema-graph'
import { SchemaResolver } from './schema-resolver'
import type { RegisteredSchema } from '../registry/types'
import { RO_CRATE_VERSION } from '../constants'

/**
 * Lightweight class descriptor returned by query helpers.
 */
export interface SlimClass {
  '@id': string
  comment: unknown
}

export interface SlimProperty {
  '@id': string
  range: IReference[]
  comment: unknown
}

interface PropertyOptions {
  onlyReferences: boolean
}

/**
 * Fast heuristic for whether a property range can contain references.
 */
function referenceCheck(propertyRange?: string[]) {
  return propertyRange
    ? propertyRange.length === 0 ||
        propertyRange.filter((s) => s.startsWith('http') || s.startsWith('https')).length > 0
    : true
}

/**
 * High-level schema query facade ported from NovaCrate worker helpers.
 */
export class SchemaQueryService {
  private readonly schemaResolver: SchemaResolver
  private readonly schemaGraph: SchemaGraph

  constructor(registeredSchemas: RegisteredSchema[]) {
    this.schemaResolver = new SchemaResolver(registeredSchemas)
    this.schemaGraph = new SchemaGraph(this.schemaResolver)
  }

  /**
   * Replaces active schema registry and selected RO-Crate specification.
   */
  updateRegisteredSchemas(state: RegisteredSchema[], spec: RO_CRATE_VERSION) {
    this.schemaResolver.updateRegisteredSchemas(state, spec)
  }

  /**
   * Forces loading one schema by registry id.
   */
  forceSchemaLoad(schemaId: string) {
    return this.schemaGraph.forceSchemaLoad(schemaId)
  }

  /**
   * Loads every eligible schema from the active registry.
   */
  loadAllSchemas() {
    return this.schemaGraph.loadAllSchemas()
  }

  /**
   * Unloads all nodes sourced from one schema id.
   */
  unloadSchema(schemaId: string) {
    return this.schemaGraph.unloadSchema(schemaId)
  }

  /**
   * Returns query-side status snapshot (for diagnostics).
   */
  getWorkerStatus() {
    return { workerActive: false, schemaStatus: this.schemaGraph.getSchemaStatus() }
  }

  /**
   * Resolves comment/definition text for one property or class node.
   */
  async getPropertyComment(propertyId: string) {
    return (await this.schemaGraph.getNode(propertyId))?.comment
  }

  /**
   * Returns transitive parent classes for one class id.
   */
  async getClassParents(classId: string) {
    return this.schemaGraph.getClassParents(classId)
  }

  /**
   * Returns properties directly declared on the class (non-inherited).
   */
  async getClassSpecificProperties(classId: string) {
    return this.schemaGraph.getClassSpecificProperties(classId)
  }

  /**
   * Returns property domain references.
   */
  async getPropertyDomain(propertyId: string) {
    const refs = (await this.schemaGraph.getNode(propertyId))?.domain
    if (!refs) return []
    return Array.isArray(refs) ? refs : [refs]
  }

  /**
   * Returns property range references plus discovered subclasses of range types.
   */
  async getPropertyRange(propertyId: string) {
    const node = await this.schemaGraph.getNode(propertyId)
    let refs = node?.range
    if (!refs) return []

    const range = new Set<SlimClass>()
    refs = Array.isArray(refs) ? refs : [refs]

    for (const ref of refs) {
      range.add({
        '@id': ref['@id'],
        comment: await this.getPropertyComment(ref['@id'])
      })

      const subClasses = await this.schemaGraph.getSubClasses(ref['@id'])
      for (const subClass of subClasses) {
        range.add({ '@id': subClass, comment: await this.getPropertyComment(subClass) })
      }
    }

    return Array.from(range)
  }

  /**
   * Returns all class nodes from currently loaded schemas.
   */
  getAllClasses(): SlimClass[] {
    return this.schemaGraph
      .getAllNodes()
      .filter((n) => n.isClass())
      .map((c) => ({ '@id': c['@id'], comment: c.comment }))
  }

  /**
   * Returns all property nodes from currently loaded schemas.
   */
  getAllProperties(opt?: Partial<PropertyOptions>): SlimProperty[] {
    return this.schemaGraph
      .getAllNodes()
      .filter((n) => n.isProperty())
      .map((p) => ({
        '@id': p['@id'],
        comment: p.comment,
        range: p.range
          ? toArray(p.range).map((r) => ({ '@id': r['@id'] }))
          : []
      }))
      .filter((p) => (opt?.onlyReferences ? referenceCheck(p.range.map((r) => r['@id'])) : true))
  }

  /**
   * Returns union of allowed properties for the provided class/type ids.
   */
  async getPossibleEntityProperties(types: string[], opt?: PropertyOptions) {
    const result: SlimProperty[] = []

    for (const type of types) {
      const properties = (await this.schemaGraph.getClassProperties(type)).map((node) => ({
        '@id': node['@id'],
        range: node.range
          ? toArray(node.range).map((r) => ({ '@id': r['@id'] }))
          : [],
        comment: node.comment
      }))

      for (const property of properties) {
        if (!result.find((p) => p['@id'] === property['@id'])) {
          result.push(property)
        }
      }
    }

    return Array.from(result).filter((p) =>
      opt?.onlyReferences ? referenceCheck(p.range.map((r) => r['@id'])) : true
    )
  }
}
