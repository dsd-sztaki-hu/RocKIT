import { toArray } from '../utils'
import type { IReference } from '../types'

/**
 * Generic schema node from Schema.org/BioSchemas/etc. For easier handling, should be used to
 * construct a {@link SchemaNode}.
 */
export interface ISchemaNode {
  '@id': string
  '@type': string | string[]
  'rdfs:comment'?: string | { '@language': string; '@value': string }
  'rdfs:label'?: string | { '@language': string; '@value': string }
  'skos:definition'?: string | { '@language': string; '@value': string }
  'skos:note'?: string | { '@language': string; '@value': string }
  'rdfs:subClassOf'?: IReference | IReference[]
  'rdfs:subPropertyOf'?: IReference | IReference[]
  [key: string]: unknown
  [key: `${string}:${'rangeIncludes' | 'domainIncludes' | 'range' | 'domain'}`]:
    | IReference
    | IReference[]
    | undefined
}

/**
 * Represents an entry in the @graph array of a JSON-LD schema file used in the context of RO-Crates.
 * Provides helper methods/properties for schema traversal and validation.
 */
export class SchemaNode {
  private readonly node: ISchemaNode

  constructor(node: ISchemaNode) {
    this.node = node
  }

  get '@id'() {
    return this.node['@id']
  }

  get parentClass() {
    return this.node['rdfs:subClassOf']
  }

  get parentProperty() {
    return this.node['rdfs:subPropertyOf']
  }

  get comment() {
    return this.node['rdfs:comment'] ?? this.node['skos:definition'] ?? this.node['skos:note']
  }

  get domain() {
    const key = Object.keys(this.node).find((k) => k.endsWith(':domainIncludes')) as
      | `${string}:domainIncludes`
      | undefined
    const keyFallback = Object.keys(this.node).find((k) =>
      k.endsWith(':domain')
    ) as `${string}:domain`
    if (key ?? keyFallback) {
      return this.node[key ?? keyFallback]
    }
    return undefined
  }

  get range() {
    const key = Object.keys(this.node).find((k) => k.endsWith(':rangeIncludes')) as
      | `${string}:rangeIncludes`
      | undefined
    const keyFallback = Object.keys(this.node).find((k) =>
      k.endsWith(':range')
    ) as `${string}:range`
    if (key || keyFallback) {
      return this.node[key || keyFallback]
    }
    return undefined
  }

  /**
   * Returns whether the node is a property class.
   */
  isProperty() {
    return toArray(this.node['@type']).includes('http://www.w3.org/1999/02/22-rdf-syntax-ns#Property')
  }

  /**
   * Returns whether the node is a class definition.
   */
  isClass() {
    return toArray(this.node['@type']).includes('http://www.w3.org/2000/01/rdf-schema#Class')
  }

  /**
   * Checks if this property node directly belongs to the provided class.
   */
  isDirectPropertyOfClass(classId: string) {
    if (!this.domain) return false
    return Array.isArray(this.domain)
      ? this.domain.map((ref) => ref['@id']).includes(classId)
      : this.domain['@id'] === classId
  }

  /**
   * Checks if this class node directly subclasses the provided class.
   */
  isDirectSubClassOf(classId: string) {
    if (!this.parentClass) return false
    return Array.isArray(this.parentClass)
      ? this.parentClass.map((ref) => ref['@id']).includes(classId)
      : this.parentClass['@id'] === classId
  }

  /**
   * Checks if this property node directly sub-properties the provided property.
   */
  isDirectSubPropertyOf(propertyId: string) {
    if (!this.parentProperty) return false
    return Array.isArray(this.parentProperty)
      ? this.parentProperty.map((ref) => ref['@id']).includes(propertyId)
      : this.parentProperty['@id'] === propertyId
  }

  /**
   * Create a new SchemaNode and expand all compact IRIs anywhere in the node using the schema context.
   * ⚠ Property names are not changed.
   * @param node Schema node from a schema file
   * @param context Context map of the schema file
   */
  static createWithContext(node: ISchemaNode, context: Map<string, string>) {
    if (!node || typeof node !== 'object') {
      throw new Error(`invalid node of type ${typeof node} in SchemaNode.createWithContext`)
    }
    if (!context) {
      throw new Error(`invalid context of type ${typeof context} in SchemaNode.createWithContext`)
    }

    function handleString(str: string): string {
      const match = /^([a-z0-9]+):.+$/.exec(str)
      if (match != null) {
        const replaceWith = context.get(match[1])
        return replaceWith ? str.replace(match[1] + ':', replaceWith) : str
      }
      return str
    }

    function handleEntry(value: unknown): unknown {
      if (typeof value === 'string') return handleString(value)
      if (Array.isArray(value)) return value.map(handleEntry)
      if (typeof value === 'object' && value !== null) {
        return handleObject(value as { [index: string]: unknown })
      }
      return value
    }

    function handleObject(obj: { [key: string]: unknown }) {
      for (const [key, value] of Object.entries(obj)) {
        obj[key] = handleEntry(value)
      }
      return obj
    }

    const handled = handleObject(structuredClone(node))
    return new SchemaNode(handled as ISchemaNode)
  }
}
