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

function* serializeJsonObject(
  value: Record<string, unknown>,
  onGraphProgress?: (worked: number, total: number) => void,
): Generator<string> {
  yield '{'
  const keys = Object.keys(value)
  let firstProperty = true
  for (const key of keys) {
    if (!firstProperty) {
      yield ','
    }
    firstProperty = false
    yield `${JSON.stringify(key)}:`

    const propertyValue = value[key]
    if (key === '@graph' && Array.isArray(propertyValue)) {
      yield '['
      for (let index = 0; index < propertyValue.length; index += 1) {
        if (index > 0) {
          yield ','
        }
        yield JSON.stringify(propertyValue[index])
        if (index % 250 === 0) {
          onGraphProgress?.(index + 1, propertyValue.length)
        }
      }
      onGraphProgress?.(propertyValue.length, propertyValue.length)
      yield ']'
    } else {
      yield JSON.stringify(propertyValue)
    }
  }
  yield '}\n'
}
