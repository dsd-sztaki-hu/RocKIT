import { inject, injectable } from 'inversify';
import { SchemaValidator, ValidationError, MetadataSchemaManager } from 'aroma2-common/lib/browser';
import { validateEntities, validate } from './ro-crate-validator';

@injectable()
export class SchemaValidatorService implements SchemaValidator {
  @inject(MetadataSchemaManager) protected readonly schemaManagerService: MetadataSchemaManager

  async validateEntities(
    crate: Record<string, any>,
    baseProfile: Record<string, any>,
    profile: Record<string, any>,
    completeProfile: Record<string, any>
  ): Promise<ValidationError[] | undefined> {
    return validateEntities(crate, baseProfile, profile, completeProfile, this.schemaManagerService);
  }

  validate(entity: Record<string, any>, profile: Record<string, any>): ValidationError[] {
    return validate(entity, profile);
  }
}