// src\browser\services\schema-api.ts
// This is a legacy code, please do not modify these, its important to keep these files as it is currently.

import axios from "axios";
import { to } from "await-to-js";
import * as jsonpath from "jsonpath";
import log from 'loglevel';
import { nls } from '@theia/core/lib/common/nls';


export class SchemaApi {
  userId?: string
  apiKey?: string
  domainBase: string
  publicFolderId?: string
  proxyUrl?: string

  constructor(args?: {
    domainBase?: string
    apiKey?: string
    userId?: string
    proxyUrl?: string,
  }) {
    this.apiKey = args?.apiKey
    this.domainBase = args?.domainBase ? args.domainBase : "arp.orgx"
    this.userId = args?.userId
    this.proxyUrl = args?.proxyUrl
  }

  private baseUrl(module: string) {
    return `https://${module}.${this.domainBase}`
  }

  private authHeaders() {
    return this.apiKey ? {Authorization: `apiKey ${this.apiKey}`} : {}
  }

  private doGet(url: string, axiosConfig: {}) {
    let actualUrl = url;
    if (this.proxyUrl) {
      actualUrl = this.proxyUrl + encodeURIComponent(url);
    }
    if (!axios || !axios.get) {
        throw new Error(nls.localize(
          'rockit/schemaManager/axiosNotInitialized',
          'Axios library was not initialized correctly.',
        ));
    }
    return axios.get(actualUrl, axiosConfig)
  }

  private jsonQuery(obj: any, query: string): any[] {
      try {
          return jsonpath.query(obj, query);
      } catch (e) {
          console.warn("Standard jsonpath.query failed, attempting fallback...", e);
          try {
              return (jsonpath as any).default.query(obj, query);
          } catch (e2) {
             console.error("Critical JSONPath Error:", e2);
             return [];
          }
      }
  }

  private async addTemplates(folders: string[], allTemplates: any[]) {
    const folderRequests = folders.map((f) => {
      return this.listFolder(f)
    })

    const [folderReqErr, folderReqRes] = await to(Promise.all(folderRequests))
    if (folderReqErr) throw folderReqErr

    const addTemplatesReqs = folderReqRes?.map(async (res) => {
      const templates = this.jsonQuery(res, "$.resources[?(@.resourceType=='template')]");
      allTemplates.push(...templates)

      const folders = this.jsonQuery(res, "$.resources[?(@.resourceType=='folder')]");
      const folderIds = folders.map((f: any) => f["@id"])
      
      return this.addTemplates(folderIds, allTemplates)
    })

    const [addTemplatesReqsErr, _] = await to(Promise.all(addTemplatesReqs))
    if (addTemplatesReqsErr) throw addTemplatesReqsErr
  }

  async listAllSchema() {
    const [idErr, idRes] = await to(this.getPublicFolderId())
    if (idErr) throw idErr

    const allTemplates: any[] = []
    const [err, res] = await to(this.addTemplates([idRes], allTemplates))
    if (err) throw err

    return allTemplates
  }

  async getPublicFolderId() {
    if (!this.publicFolderId) {
      const url = this.baseUrl("resource") +
        "/search?sharing=shared-with-everybody&publication_status=all&q=public&resource_types=folder&version=all"
      
      const [err, res] = await to(this.doGet(url, { headers: this.authHeaders() }))
      
      if (err) {
          console.error("Failed to get public folder ID", err);
          throw err;
      }

      const id = this.jsonQuery(res.data, "$.resources[0]['@id']")
      
      if (!id || id.length == 0) {
        console.warn("Could not find public folder ID in response", res.data);
        throw Error(nls.localize(
          'rockit/schemaManager/publicFolderIdMissing',
          "Public folder's ID is missing at '/resources/0/@id'.",
        ));
      }
      this.publicFolderId = id[0]
    }
    return this.publicFolderId!
  }

  async listPublicFolder() {
    const [idErr, idRes] = await to(this.getPublicFolderId())
    if (idErr) throw idErr
    return this.listFolder(idRes)
  }

  async listUserFolder(userId?: string) {
    const actualUserId = userId ?? this.userId
    if (!actualUserId) throw Error(nls.localize(
      'rockit/schemaManager/userIdMissing',
      'No user ID was specified.',
    ))
    
    const url = this.baseUrl("user") + `/users/${actualUserId}`
    const [userErr, userRes] = await to(this.doGet(url, { headers: this.authHeaders() }))
    if (userErr) throw userErr

    const homeFolderId = this.jsonQuery(userRes.data, "$.homeFolderId")
    return await this.listFolder(homeFolderId[0])
  }

  async listFolder(folderId: string) {
    const url = this.baseUrl("resource") + "/folders/" + encodeURIComponent(folderId) +
      "/contents?limit=100&offset=0&publication_status=all&resource_types=template,folder&sort=name&version=all"
    
    const [err, res] = await to(this.doGet(url, { headers: this.authHeaders() }))
    if (err) throw err

    return res.data
  }

  async downloadSchema(schemaId: string) {
    const url = this.baseUrl("resource") + `/templates/` + encodeURIComponent(schemaId)
    const [err, res] = await to(this.doGet(url, { headers: this.authHeaders() }))
    if (err) throw err
    return res.data
  }
}
