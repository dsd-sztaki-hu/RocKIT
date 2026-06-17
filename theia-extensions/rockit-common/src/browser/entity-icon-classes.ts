import { codicon } from '@theia/core/lib/browser/widgets/widget'
import * as mime from 'mime-types'

const ARCHIVE_FILE_SUFFIXES = ['.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst']
const ARCHIVE_EXTENSIONS = new Set([
    '.zip',
    '.gz',
    '.bz2',
    '.xz',
    '.zst',
    '.7z',
    '.rar',
    '.tgz',
    '.tar',
    '.jar',
    '.war',
])
const MEDIA_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.svg',
    '.bmp',
    '.ico',
    '.tif',
    '.tiff',
    '.mp4',
    '.m4v',
    '.mov',
    '.avi',
    '.mkv',
    '.webm',
    '.mp3',
    '.wav',
    '.flac',
    '.ogg',
    '.m4a',
])
const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.adoc', '.rtf'])
const DATA_EXTENSIONS = new Set([
    '.json',
    '.jsonc',
    '.yaml',
    '.yml',
    '.toml',
    '.xml',
    '.xsd',
    '.xsl',
    '.csv',
    '.tsv',
])
const CODE_EXTENSIONS = new Set([
    '.c',
    '.cc',
    '.cpp',
    '.cxx',
    '.h',
    '.hh',
    '.hpp',
    '.hxx',
    '.java',
    '.kt',
    '.kts',
    '.scala',
    '.go',
    '.rs',
    '.swift',
    '.cs',
    '.php',
    '.py',
    '.rb',
    '.lua',
    '.pl',
    '.r',
    '.dart',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.ts',
    '.tsx',
    '.vue',
    '.svelte',
    '.html',
    '.htm',
    '.css',
    '.scss',
    '.sass',
    '.less',
])
const SCRIPT_EXTENSIONS = new Set(['.sh', '.bash', '.zsh', '.fish', '.ps1', '.psm1', '.bat', '.cmd'])
const DATABASE_EXTENSIONS = new Set(['.sql', '.sqlite', '.sqlite3', '.db', '.duckdb'])
const CONFIG_EXTENSIONS = new Set(['.ini', '.conf', '.config', '.cfg', '.properties', '.env', '.editorconfig'])
const CONFIG_FILE_NAMES = new Set([
    '.env',
    '.env.local',
    '.env.development',
    '.env.production',
    '.gitignore',
    '.gitattributes',
    '.npmrc',
    '.yarnrc',
    '.editorconfig',
    '.prettierrc',
    '.eslintrc',
    'dockerfile',
    'compose.yml',
    'compose.yaml',
    'docker-compose.yml',
    'docker-compose.yaml',
    'makefile',
])
const FOLDER_MEDIA_NAMES = new Set(['images', 'image', 'img', 'media', 'assets', 'videos', 'video', 'audio', 'icons'])
const FOLDER_CODE_NAMES = new Set([
    'src',
    'source',
    'js',
    'javascript',
    'ts',
    'typescript',
    'scripts',
    'script',
    'lib',
    'app',
    'apps',
    'components',
])
const FOLDER_DOC_NAMES = new Set(['docs', 'doc', 'documentation'])
const FOLDER_DATA_NAMES = new Set(['data', 'datasets', 'dataset', 'db', 'database', 'schemas', 'schema'])
const FOLDER_CONFIG_NAMES = new Set(['config', 'configs', 'settings', '.github', '.gitlab', '.vscode'])
const FOLDER_PACKAGE_NAMES = new Set(['node_modules', 'vendor', 'packages', 'plugins', 'extensions'])
const FOLDER_TEST_NAMES = new Set(['test', 'tests', '__tests__', 'spec', 'specs'])

export interface EntityIconClassOptions {
    baseClass: string
    fileClass: string
    folderClass: string
    fileModifierPrefix: string
    folderModifierPrefix: string
}

export function getSharedDatasetIconClass(
    folderName: string,
    isExpanded: boolean,
    options: EntityIconClassOptions,
): string {
    const normalizedName = `${folderName ?? ''}`.trim().toLowerCase()
    const folderGlyph = isExpanded ? codicon('folder-opened') : codicon('folder')
    const classes = [folderGlyph, options.baseClass, options.folderClass].filter(Boolean)
    const modifier = getFolderModifier(normalizedName)
    if (modifier) {
        classes.push(`${options.folderModifierPrefix}${modifier}`)
    }
    return classes.join(' ')
}

export function getSharedFileIconClass(
    fileName: string,
    encodingFormat: string | undefined,
    options: EntityIconClassOptions,
    fallbackWhenUnknown = true,
): string | undefined {
    const normalizedFileName = `${fileName ?? ''}`.trim().toLowerCase()
    if (!normalizedFileName) {
        return fallbackWhenUnknown
            ? [codicon('file'), options.baseClass, options.fileClass].filter(Boolean).join(' ')
            : undefined
    }

    const normalizedEncoding = `${encodingFormat ?? ''}`.trim().toLowerCase()
    const ext = resolveFileExtension(normalizedFileName, normalizedEncoding)
    const icon = getFileIcon(normalizedFileName, ext, normalizedEncoding)
    if (!icon) {
        return fallbackWhenUnknown
            ? [codicon('file'), options.baseClass, options.fileClass].filter(Boolean).join(' ')
            : undefined
    }

    return [
        codicon(icon.codicon),
        options.baseClass,
        options.fileClass,
        `${options.fileModifierPrefix}${icon.modifier}`,
    ]
        .filter(Boolean)
        .join(' ')
}

function getFolderModifier(folderName: string): string | undefined {
    if (FOLDER_MEDIA_NAMES.has(folderName)) {
        return 'media'
    }
    if (FOLDER_CODE_NAMES.has(folderName)) {
        return 'code'
    }
    if (FOLDER_DOC_NAMES.has(folderName)) {
        return 'document'
    }
    if (FOLDER_DATA_NAMES.has(folderName)) {
        return 'data'
    }
    if (FOLDER_CONFIG_NAMES.has(folderName)) {
        return 'config'
    }
    if (FOLDER_PACKAGE_NAMES.has(folderName)) {
        return 'package'
    }
    if (FOLDER_TEST_NAMES.has(folderName)) {
        return 'test'
    }
    return undefined
}

function getFileIcon(
    fileName: string,
    ext: string,
    normalizedEncoding: string,
): { codicon: string; modifier: string } | undefined {
    if (
        normalizedEncoding.startsWith('image/') ||
        normalizedEncoding.startsWith('video/') ||
        normalizedEncoding.startsWith('audio/')
    ) {
        return { codicon: 'file-media', modifier: 'media' }
    }
    if (normalizedEncoding === 'text/plain' || normalizedEncoding.startsWith('text/plain;')) {
        return { codicon: 'file-text', modifier: 'text' }
    }
    if (ext === '.pdf') {
        return { codicon: 'file-pdf', modifier: 'document' }
    }
    if (ext === '.txt') {
        return { codicon: 'file-text', modifier: 'text' }
    }
    if (ARCHIVE_EXTENSIONS.has(ext) || ARCHIVE_FILE_SUFFIXES.some((suffix) => fileName.endsWith(suffix))) {
        return { codicon: 'file-zip', modifier: 'archive' }
    }
    if (MEDIA_EXTENSIONS.has(ext)) {
        return { codicon: 'file-media', modifier: 'media' }
    }
    if (DATABASE_EXTENSIONS.has(ext)) {
        return { codicon: 'database', modifier: 'database' }
    }
    if (CONFIG_EXTENSIONS.has(ext) || CONFIG_FILE_NAMES.has(fileName)) {
        return { codicon: 'settings-gear', modifier: 'config' }
    }
    if (DATA_EXTENSIONS.has(ext)) {
        return { codicon: 'json', modifier: 'data' }
    }
    if (DOCUMENT_EXTENSIONS.has(ext)) {
        return { codicon: 'markdown', modifier: 'document' }
    }
    if (SCRIPT_EXTENSIONS.has(ext)) {
        return { codicon: 'terminal', modifier: 'script' }
    }
    if (CODE_EXTENSIONS.has(ext)) {
        return { codicon: 'file-code', modifier: 'code' }
    }
    if (ext === '.bin' || ext === '.dat') {
        return { codicon: 'file-binary', modifier: 'binary' }
    }
    return undefined
}

function resolveFileExtension(fileName: string, normalizedEncoding: string): string {
    if (fileName.includes('.')) {
        const suffix = fileName.slice(fileName.lastIndexOf('.'))
        if (suffix) {
            return suffix
        }
    }
    if (!normalizedEncoding) {
        return ''
    }
    const extension = mime.extension(normalizedEncoding)
    return typeof extension === 'string' && extension.trim()
        ? `.${extension.trim().toLowerCase()}`
        : ''
}
