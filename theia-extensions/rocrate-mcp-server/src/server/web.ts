// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { getRuntimeEnvValue } from './runtime-config'
import type { DownloadUrlParams, WebSearchParams } from './types'
import { getServerUserAgent } from './version'

type TelemetryCollector = {
  recordDependencyCall: (dependency: string, success: boolean, latencyMs: number) => void
}

/**
 * Handles create web handlers.
 */
export function createWebHandlers(deps: {
  getTelemetryCollector: () => TelemetryCollector | null
}) {
  /**
   * Handles decode html entities.
   */
  function decodeHtmlEntities(value: string): string {
    return value
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
  }

  /**
   * Handles html to text.
   */
  function htmlToText(html: string): string {
    const withoutScripts = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    const withLineHints = withoutScripts
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|td|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
    const decoded = decodeHtmlEntities(withLineHints)
    return decoded
      .split(/\r?\n/g)
      .map((line) => line.trim().replace(/\s+/g, ' '))
      .filter((line) => line.length > 0)
      .join('\n')
  }

  /**
   * Handles fetch with timeout.
   */
  async function fetchWithTimeout(
    url: string,
    timeoutMs: number,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, timeoutMs)
    try {
      return await fetch(url, {
        ...init,
        redirect: 'follow',
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * Handles fetch text with timeout.
   */
  async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    return fetchWithTimeout(url, timeoutMs, {
      method: 'GET',
      headers: {
        'user-agent': getServerUserAgent(),
      },
    })
  }

  /**
   * Handles parse web search params.
   */
  function parseWebSearchParams(params: Record<string, unknown>): WebSearchParams {
    const query = typeof params.query === 'string' ? params.query.trim() : ''
    if (query === '') {
      throw new Error('search requires non-empty query.')
    }
    const maxResults =
      typeof params.max_results === 'number' && Number.isFinite(params.max_results)
        ? Math.max(1, Math.min(20, Math.floor(params.max_results)))
        : 5
    const includeRawContent = params.include_raw_content === true
    const searchDepth = params.search_depth === 'advanced' ? 'advanced' : 'basic'
    const apiKey =
      typeof params.apiKey === 'string' && params.apiKey.trim() !== ''
        ? params.apiKey.trim()
        : undefined
    return {
      query,
      maxResults,
      includeRawContent,
      searchDepth,
      apiKey,
    }
  }

  /**
   * Handles run web search.
   */
  async function runWebSearch(params: WebSearchParams): Promise<unknown> {
    const collector = deps.getTelemetryCollector()
    const startTime = Date.now()

    const apiKey = getRuntimeEnvValue('TAVILY_API_KEY') ?? params.apiKey
    if (!apiKey) {
      throw new Error(
        'search requires Tavily API key: set TAVILY_API_KEY on server or pass apiKey parameter.',
      )
    }
    const endpoint = process.env.TAVILY_API_URL || 'https://api.tavily.com/search'
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': getServerUserAgent(),
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: params.query,
        max_results: params.maxResults,
        include_raw_content: params.includeRawContent,
        search_depth: params.searchDepth,
      }),
    })
    const payloadText = await response.text()
    const latencyMs = Date.now() - startTime

    if (collector) {
      collector.recordDependencyCall('tavily', response.ok, latencyMs)
    }

    if (!response.ok) {
      throw new Error(
        `Tavily request failed (${response.status}): ${payloadText.slice(0, 300)}`,
      )
    }
    try {
      return JSON.parse(payloadText) as unknown
    } catch {
      throw new Error('Tavily response was not valid JSON.')
    }
  }

  /**
   * Handles parse download url params.
   */
  function parseDownloadUrlParams(params: Record<string, unknown>): DownloadUrlParams {
    const url = typeof params.url === 'string' ? params.url.trim() : ''
    if (url === '') {
      throw new Error('download_url requires non-empty url.')
    }
    const rawHtml = params.raw_html === true
    const timeoutMs =
      typeof params.timeout_ms === 'number' && Number.isFinite(params.timeout_ms)
        ? Math.max(1000, Math.min(120000, Math.floor(params.timeout_ms)))
        : 10000
    const maxChars =
      typeof params.max_chars === 'number' && Number.isFinite(params.max_chars)
        ? Math.max(1000, Math.min(2_000_000, Math.floor(params.max_chars)))
        : 200000
    return {
      url,
      rawHtml,
      timeoutMs,
      maxChars,
    }
  }

  /**
   * Handles run download url.
   */
  async function runDownloadUrl(params: DownloadUrlParams): Promise<unknown> {
    const response = await fetchTextWithTimeout(params.url, params.timeoutMs)
    if (!response.ok) {
      throw new Error(`Failed to fetch page (${response.status} ${response.statusText})`)
    }
    const responseUrl = response.url || params.url
    const contentType = response.headers.get('content-type') || ''
    const fullText = await response.text()
    const truncated = fullText.length > params.maxChars
    const text = truncated ? fullText.slice(0, params.maxChars) : fullText
    const content = params.rawHtml ? text : htmlToText(text)
    return {
      url: responseUrl,
      status: response.status,
      contentType,
      rawHtml: params.rawHtml,
      truncated,
      content,
    }
  }

  return {
    parseWebSearchParams,
    runWebSearch,
    parseDownloadUrlParams,
    runDownloadUrl,
  }
}
