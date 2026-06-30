import { injectable } from 'inversify';
import { ApiConfig, getCollection, getCollectionUserPermissions } from '@iqss/dataverse-client-javascript';
import { DataverseApiAuthMechanism } from '@iqss/dataverse-client-javascript/dist/core/infra/repositories/ApiConfig';

export interface DataverseCollectionTreeItem {
    id: string;
    name: string;
    alias: string;
    parentAlias?: string;
    hasChildren: boolean;
}

@injectable()
export class DataverseCollectionService {
    private apiBaseUrl = '';
    private apiKey = '';

    /**
     * Initializes the Dataverse API client with the provided credentials.
     */
    public initClient(baseUrl: string, apiKey: string): void {
        const normalizedUrl = baseUrl.endsWith('/api/v1') ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/api/v1`;
        this.apiBaseUrl = normalizedUrl;
        this.apiKey = apiKey;
        ApiConfig.init(normalizedUrl, DataverseApiAuthMechanism.API_KEY, apiKey);
    }

    /**
     * Fetches only the immediate top-level collections.
     */
    public getRootCollections(): Promise<DataverseCollectionTreeItem[]> {
        return this.getChildCollections('root');
    }

    /**
     * Fetches only the immediate child collections under the provided collection.
     * Dataset entries returned by the contents endpoint are discarded.
     */
    public async getChildCollections(collectionAlias: string): Promise<DataverseCollectionTreeItem[]> {
        try {
            const collections = await this.getImmediateChildCollections(collectionAlias);
            return await this.addChildIndicators(collections);
        } catch (error) {
            console.error(`Error fetching child collections for ${collectionAlias}:`, error);
            throw error;
        }
    }

    private async getImmediateChildCollections(collectionAlias: string): Promise<DataverseCollectionTreeItem[]> {
        if (!this.apiBaseUrl) {
            throw new Error('Dataverse client is not initialized.');
        }

        const response = await fetch(
            `${this.apiBaseUrl}/dataverses/${encodeURIComponent(collectionAlias)}/contents`,
            {
                headers: this.apiKey ? { 'X-Dataverse-key': this.apiKey } : undefined
            }
        );
        if (!response.ok) {
            throw new Error(`Dataverse returned HTTP ${response.status} while loading collections.`);
        }

        const payload = await response.json();
        const items = Array.isArray(payload?.data) ? payload.data : [];
        return items
            .filter((item: any) => String(item?.type).toLowerCase() === 'dataverse')
            .map((item: any) => {
                const alias = String(item.alias ?? item.identifier ?? item.id);
                return {
                    id: alias,
                    name: String(item.name ?? item.title ?? alias),
                    alias,
                    parentAlias: collectionAlias,
                    hasChildren: false
                };
            });
    }

    private async addChildIndicators(
        collections: DataverseCollectionTreeItem[]
    ): Promise<DataverseCollectionTreeItem[]> {
        const results = [...collections];
        let nextIndex = 0;
        const workerCount = Math.min(6, results.length);

        const worker = async () => {
            while (nextIndex < results.length) {
                const index = nextIndex++;
                const collection = results[index];
                const details = await this.getCollectionDetails(collection);
                results[index] = {
                    ...details,
                    hasChildren: details.hasChildren
                        ? await this.hasChildCollections(details.alias)
                        : false
                };
            }
        };

        await Promise.all(Array.from({ length: workerCount }, () => worker()));
        return results;
    }

    private async getCollectionDetails(
        collection: DataverseCollectionTreeItem
    ): Promise<DataverseCollectionTreeItem> {
        try {
            const details = await getCollection.execute(collection.id);
            return {
                ...collection,
                id: details.alias,
                name: details.name,
                alias: details.alias,
                hasChildren: details.childCount > 0
            };
        } catch (error) {
            console.warn(`Could not load details for collection ${collection.id}:`, error);
            return collection;
        }
    }

    private async hasChildCollections(collectionAlias: string): Promise<boolean> {
        try {
            const query = new URLSearchParams({
                q: '*',
                show_facets: 'true',
                sort: 'date',
                order: 'desc',
                type: 'dataverse',
                subtree: collectionAlias,
                per_page: '10'
            });
            const response = await fetch(
                `${this.apiBaseUrl}/search?${query.toString()}`,
                {
                    headers: this.apiKey ? { 'X-Dataverse-key': this.apiKey } : undefined
                }
            );
            if (!response.ok) {
                const responseText = await response.text();
                throw new Error(
                    `Dataverse returned HTTP ${response.status}${responseText ? `: ${responseText}` : '.'}`
                );
            }
            const payload = await response.json();
            return Number(payload?.data?.total_count ?? 0) > 0;
        } catch (error) {
            console.warn(`Could not determine whether ${collectionAlias} has child collections:`, error);
            return false;
        }
    }

    /**
     * Checks if the user has permission to add a dataset to a specific collection.
     */
    public async canAddDataset(collectionId: string): Promise<boolean> {
        try {
            const permissions = await getCollectionUserPermissions.execute(collectionId);
            return permissions.canAddDataset;
        } catch (error) {
            console.error(`Error checking permissions for collection ${collectionId}:`, error);
            return false;
        }
    }
}
