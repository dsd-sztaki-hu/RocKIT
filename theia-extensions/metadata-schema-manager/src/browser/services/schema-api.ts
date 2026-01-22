import axios from "axios"
import { to } from "await-to-js"
import * as JsonPath from "jsonpath"
import log from 'loglevel';

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
    //https.globalAgent.options.rejectUnauthorized = false
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
    return axios.get(actualUrl, axiosConfig)
  }

  private async addTemplates(folders: string[], allTemplates: any[]) {
    const folderRequests = folders.map((f) => {
      return this.listFolder(f)
    })

    // Collect folders
    const [folderReqErr, folderReqRes] = await to(Promise.all(folderRequests))
    if (folderReqErr) {
      throw folderReqErr
    }

    // Collect templates and recurse
    const addTemplatesReqs = folderReqRes?.map(async (res) => {
      const templates = JsonPath.query(
        res,
        "$.resources[?(@.resourceType=='template')]"
      )
      allTemplates.push(...templates)

      const folders = JsonPath.query(
        res,
        "$.resources[?(@.resourceType=='folder')]"
      )

      const folderIds = folders.map((f: any) => f["@id"])
      return this.addTemplates(folderIds, allTemplates)
    })

    const [addTemplatesReqsErr, _] = await to(Promise.all(addTemplatesReqs))
    if (addTemplatesReqsErr) {
      throw addTemplatesReqsErr
    }
  }

  async listAllSchema() {
    const [idErr, idRes] = await to(this.getPublicFolderId())
    if (idErr) {
      throw idErr
    }

    const allTemplates: any[] = []
    const [err, res] = await to(this.addTemplates([idRes], allTemplates))
    if (err) {
      throw err
    }

    return allTemplates
  }

  async getPublicFolderId() {
    if (!this.publicFolderId) {
      const url =
        this.baseUrl("resource") +
        "/search?sharing=shared-with-everybody&publication_status=all&q=public&resource_types=folder&version=all"
      // log.debug("url", url)
      const [err, res] = await to(
        this.doGet(url, {
          headers: this.authHeaders(),
        })
      )
      if (err) {
        throw err
      }

      const id = JsonPath.query(res.data, "$.resources[0]['@id']")
      if (id.length == 0) {
        throw Error(
          "Public folder's ID missing at '/resources/0/@id' in " +
          JSON.stringify(res.data)
        )
      }
      this.publicFolderId = id[0]
    }

    return this.publicFolderId!
  }

  async listPublicFolder() {
    const [idErr, idRes] = await to(this.getPublicFolderId())
    if (idErr) {
      throw idErr
    }

    return this.listFolder(idRes)
  }

  async listUserFolder(userId?: string) {
    const actualUserId = userId ?? this.userId
    if (!actualUserId) {
      throw Error("No user ID specified")
    }
    const url = this.baseUrl("user") + `/users/${actualUserId}`
    // log.debug("url", url)
    const [userErr, userRes] = await to(
      this.doGet(url, {
        headers: this.authHeaders(),
      })
    )
    if (userErr) {
      throw userErr
    }

    const homeFolderId = JsonPath.query(userRes.data, "$.homeFolderId")
    return await this.listFolder(homeFolderId[0])
  }

  async listFolder(folderId: string) {
    const url =
      this.baseUrl("resource") +
      "/folders/" +
      encodeURIComponent(folderId) +
      "/contents?limit=100&offset=0&publication_status=all&resource_types=template,folder&sort=name&version=all"
    // log.debug("url", url)
    const [err, res] = await to(
      this.doGet(url, {
        headers: this.authHeaders(),
      })
    )
    if (err) {
      throw err
    }

    return res.data
  }

  async findSchema(searchWord: string) {
    const url =
      this.baseUrl("resource") +
      `/search?q=${searchWord}&sharing=shared-with-everybody&limit=100&offset=0&publication_status=all&resource_types=template&version=all`
    const [err, res] = await to(
      this.doGet(url, {
        headers: this.authHeaders(),
      })
    )
    if (err) {
      throw err
    }

    return res.data
  }

  async downloadSchema(schemaId: string) {
    const url =
      this.baseUrl("resource") + `/templates/` + encodeURIComponent(schemaId)
    const [err, res] = await to(
      this.doGet(url, {
        headers: this.authHeaders(),
      })
    )
    if (err) {
      throw err
    }

    return res.data
  }
}