import { MetadataSchemaManager } from "aroma2-common/lib/browser";


export type ValidationError = {
  path: string;
  entityId: string;
  entityType: string;
  fieldName: string;
  fieldLabel: string;
  error: string;
  error_hu: string;
  errorCode: string;
};

  function extractConformsToIds(entity: Record<string, any>): string[] {
    const value: any = entity?.conformsTo
    const ids: string[] = []
    const pushId = (val: any) => {
      if (!val) return
      if (typeof val === 'string') {
        const t = val.trim()
        if (t) ids.push(t)
        return
      }
      if (typeof val === 'object') {
        const idVal = (val as any)['@id'] ?? (val as any).id
        if (typeof idVal === 'string') {
          const t = idVal.trim()
          if (t) ids.push(t)
        }
      }
    }
    if (Array.isArray(value)) {
      for (const v of value) pushId(v)
    } else {
      pushId(value)
    }
    return Array.from(new Set(ids))
  }

export async function validateEntities(crate: Record<string, any>, baseProfile: Record<string, any>, profile: Record<string, any>, completeProfile: Record<string, any>, schemaManagerService: MetadataSchemaManager) {
  if (!crate || !Array.isArray(crate["@graph"])) {
    return undefined
  }

  let validationErrors: any[] = []

  const entities: any = Object.values(crate["@graph"])

  for (const entity of entities) {
    let updatedProfile = JSON.parse(JSON.stringify(baseProfile))

    const entityType = Array.isArray(entity["@type"]) ? entity["@type"][0] : entity["@type"]
    if (entityType == "Dataset" || entityType == "File") {
      // TODO get merged profile for entity
      // Probably need a global get profile for entity fn that gets the entity id as a parameter and returns the profile
      // To find this entity easier, we also need to make findEntity global
      const conformsToIds = extractConformsToIds(entity)
      
      const allSchemas = await schemaManagerService.loadAllSchemas()
      for (const conformsToUrl of conformsToIds) {
        const matchingSchema = allSchemas.find(
          (schema) => schema.conformsTo === conformsToUrl
        )
        if (matchingSchema) {
          const convertedContent =
            await schemaManagerService.getConvertedProfileContent(
              matchingSchema.path,
            )
          if (convertedContent) {
            const mergedProfile = await schemaManagerService.getMergedProfile(
              crate,
              convertedContent,
              updatedProfile,
              conformsToUrl,
            )
            updatedProfile = JSON.parse(JSON.stringify(mergedProfile))
          }
        }
      }
    } else {
      updatedProfile = JSON.parse(JSON.stringify(completeProfile))
    }

    const errors = validate(entity, updatedProfile)
    validationErrors = validationErrors.concat(errors)
  }

  if (validationErrors.length !== 0) {
    return validationErrors
  } else {
    return undefined
  }
}

export function validate(entity: Record<string, any>, profile: Record<string, any>) {

  let errors: ValidationError[] = []

  const profileClass = profile!.classes[entity["@type"]]

  if (profileClass && profileClass.inputs) {
    for (const input of profileClass.inputs) {
      const { name, required, multiple, type, values } = input
      const localizedName = input.label ? input.label : name

      if (required) {
        const fieldValue = entity[name]

        if (fieldValue === undefined || fieldValue.length === 0) {
          errors.push({
            path: `$.@graph[${entity["@id"]}].${name}`,
            entityId: `${entity["@id"]}`,
            entityType: `${entity["@type"]}`,
            fieldName: `${name}`,
            fieldLabel: `${localizedName}`,
            error: "Required value not set",
            error_hu: "Kötelező érték nincs beállítva",
            errorCode: "REQUIRED_NOT_SET"
          })
        }
      }

      if (!multiple) {
        const fieldValue = entity[name]

        if (Array.isArray(fieldValue)) {
          // TODO: HUUUUGE TODO AS IT WAS REQUESTED, remove this if branch after the bug with duplicated values is solved
          // this error occurs for other URLs too if they aren't multiple
          if (type[0] === "URL") {
            entity[name] = fieldValue[0]
          } else {
            errors.push({
              path: `$.@graph[${entity["@id"]}].${name}`,
              entityId: `${entity["@id"]}`,
              entityType: `${entity["@type"]}`,
              fieldName: `${name}`,
              fieldLabel: `${localizedName}`,
              error: "Multiple value set",
              error_hu: "Többszörös érték van beállítva",
              errorCode: "SINGLE_VALUE_REQUIRED"
            }) 
          }
        }
      }

      if (["Select", "SelectURL", "SelectObject"].includes(input.type[0]) && required) {
        const fieldValues =  Array.isArray(entity[name]) ? entity[name] : [entity[name]]

        for (const fieldValue of fieldValues) {
          if (fieldValue && !values.includes(fieldValue)) {
            errors.push({
              path: `$.@graph[${entity["@id"]}].${name}`,
              entityId: `${entity["@id"]}`,
              entityType: `${entity["@type"]}`,
              fieldName: `${name}`,
              fieldLabel: `${localizedName}`,
              error: "Wrong value set",
              error_hu: "Hibás érték van beállítva",
              errorCode: "WRONG_VALUE_SET"
            })
          }
        }
      }

      if (input.type[0] === 'Number') {
        const fieldValues = Array.isArray(entity[name]) ? entity[name].map(Number) : [Number(entity[name])];

        for (const fieldValue of fieldValues) {
          if (fieldValue && input.minValue > fieldValue) {
            errors.push({
              path: `$.@graph[${entity["@id"]}].${name}`,
              entityId: `${entity["@id"]}`,
              entityType: `${entity["@type"]}`,
              fieldName: `${name}`,
              fieldLabel: `${localizedName}`,
              error: `Wrong value set, the minimum value is ${input.minValue}`,
              error_hu: `Hibás érték van beállítva, a minimum érték ${input.minValue}`,
              errorCode: "WRONG_VALUE_SET"
            });
          }

          if (fieldValue && input.maxValue < fieldValue) {
            errors.push({
              path: `$.@graph[${entity["@id"]}].${name}`,
              entityId: `${entity["@id"]}`,
              entityType: `${entity["@type"]}`,
              fieldName: `${name}`,
              fieldLabel: `${localizedName}`,
              error: `Wrong value set, the maximum value is ${input.maxValue}`,
              error_hu: `Hibás érték van beállítva, a maximum érték ${input.maxValue}`,
              errorCode: "WRONG_VALUE_SET"
            });
          }
        }
      }

      if (input.type[0] === 'Text') {
        const fieldValue = entity[name];

        const fieldValues = Array.isArray(fieldValue) ? fieldValue : [fieldValue];

        for (const value of fieldValues) {
          if (input.minLength !== undefined && value && input.minLength > value.length) {
            errors.push({
              path: `$.@graph[${entity["@id"]}].${name}`,
              entityId: `${entity["@id"]}`,
              entityType: `${entity["@type"]}`,
              fieldName: `${name}`,
              fieldLabel: `${localizedName}`,
              error: `Wrong value set, the minimum length is ${input.minLength} character`,
              error_hu: `Hibás érték van beállítva, a minimum hossz ${input.minLength} karakter`,
              errorCode: "WRONG_VALUE_SET"
            });
          }

          if (input.maxLength !== undefined && value && input.maxLength < value.length) {
            errors.push({
              path: `$.@graph[${entity["@id"]}].${name}`,
              entityId: `${entity["@id"]}`,
              entityType: `${entity["@type"]}`,
              fieldName: `${name}`,
              fieldLabel: `${localizedName}`,
              error: `Wrong value set, the maximum length is ${input.maxLength} character`,
              error_hu: `Hibás érték van beállítva, a maximum hossz ${input.maxLength} karakter`,
              errorCode: "WRONG_VALUE_SET"
            });
          }

          if (input.regex !== undefined && value && !new RegExp(input.regex).test(value)) {
            errors.push({
              path: `$.@graph[${entity["@id"]}].${name}`,
              entityId: `${entity["@id"]}`,
              entityType: `${entity["@type"]}`,
              fieldName: `${name}`,
              fieldLabel: `${localizedName}`,
              error: `Wrong value set, the text does not match the given regexp ${input.regex}`,
              error_hu: `Hibás érték van beállítva, a szöveg nem felel meg a megadott reguláris kifejezésnek ${input.regex}`,
              errorCode: "WRONG_VALUE_SET"
            });
          }
        }
      }
    }
  }

  return errors
}
