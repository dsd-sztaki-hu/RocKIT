import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
export declare class AgentInstructionService {
    protected readonly fileService: FileService;
    ensureAgentFiles(directoryUri: URI, agentId: string): Promise<void>;
    protected ensureAgentInstructionsFile(directoryUri: URI, agentId: string): Promise<void>;
    protected ensureManagedAgentDocsBundle(directoryUri: URI): Promise<void>;
    protected buildAgentInstructionsTemplate(agentId: string): string;
    protected upgradeAgentInstructions(existingContent: string, managedTemplate: string): string;
    protected readTextFile(uri: URI): Promise<string>;
}
//# sourceMappingURL=agent-instruction-service.d.ts.map