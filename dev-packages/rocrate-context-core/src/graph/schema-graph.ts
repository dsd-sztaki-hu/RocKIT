import type { SchemaFile } from '../loader/types'
import { DedupedSymbol, SchemaResolver } from './schema-resolver'
import { type ISchemaNode, SchemaNode } from './schema-node'

// ! currently only works on rdf:Property and rdfs:Class but not on class/property instances

export interface LoadedSchemaInfos {
  contextEntries: number
  nodes: number
}

export class SchemaGraph {
  private graph: Map<string, SchemaNode> = new Map<string, SchemaNode>()
  // Source maps for removing schema elements from the graph without resetting it completely.
  // Maps schema id to node ids.
  private graphNodeSourceMap: Map<string, string[]> = new Map<string, string[]>()
  private loadedSchemas: Map<string, LoadedSchemaInfos> = new Map()
  private schemaIssues: Map<string, unknown> = new Map()

  constructor(private schemaResolver: SchemaResolver) {}

  /**
   * Retrieves one node by id and autoloads matching schemas on first miss.
   */
  async getNode(id: string, abortOnFail = false): Promise<SchemaNode | undefined> {
    const firstAttempt = this.graph.get(id)

    if (firstAttempt || abortOnFail) {
      return firstAttempt
    }

    const result = await this.schemaResolver.autoload(id, this.getExcludedSchemasForAutoload())

    for (const [key, schema] of result) {
      if (schema.schema) {
        this.addSchemaFromFile(key, schema.schema)
      } else {
        this.schemaIssues.set(key, schema.error)
      }
    }

    return this.getNode(id, true)
  }

  /**
   * Returns schema ids that should be excluded from subsequent autoload attempts.
   */
  private getExcludedSchemasForAutoload() {
    return [...this.loadedSchemas.keys(), ...this.schemaIssues.keys()]
  }

  /**
   * Forces loading one schema by id.
   */
  async forceSchemaLoad(schemaId: string) {
    try {
      const schema = await this.schemaResolver.forceLoad(schemaId)
      if (schema) this.addSchemaFromFile(schemaId, schema)
    } catch (err) {
      this.schemaIssues.set(schemaId, err)
    }
  }

  /**
   * Loads all currently eligible schemas.
   */
  async loadAllSchemas() {
    const results = this.schemaResolver.loadAll(this.getExcludedSchemasForAutoload())
    for (const result of results) {
      try {
        const data = await result.data
        if (data === DedupedSymbol) continue
        this.addSchemaFromFile(result.schema.id, data)
      } catch (err) {
        this.schemaIssues.set(result.schema.id, err)
      }
    }
  }

  /**
   * Returns all loaded graph nodes.
   */
  getAllNodes() {
    return Array.from(this.graph.values())
  }

  /**
   * Returns properties directly declared on a class.
   */
  async getClassSpecificProperties(classId: string) {
    if (!classId) throw new ReferenceError(`classId not specified or invalid: ${classId}`)
    const self = await this.getNode(classId)
    if (!self) return []

    const nodes: SchemaNode[] = []
    for (const [, node] of this.graph.entries()) {
      if (node.isProperty() && node.isDirectPropertyOfClass(self['@id'])) {
        nodes.push(node)
      }
    }
    return nodes
  }

  /**
   * Returns full property set for a class, including inherited class properties.
   */
  async getClassProperties(classId: string) {
    const self = await this.getNode(classId)
    if (!self) {
      throw new ReferenceError('failed to get class properties, classId not specified or class does not exist')
    }
    const parents = await this.getClassParents(self['@id'])
    const properties: Set<SchemaNode> = new Set<SchemaNode>()
    for (const nodeId of [...parents, self['@id']]) {
      const props = await this.getClassSpecificProperties(nodeId)
      for (const prop of props) properties.add(prop)
    }
    return Array.from(properties)
  }

  /**
   * Returns transitive parent class ids.
   */
  async getClassParents(classId: string): Promise<string[]> {
    let parentIds: string[] = []
    if (!classId) throw new ReferenceError('classId not specified or invalid')
    const self = await this.getNode(classId)
    if (!self) return []
    if (!self.isClass()) throw new Error('Node is not a class')

    if (self.parentClass) {
      if (Array.isArray(self.parentClass)) {
        for (const entry of self.parentClass) {
          parentIds.push(entry['@id'])
          parentIds = parentIds.concat(await this.getClassParents(entry['@id']))
        }
      } else {
        parentIds.push(self.parentClass['@id'])
        parentIds = parentIds.concat(await this.getClassParents(self.parentClass['@id']))
      }
    }

    return parentIds
  }

  /**
   * Returns transitive parent property ids.
   */
  async getPropertyParents(propertyId: string): Promise<string[]> {
    let parentIds: string[] = []
    const self = await this.getNode(propertyId)
    if (!self) throw new ReferenceError('propertyId not specified or invalid')
    if (!self.isProperty()) throw new Error('Node is not a property')

    if (self.parentProperty) {
      if (Array.isArray(self.parentProperty)) {
        for (const entry of self.parentProperty) {
          parentIds.push(entry['@id'])
          parentIds = parentIds.concat(await this.getPropertyParents(entry['@id']))
        }
      } else {
        parentIds.push(self.parentProperty['@id'])
        parentIds = parentIds.concat(await this.getPropertyParents(self.parentProperty['@id']))
      }
    }

    return parentIds
  }

  /**
   * Returns transitive subclass ids for a class.
   */
  async getSubClasses(classId: string): Promise<string[]> {
    const childrenIds: Set<string> = new Set<string>()
    const self = await this.getNode(classId)
    if (!self) throw new ReferenceError(`classId ${classId} not specified or invalid`)
    if (!self.isClass()) throw new Error(`Node ${self['@id']} is not a class`)

    for (const [, node] of this.graph.entries()) {
      if (node.isClass() && node.isDirectSubClassOf(self['@id'])) {
        childrenIds.add(node['@id'])
        const subChildren = await this.getSubClasses(node['@id'])
        for (const child of subChildren) childrenIds.add(child)
      }
    }

    return Array.from(childrenIds)
  }

  /**
   * Returns transitive subproperty ids for a property.
   */
  async getSubProperties(propertyId: string): Promise<string[]> {
    const childrenIds: Set<string> = new Set<string>()
    const self = await this.getNode(propertyId)
    if (!self) throw new ReferenceError('propertyId not specified or invalid')
    if (!self.isProperty()) throw new Error('Node is not a property')

    for (const [, node] of this.graph.entries()) {
      if (node.isProperty() && node.isDirectSubPropertyOf(self['@id'])) {
        childrenIds.add(node['@id'])
        const subChildren = await this.getSubProperties(node['@id'])
        for (const child of subChildren) childrenIds.add(child)
      }
    }

    return Array.from(childrenIds)
  }

  /**
   * Checks whether a property (or any of its parent properties) is valid for a class.
   */
  async isPropertyOfClass(propertyId: string, classId: string) {
    const property = await this.getNode(propertyId)
    if (!property) throw new ReferenceError('propertyId is not specified or invalid')
    const classProperties = await this.getClassProperties(classId)
    const propertyParents = await this.getPropertyParents(propertyId)
    propertyParents.push(property['@id'])

    for (const classProperty of classProperties) {
      if (propertyParents.includes(classProperty['@id'])) {
        return true
      }
    }

    return false
  }

  /**
   * Adds one parsed schema file into the in-memory graph.
   */
  addSchemaFromFile(id: string, schema: SchemaFile) {
    let loadedContextEntries = 0
    let loadedNodes = 0

    const sourceMapSchemaNodes: string[] = []
    const context = new Map<string, string>()

    const rawContext = schema['@context']
    const contextEntries = Array.isArray(rawContext) ? rawContext : [rawContext]
    for (const contextEntry of contextEntries) {
      if (typeof contextEntry === 'object' && contextEntry !== null) {
        for (const [key, value] of Object.entries(contextEntry)) {
          if (typeof value === 'string') {
            context.set(key, value)
            loadedContextEntries += 1
          }
        }
      }
    }

    for (const node of schema['@graph']) {
      const schemaNode = SchemaNode.createWithContext(node as ISchemaNode, context)
      this.addNode(schemaNode)
      sourceMapSchemaNodes.push(schemaNode['@id'])
      loadedNodes += 1
    }

    this.loadedSchemas.set(id, {
      contextEntries: loadedContextEntries,
      nodes: loadedNodes
    })
    this.graphNodeSourceMap.set(id, sourceMapSchemaNodes)
  }

  /**
   * Removes all nodes sourced from one schema id.
   */
  unloadSchema(id: string) {
    const graphNodeIds = this.graphNodeSourceMap.get(id)

    if (graphNodeIds) {
      for (const nodeId of graphNodeIds) {
        this.graph.delete(nodeId)
      }
    }

    this.loadedSchemas.delete(id)
    this.schemaIssues.delete(id)
  }

  /**
   * Adds or replaces one graph node.
   */
  addNode(entry: SchemaNode) {
    this.graph.set(entry['@id'], entry)
  }

  /**
   * For host user interfaces and diagnostics.
   */
  getSchemaStatus() {
    return { loadedSchemas: this.loadedSchemas, schemaIssues: this.schemaIssues }
  }
}

export type SchemaStatus = ReturnType<InstanceType<typeof SchemaGraph>['getSchemaStatus']>
