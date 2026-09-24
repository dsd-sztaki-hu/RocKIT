// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser'
import { DisposableCollection } from '@theia/core/lib/common'
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser'
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor'
import * as monaco from '@theia/monaco-editor-core'
import { inject, injectable } from '@theia/core/shared/inversify'

@injectable()
export class FileEditorLanguageContribution
  implements FrontendApplicationContribution
{
  protected readonly toDispose = new DisposableCollection()

  @inject(EditorManager)
  protected readonly editorManager: EditorManager

  onStart(): void {
    this.registerLanguages()

    for (const widget of this.editorManager.all) {
      this.applyLanguage(widget)
    }

    this.toDispose.push(
      this.editorManager.onCreated((widget) => this.applyLanguage(widget)),
    )
  }

  protected applyLanguage(widget: EditorWidget): void {
    const enforceLanguage = () => this.setLanguage(widget)

    this.setLanguage(widget)
    this.toDispose.push(
      widget.editor.onLanguageChanged(() => {
        enforceLanguage()
      }),
    )

    // The Monaco model can finish attaching after the editor widget is created.
    window.setTimeout(enforceLanguage, 0)
    window.setTimeout(enforceLanguage, 250)
    window.setTimeout(enforceLanguage, 1000)
  }

  protected setLanguage(widget: EditorWidget): void {
    const editor = MonacoEditor.get(widget)
    if (!editor) {
      return
    }

    const language = this.guessLanguage(editor.uri.path.base)
    if (language && editor.document.languageId !== language) {
      editor.setLanguage(language)
    }
  }

  protected guessLanguage(fileName: string): string | undefined {
    const fileExtension = fileName.split('.').pop()?.toLowerCase() || ''
    const languageMap: { [key: string]: string } = {
      js: 'javascript',
      cjs: 'javascript',
      mjs: 'javascript',
      jsx: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      html: 'html',
      htm: 'html',
      css: 'css',
      json: 'json',
      jsonc: 'jsonc',
      jsonld: 'json',
      xml: 'xml',
      java: 'java',
      py: 'python',
      cpp: 'cpp',
      c: 'c',
      h: 'c',
      hpp: 'cpp',
      go: 'go',
      rs: 'rust',
      sh: 'shell',
      yaml: 'yaml',
      yml: 'yaml',
      md: 'markdown',
      txt: 'plaintext',
      sql: 'sql',
      php: 'php',
      rb: 'ruby',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      cs: 'csharp',
    }

    return languageMap[fileExtension]
  }

  protected registerLanguages(): void {
    this.registerLanguage('json', ['.json', '.jsonld'], ['JSON', 'json'])
    this.registerLanguage('jsonc', ['.jsonc'], ['JSON with Comments', 'jsonc'])
    this.registerLanguage('html', ['.html', '.htm'], ['HTML', 'html'])
    this.registerLanguage('css', ['.css'], ['CSS', 'css'])

    monaco.languages.setMonarchTokensProvider('json', this.createJsonTokenizer())
    monaco.languages.setMonarchTokensProvider('jsonc', this.createJsonTokenizer())
    monaco.languages.setMonarchTokensProvider('html', this.createHtmlTokenizer())
    monaco.languages.setMonarchTokensProvider('css', this.createCssTokenizer())

    monaco.languages.setLanguageConfiguration('json', {
      brackets: [
        ['{', '}'],
        ['[', ']'],
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '"', close: '"' },
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '"', close: '"' },
      ],
    })

    monaco.languages.setLanguageConfiguration('html', {
      comments: {
        blockComment: ['<!--', '-->'],
      },
      brackets: [
        ['<!--', '-->'],
        ['<', '>'],
      ],
      autoClosingPairs: [
        { open: '<', close: '>' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    })
  }

  protected registerLanguage(
    id: string,
    extensions: string[],
    aliases: string[],
  ): void {
    if (monaco.languages.getLanguages().some((language) => language.id === id)) {
      return
    }

    monaco.languages.register({
      id,
      extensions,
      aliases,
    })
  }

  protected createJsonTokenizer(): monaco.languages.IMonarchLanguage {
    return {
      tokenizer: {
        root: [
          [/\s+/, 'white'],
          [/\/\/.*$/, 'comment'],
          [/\/\*/, 'comment', '@comment'],
          [/[{}\[\],]/, 'delimiter'],
          [/:/, 'delimiter'],
          [/"([^"\\]|\\.)*"\s*(?=:)/, 'type.identifier'],
          [/"([^"\\]|\\.)*"/, 'string'],
          [/-?\d+(\.\d+)?([eE][+-]?\d+)?/, 'number'],
          [/\b(?:true|false)\b/, 'keyword'],
          [/\bnull\b/, 'keyword'],
        ],
        comment: [
          [/[^\/*]+/, 'comment'],
          [/\*\//, 'comment', '@pop'],
          [/[\/*]/, 'comment'],
        ],
      },
    }
  }

  protected createHtmlTokenizer(): monaco.languages.IMonarchLanguage {
    return {
      tokenizer: {
        root: [
          [/<!DOCTYPE[^>]*>/, 'metatag'],
          [/<!--/, 'comment', '@comment'],
          [/<\/?[a-zA-Z][\w:-]*/, 'tag', '@tag'],
          [/[^<]+/, ''],
        ],
        tag: [
          [/\s+/, 'white'],
          [/[a-zA-Z_:][\w:.-]*(?=\s*=)/, 'attribute.name'],
          [/=/, 'delimiter'],
          [/"[^"]*"/, 'string'],
          [/'[^']*'/, 'string'],
          [/\/?>/, 'tag', '@pop'],
        ],
        comment: [
          [/[^-]+/, 'comment'],
          [/-->/, 'comment', '@pop'],
          [/-/, 'comment'],
        ],
      },
    }
  }

  protected createCssTokenizer(): monaco.languages.IMonarchLanguage {
    return {
      tokenizer: {
        root: [
          [/\s+/, 'white'],
          [/\/\*/, 'comment', '@comment'],
          [/[.#]?[a-zA-Z_-][\w-]*(?=\s*\{)/, 'tag'],
          [/[a-zA-Z-]+(?=\s*:)/, 'attribute.name'],
          [/#[0-9a-fA-F]{3,8}/, 'number.hex'],
          [/[{}:;,]/, 'delimiter'],
          [/"[^"]*"|'[^']*'/, 'string'],
          [/-?\d+(\.\d+)?(px|em|rem|%|vh|vw)?/, 'number'],
          [/[a-zA-Z_-][\w-]*/, 'keyword'],
        ],
        comment: [
          [/[^\/*]+/, 'comment'],
          [/\*\//, 'comment', '@pop'],
          [/[\/*]/, 'comment'],
        ],
      },
    }
  }
}
