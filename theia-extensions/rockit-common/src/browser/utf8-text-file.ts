// *****************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// *****************************************************************************

import { BinaryBuffer, type BinaryBufferReadable } from '@theia/core/lib/common/buffer'
import type URI from '@theia/core/lib/common/uri'
import type { FileService } from '@theia/filesystem/lib/browser/file-service'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8')

export async function writeUtf8TextFile(
  fileService: FileService,
  resource: URI,
  value: string,
): Promise<void> {
  await fileService.writeFile(resource, BinaryBuffer.wrap(encoder.encode(value)))
}

export async function readUtf8TextFile(
  fileService: FileService,
  resource: URI,
): Promise<string> {
  const content = await fileService.readFile(resource)
  return decoder.decode(content.value.buffer)
}

const JSON_CHUNK_TARGET_CHARS = 256 * 1024

export async function writeJsonObjectFile(
  fileService: FileService,
  resource: URI,
  value: Record<string, unknown>,
  onGraphProgress?: (worked: number, total: number) => void,
): Promise<void> {
  const readable = createJsonObjectReadable(value, onGraphProgress)
  await fileService.writeFile(resource, readable)
}

function createJsonObjectReadable(
  value: Record<string, unknown>,
  onGraphProgress?: (worked: number, total: number) => void,
): BinaryBufferReadable {
  const tokens = serializeJsonObject(value, onGraphProgress)
  let pending = ''
  let ended = false

  return {
    read(): BinaryBuffer | null {
      if (ended) {
        return null
      }

      let chunk = pending
      pending = ''
      while (chunk.length < JSON_CHUNK_TARGET_CHARS) {
        const next = tokens.next()
        if (next.done) {
          ended = true
          break
        }
        if (
          chunk.length > 0 &&
          chunk.length + next.value.length > JSON_CHUNK_TARGET_CHARS
        ) {
          pending = next.value
          break
        }
        chunk += next.value
      }

      return chunk.length > 0 ? BinaryBuffer.fromString(chunk) : null
    },
  }
}

export function* serializeJsonObject(
  value: Record<string, unknown>,
  onGraphProgress?: (worked: number, total: number) => void,
): Generator<string> {
  const serializedProperties: Array<{
    key: string
    value: string
    graph?: unknown[]
  }> = []
  for (const key of Object.keys(value)) {
    const propertyValue = value[key]
    if (key === '@graph' && Array.isArray(propertyValue)) {
      serializedProperties.push({ key, value: '', graph: propertyValue })
      continue
    }

    const serializedValue = JSON.stringify(propertyValue, null, 2)
    if (serializedValue !== undefined) {
      serializedProperties.push({ key, value: serializedValue })
    }
  }

  if (serializedProperties.length === 0) {
    yield '{}\n'
    return
  }

  yield '{\n'
  for (
    let propertyIndex = 0;
    propertyIndex < serializedProperties.length;
    propertyIndex += 1
  ) {
    const property = serializedProperties[propertyIndex]
    yield `  ${JSON.stringify(property.key)}: `

    if (property.graph) {
      if (property.graph.length === 0) {
        yield '[]'
        onGraphProgress?.(0, 0)
      } else {
        yield '[\n'
        for (let graphIndex = 0; graphIndex < property.graph.length; graphIndex += 1) {
          const serializedEntity =
            JSON.stringify(property.graph[graphIndex], null, 2) ?? 'null'
          yield indentMultiline(serializedEntity, 4)
          if (graphIndex < property.graph.length - 1) {
            yield ','
          }
          yield '\n'
          if (graphIndex % 250 === 0) {
            onGraphProgress?.(graphIndex + 1, property.graph.length)
          }
        }
        onGraphProgress?.(property.graph.length, property.graph.length)
        yield '  ]'
      }
    } else {
      yield indentContinuationLines(property.value, 2)
    }

    if (propertyIndex < serializedProperties.length - 1) {
      yield ','
    }
    yield '\n'
  }
  yield '}\n'
}

function indentMultiline(value: string, spaces: number): string {
  const indentation = ' '.repeat(spaces)
  return `${indentation}${value.replace(/\n/g, `\n${indentation}`)}`
}

function indentContinuationLines(value: string, spaces: number): string {
  const indentation = ' '.repeat(spaces)
  return value.replace(/\n/g, `\n${indentation}`)
}
