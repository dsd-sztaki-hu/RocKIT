import { BinaryBuffer } from '@theia/core/lib/common/buffer'
import type URI from '@theia/core/lib/common/uri'
import type { FileService } from '@theia/filesystem/lib/browser/file-service'

const encoder = new TextEncoder()

export async function writeUtf8TextFile(
  fileService: FileService,
  resource: URI,
  value: string,
): Promise<void> {
  await fileService.writeFile(resource, BinaryBuffer.wrap(encoder.encode(value)))
}
