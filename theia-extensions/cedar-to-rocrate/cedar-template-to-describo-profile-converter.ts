/**
 * TypeScript conversion of CedarTemplateToDescriboProfileConverter.java
 * Converts CEDAR templates to Describo profile format
 */

// ============================================================================
// JsonHelper Utilities
// ============================================================================

/**
 * Returns a JSON sub-element from the given JSON object and path
 * @param json - a JSON object
 * @param path - a JSON path, e.g. "a.b.c[2].d"
 * @returns - a sub-element of json according to the given path, or null/undefined
 */
function getJsonElement(json: any, path: string): any {
    const parts = path.split(/\.|\[|\]/);
    let result: any = json;

    for (const key of parts) {
        const trimmedKey = key.trim();
        if (trimmedKey === '') {
            continue;
        }

        if (result == null) {
            break;
        }

        if (Array.isArray(result)) {
            const ix = parseInt(trimmedKey, 10);
            result = result[ix];
        } else if (typeof result === 'object' && result !== null) {
            result = result[trimmedKey];
        } else {
            break;
        }
    }

    return result;
}

/**
 * Extract a string array from a JSON path
 * @param json - a JSON object
 * @param path - a JSON path
 * @returns - array of strings, or empty array if not found
 */
function getStringList(json: any, path: string): string[] {
    const jsonElement = getJsonElement(json, path);
    if (jsonElement == null) {
        return [];
    }
    if (Array.isArray(jsonElement)) {
        return jsonElement;
    }
    return [];
}

/**
 * Get a JSON object from a path
 * @param json - a JSON object
 * @param path - a JSON path
 * @returns - JSON object or null
 */
function getJsonObject(json: any, path: string): any | null {
    const jsonElement = getJsonElement(json, path);
    if (jsonElement == null || typeof jsonElement !== 'object' || Array.isArray(jsonElement)) {
        return null;
    }
    return jsonElement;
}

/**
 * Get a JSON array from a path
 * @param json - a JSON object
 * @param path - a JSON path
 * @returns - JSON array or null
 */
function getJsonArray(json: any, path: string): any[] | null {
    const jsonElement = getJsonElement(json, path);
    if (jsonElement == null || !Array.isArray(jsonElement)) {
        return null;
    }
    return jsonElement;
}

/**
 * Check if a JSON element exists at the given path
 * @param json - a JSON object
 * @param path - a JSON path
 * @returns - true if element exists, false otherwise
 */
function hasJsonElement(json: any, path: string): boolean {
    try {
        return getJsonElement(json, path) != null;
    } catch (ex) {
        return false;
    }
}

// ============================================================================
// ArpService Methods (stubbed for external vocabulary)
// ============================================================================

/**
 * Check if field has external vocabulary values
 * @param cedarFieldTemplate - CEDAR field template
 * @returns - always false (external vocab processing skipped)
 */
function hasExternalValues(cedarFieldTemplate: any): boolean {
    return false;
}

/**
 * Check if field is deprecated
 * @param cedarFieldTemplate - CEDAR field template
 * @returns - true if field is deprecated, false otherwise
 */
function isDeprecatedField(cedarFieldTemplate: any): boolean {
    const deprecatedField = getJsonElement(cedarFieldTemplate, '_arp.dataverse.deprecated');
    return deprecatedField != null && deprecatedField !== false && deprecatedField === true;
}

/**
 * Get external vocabulary values
 * @param cedarFieldTemplate - CEDAR field template
 * @returns - always empty array (external vocab processing skipped)
 */
function getExternalVocabValues(cedarFieldTemplate: any): string[] {
    return [];
}

// ============================================================================
// Type Definitions
// ============================================================================

type JsonObject = Record<string, any>;
type JsonArray = any[];

/**
 * Tuple type for pairing class name with DescriboInput
 */
type InputPair = [string, DescriboInput];

// ============================================================================
// Inner Classes
// ============================================================================

/**
 * DescriboInput class representing a single input field
 */
class DescriboInput {
    private _id?: string;
    private _name?: string;
    private _label?: string;
    private _help?: string;
    private _type?: string[];
    private _values?: string[];
    private _required: boolean = false;
    private _multiple: boolean = false;
    private _minValue?: number;
    private _maxValue?: number;
    private _minLength?: number;
    private _maxLength?: number;
    private _regex?: string;
    private _placeholder?: string;
    private _numberType?: string[];
    private _dateFormat?: string[];
    private _style?: string;
    private _deprecated: boolean = false;

    constructor() {}

    isDeprecated(): boolean {
        return this._deprecated;
    }

    setDeprecated(deprecated: boolean): void {
        this._deprecated = deprecated;
    }

    getId(): string | undefined {
        return this._id;
    }

    setId(id: string): void {
        this._id = id;
    }

    getName(): string | undefined {
        return this._name;
    }

    setName(name: string): void {
        this._name = name;
    }

    getLabel(): string | undefined {
        return this._label;
    }

    setLabel(label: string): void {
        this._label = label;
    }

    getHelp(): string | undefined {
        return this._help;
    }

    setHelp(help: string | undefined): void {
        this._help = help;
    }

    getType(): string[] | undefined {
        return this._type;
    }

    setType(type: string[] | undefined): void {
        this._type = type;
    }

    isRequired(): boolean {
        return this._required;
    }

    setRequired(required: boolean): void {
        this._required = required;
    }

    isMultiple(): boolean {
        return this._multiple;
    }

    setMultiple(multiple: boolean): void {
        this._multiple = multiple;
    }

    getValues(): string[] | undefined {
        return this._values;
    }

    setValues(values: string[]): void {
        this._values = values;
    }

    getMinValue(): number | undefined {
        return this._minValue;
    }

    setMinValue(minValue: number | undefined): void {
        this._minValue = minValue;
    }

    getMaxValue(): number | undefined {
        return this._maxValue;
    }

    setMaxValue(maxValue: number | undefined): void {
        this._maxValue = maxValue;
    }

    getMinLength(): number | undefined {
        return this._minLength;
    }

    setMinLength(minLength: number | undefined): void {
        this._minLength = minLength;
    }

    getMaxLength(): number | undefined {
        return this._maxLength;
    }

    setMaxLength(maxLength: number | undefined): void {
        this._maxLength = maxLength;
    }

    getRegex(): string | undefined {
        return this._regex;
    }

    setRegex(regex: string | undefined): void {
        this._regex = regex;
    }

    getPlaceholder(): string | undefined {
        return this._placeholder;
    }

    setPlaceholder(placeholder: string | undefined): void {
        this._placeholder = placeholder;
    }

    getNumberType(): string[] | undefined {
        return this._numberType;
    }

    setNumberType(numberType: string[] | undefined): void {
        this._numberType = numberType;
    }

    getDateFormat(): string[] | undefined {
        return this._dateFormat;
    }

    setDateFormat(dateFormat: string[] | undefined): void {
        this._dateFormat = dateFormat;
    }

    getStyle(): string | undefined {
        return this._style;
    }

    setStyle(style: string | undefined): void {
        this._style = style;
    }

    /**
     * Convert DescriboInput to plain object for JSON serialization
     */
    toJSON(): any {
        const obj: any = {};
        if (this._id !== undefined) obj.id = this._id;
        if (this._name !== undefined) obj.name = this._name;
        if (this._label !== undefined) obj.label = this._label;
        if (this._help !== undefined) obj.help = this._help;
        if (this._type !== undefined) obj.type = this._type;
        if (this._values !== undefined) obj.values = this._values;
        // Always include boolean properties (even when false)
        obj.required = this._required;
        obj.multiple = this._multiple;
        obj.deprecated = this._deprecated;
        if (this._minValue !== undefined) obj.minValue = this._minValue;
        if (this._maxValue !== undefined) obj.maxValue = this._maxValue;
        if (this._minLength !== undefined) obj.minLength = this._minLength;
        if (this._maxLength !== undefined) obj.maxLength = this._maxLength;
        if (this._regex !== undefined) obj.regex = this._regex;
        if (this._placeholder !== undefined) obj.placeholder = this._placeholder;
        if (this._numberType !== undefined) obj.numberType = this._numberType;
        if (this._dateFormat !== undefined) obj.dateFormat = this._dateFormat;
        if (this._style !== undefined) obj.style = this._style;
        return obj;
    }
}

/**
 * ClassLocalization for storing label and help text
 */
class ClassLocalization {
    label: string;
    help: string;

    constructor(label: string, help: string) {
        this.label = label;
        this.help = help;
    }
}

/**
 * ProcessedDescriboProfileValues for storing intermediate processing results
 */
class ProcessedDescriboProfileValues {
    inputs: InputPair[] = [];
    classLocalizations: Map<string, ClassLocalization> = new Map();

    constructor(inputs: InputPair[]) {
        this.inputs = inputs;
    }

    getInputs(): InputPair[] {
        return this.inputs;
    }

    setInputs(inputs: InputPair[]): void {
        this.inputs = inputs;
    }
}

// ============================================================================
// Main Converter Class
// ============================================================================

export class CedarTemplateToDescriboProfileConverter {
    private language: string;
    private cedarDescriboFieldTypes: Map<string, string[]>;
    private cedarDescriboNumberTypes: Map<string, string[]>;
    private cedarDescriboDateTypes: Map<string, string[]>;

    constructor(language?: string) {
        this.language = language ?? 'en';

        // Initialize field type mappings
        this.cedarDescriboFieldTypes = new Map([
            ['textfield', ['Text']],
            ['temporal', ['Date']],
            ['numeric', ['Number']],
            ['richtext', ['TextArea']],
            ['textarea', ['TextArea']],
            ['link', ['URL']],
            ['list', ['Select']],
            ['radio', ['Select']],
            ['phone-number', ['Text']],
            ['email', ['Text']],
            ['checkbox', ['Select']] // Checkbox is mapped to Select
        ]);

        this.cedarDescriboNumberTypes = new Map([
            ['xsd:decimal', ['Any']],
            ['xsd:long', ['Long']],
            ['xsd:int', ['Int']],
            ['xsd:double', ['Double']],
            ['xsd:float', ['Float']]
        ]);

        this.cedarDescriboDateTypes = new Map([
            ['xsd:dateTime', ['DateTime']],
            ['xsd:date', ['Date']],
            ['xsd:time', ['Time']]
        ]);
    }

    /**
     * Main conversion method - converts CEDAR template to Describo profile
     * @param cedarTemplate - CEDAR template as JSON string
     * @returns - Describo profile as JSON string
     */
    processCedarTemplate(cedarTemplate: string): string {
        const describoProfileTemplate = {
            metadata: {
                name: 'Cedar to Describo generated profile',
                version: 1.0,
                description: 'Generated Describo schema from a Cedar template',
                warnMissingProperty: true
            },
            classes: {
                Dataset: {
                    definition: 'override',
                    subClassOf: [],
                    inputs: []
                }
            },
            enabledClasses: ['Dataset']
        };

        const classTemplate = {
            definition: 'override',
            subClassOf: [],
            inputs: []
        };

        const describoProfile: any = JSON.parse(JSON.stringify(describoProfileTemplate));
        const cedarTemplateJson: any = JSON.parse(cedarTemplate);

        this.processProfileMetadata(cedarTemplateJson, describoProfile);
        const profValues = this.processTemplate(cedarTemplateJson, new ProcessedDescriboProfileValues([]), 'Dataset');

        // Add default values for builtin types
        if (this.language === 'hu') {
            profValues.classLocalizations.set('Dataset', new ClassLocalization('Adatcsomag', 'Fájlok és metaadataik adatcsomagja'));
            profValues.classLocalizations.set('File', new ClassLocalization('Fájl', 'Adatfájl'));
            profValues.classLocalizations.set('Text', new ClassLocalization('Szöveg', 'Szöveg'));
            profValues.classLocalizations.set('Number', new ClassLocalization('Szám', 'Szám'));
            profValues.classLocalizations.set('Select', new ClassLocalization('Kiválasztás', 'Kiválasztás'));
            profValues.classLocalizations.set('TextArea', new ClassLocalization('Hosszú szöveg', 'Hosszú szöveg'));
            profValues.classLocalizations.set('Date', new ClassLocalization('Dátum', 'Dátum'));
        } else {
            profValues.classLocalizations.set('Dataset', new ClassLocalization('Dataset', 'A collection of files with metadata'));
            profValues.classLocalizations.set('File', new ClassLocalization('File', 'Data file'));
        }

        const classes = describoProfile.classes;

        for (const input of profValues.inputs) {
            const isDeprecated = input[1].isDeprecated();
            if (!isDeprecated) {
                const allChildrenAreDeprecated = this.areAllChildrenDeprecated(input, profValues.inputs);
                if (!allChildrenAreDeprecated) {
                    const className = input[0];
                    if (!classes[className]) {
                        classes[className] = JSON.parse(JSON.stringify(classTemplate));
                    }
                    const classJson = classes[className];
                    classJson.inputs.push(input[1].toJSON());

                    const classLoc = profValues.classLocalizations.get(className);
                    if (classLoc != null) {
                        // This is our custom localisation at class level
                        classJson.label = classLoc.label;
                        classJson.help = classLoc.help;
                    }
                }
            }
        }

        // This is the Describo supported way of localisation
        const localisation: Record<string, string> = {};
        profValues.classLocalizations.forEach((value, key) => {
            localisation[key] = value.label;
        });
        describoProfile.localisation = localisation;

        const enabledClassesSet = new Set<string>();
        profValues.inputs
            .filter(pair => !pair[1].isDeprecated())
            .forEach(pair => enabledClassesSet.add(pair[0]));

        describoProfile.enabledClasses = Array.from(enabledClassesSet);

        return JSON.stringify(describoProfile, null, 2);
    }

    /**
     * Check if all children of an input are deprecated
     */
    areAllChildrenDeprecated(input: InputPair, inputs: InputPair[]): boolean {
        if (input[0] === 'Dataset') {
            const typeName = input[1].getName();
            if (!typeName) {
                return false;
            }
            const filtered = inputs.filter(pair => pair[0] === typeName);

            return filtered.length > 0 && filtered.every(pair => pair[1].isDeprecated());
        } else {
            return false;
        }
    }

    /**
     * Process template properties recursively
     */
    processTemplate(
        cedarTemplate: any,
        processedDescriboProfileValues: ProcessedDescriboProfileValues,
        parentName: string
    ): ProcessedDescriboProfileValues {
        const propertyNames = getStringList(cedarTemplate, '_ui.order');

        for (const propertyName of propertyNames) {
            // Note: cannot use getJsonObject here because the propertyName may contain ".", eg:
            // coverage.Spectral.CentralWavelength, which would result in properties.coverage.Spectral.CentralWavelength
            const properties = cedarTemplate.properties;
            if (!properties || !properties[propertyName]) {
                continue;
            }
            const property = properties[propertyName];
            const propertyType = property['@type'] ?? null;

            // richtext type can not be used in Describo, leave it out from the profile
            const inputType = getJsonElement(property, '_ui.inputType');
            if (inputType && typeof inputType === 'string' && inputType === 'richtext') {
                continue;
            }

            const contextProps = getJsonElement(cedarTemplate, 'properties.@context.properties');
            if (!contextProps || !contextProps[propertyName] || !contextProps[propertyName].enum || !Array.isArray(contextProps[propertyName].enum) || contextProps[propertyName].enum.length === 0) {
                continue;
            }
            const inputId = contextProps[propertyName].enum[0];

            if (propertyType != null) {
                const actPropertyType = typeof propertyType === 'string' ? propertyType.substring(propertyType.lastIndexOf('/') + 1) : null;
                if (!actPropertyType) {
                    continue;
                }

                const ui = property._ui;
                const isHidden = ui && ui.hidden === true;

                if (!isHidden && (actPropertyType === 'TemplateField' || actPropertyType === 'StaticTemplateField')) {
                    const valueConstraints = property._valueConstraints;
                    const allowMultiple =
                        (valueConstraints && valueConstraints.multipleChoice === true) ||
                        (property.minItems !== undefined || property.maxItems !== undefined);
                    this.processTemplateField(property, allowMultiple, inputId, processedDescriboProfileValues, parentName);
                } else if (actPropertyType === 'TemplateElement') {
                    const propertyLabels = getJsonObject(cedarTemplate, '_ui.propertyLabels');
                    this.processTemplateElement(property, processedDescriboProfileValues, false, inputId, parentName, propertyLabels);
                }
            } else {
                const actPropertyType = property.type;
                if (actPropertyType === 'array') {
                    const propertyLabels = getJsonObject(cedarTemplate, '_ui.propertyLabels');
                    this.processArray(property, processedDescriboProfileValues, inputId, parentName, propertyLabels);
                }
            }
        }

        return processedDescriboProfileValues;
    }

    /**
     * Process a template field
     */
    processTemplateField(
        templateField: any,
        allowMultiple: boolean,
        inputId: string,
        processedDescriboProfileValues: ProcessedDescriboProfileValues,
        parentName: string
    ): void {
        const describoInput = new DescriboInput();
        let fieldType: string | null = null;
        const inputTypeElement = getJsonElement(templateField, '_ui.inputType');
        if (inputTypeElement && typeof inputTypeElement === 'string') {
            fieldType = inputTypeElement;
        }

        const externalVocab = hasExternalValues(templateField);
        if (externalVocab) {
            fieldType = 'list';
        }

        describoInput.setId(inputId);
        // Replace the ":" with "." upon generating the Describo Profile from the CEDAR Template
        const schemaName = templateField['schema:name'];
        if (!schemaName || typeof schemaName !== 'string') {
            return; // Skip if no schema name
        }
        describoInput.setName(schemaName.replace(':', '.'));
        const label = this.getLocalizedLabel(templateField);
        describoInput.setLabel(label);
        const help = this.getLocalizedHelp(templateField);
        describoInput.setHelp(help);
        describoInput.setType(this.getDescriboType(fieldType));
        // Special Select styles for checkbox and radio CEDAR types
        if (fieldType === 'checkbox') {
            describoInput.setStyle('checkbox');
        } else if (fieldType === 'radio') {
            describoInput.setStyle('radio');
        }

        const requiredValue = getJsonElement(templateField, '_valueConstraints.requiredValue');
        describoInput.setRequired(requiredValue === true);

        const minValue = getJsonElement(templateField, '_valueConstraints.minValue');
        describoInput.setMinValue(minValue != null && typeof minValue === 'number' ? Math.floor(minValue) : undefined);

        const maxValue = getJsonElement(templateField, '_valueConstraints.maxValue');
        describoInput.setMaxValue(maxValue != null && typeof maxValue === 'number' ? Math.floor(maxValue) : undefined);

        const minLength = getJsonElement(templateField, '_valueConstraints.minLength');
        describoInput.setMinLength(minLength != null && typeof minLength === 'number' ? Math.floor(minLength) : undefined);

        const maxLength = getJsonElement(templateField, '_valueConstraints.maxLength');
        describoInput.setMaxLength(maxLength != null && typeof maxLength === 'number' ? Math.floor(maxLength) : undefined);

        const regex = getJsonElement(templateField, '_valueConstraints.regex');
        describoInput.setRegex(regex != null && typeof regex === 'string' ? regex : undefined);

        const placeholder = getJsonElement(templateField, '_arp.dataverse.watermark');
        describoInput.setPlaceholder(placeholder != null && typeof placeholder === 'string' ? placeholder : undefined);

        describoInput.setMultiple(allowMultiple);
        describoInput.setDeprecated(isDeprecatedField(templateField));

        let literalValues: string[] = [];
        if (fieldType != null && (fieldType === 'list' || fieldType === 'radio' || fieldType === 'checkbox')) {
            if (externalVocab) {
                literalValues = getExternalVocabValues(templateField);
                if (literalValues.length > 0) {
                    describoInput.setValues(literalValues);
                }
            } else {
                const jsonElement = getJsonElement(templateField, '_valueConstraints.literals');
                const literals = jsonElement != null && Array.isArray(jsonElement) ? jsonElement : [];
                literalValues = [];
                literals.forEach((literal: any) => {
                    if (literal && typeof literal === 'object' && literal.label && typeof literal.label === 'string') {
                        literalValues.push(literal.label);
                    }
                });
            }
            if (literalValues.length > 0) {
                describoInput.setValues(literalValues);
            }
        }

        if (fieldType === 'numeric') {
            // minValue and maxValue always handled as an int, even for long, double and float numbers
            const numMinValue = getJsonElement(templateField, '_valueConstraints.minValue');
            describoInput.setMinValue(numMinValue != null && typeof numMinValue === 'number' ? Math.floor(numMinValue) : undefined);

            const numMaxValue = getJsonElement(templateField, '_valueConstraints.maxValue');
            describoInput.setMaxValue(numMaxValue != null && typeof numMaxValue === 'number' ? Math.floor(numMaxValue) : undefined);

            const numberType = getJsonElement(templateField, '_valueConstraints.numberType');
            if (numberType != null && typeof numberType === 'string') {
                const cedarNumberType = this.cedarDescriboNumberTypes.get(numberType);
                if (cedarNumberType) {
                    describoInput.setNumberType(cedarNumberType);
                }
            }
        }

        if (fieldType === 'temporal') {
            const temporalType = getJsonElement(templateField, '_valueConstraints.temporalType');
            if (temporalType != null && typeof temporalType === 'string') {
                const cedarDateType = this.cedarDescriboDateTypes.get(temporalType);
                if (cedarDateType) {
                    describoInput.setType(cedarDateType);
                }
            }
        }

        // hard-coded regexes
        if (fieldType === 'email' && describoInput.getRegex() == null) {
            describoInput.setRegex('^((?!\\.)[\\w\\-_.]*[^.])(@\\w+(\\-?\\w+)*)(\\.\\w+(\\-?\\w+)*)*\\.[a-zA-Z]{2,}$');
        }

        if (fieldType === 'phone-number' && describoInput.getRegex() == null) {
            describoInput.setRegex('(?:([+]\\d{1,4})[-.\\s]?)?(?:[(](\\d{1,3})[)][-.\\s]?)?(\\d{1,4})[-.\\s]?(\\d{1,4})[-.\\s]?(\\d{1,9})');
        }

        if (fieldType === 'textfield') {
            const dateFormat = getJsonElement(templateField, '_arp.aroma.dateFormat');
            if (dateFormat != null && typeof dateFormat === 'string') {
                describoInput.setDateFormat([dateFormat]);
            }
        }

        processedDescriboProfileValues.inputs.push([parentName, describoInput]);
    }

    /**
     * "dataverseFile" is a special Template Element in CEDAR that is used to represent file relations
     * this property needs to be handled differently
     */
    private processTemplateElement(
        templateElement: any,
        processedDescriboProfileValues: ProcessedDescriboProfileValues,
        allowMultiple: boolean,
        inputId: string,
        parentName: string,
        propertyLabels: any
    ): void {
        const describoInput = new DescriboInput();

        const schemaName = templateElement['schema:name'];
        if (!schemaName || typeof schemaName !== 'string') {
            return; // Skip if no schema name
        }
        const elementNameReplaced = schemaName.replace(':', '.');

        // Replace the ":" with "." upon generating the Describo Profile from the CEDAR Template
        const schemaIdentifier = templateElement['schema:identifier'];
        const type = schemaIdentifier && typeof schemaIdentifier === 'string' ? schemaIdentifier.replace(':', '.') : elementNameReplaced;
        const actualType = type === 'dataverseFile' ? 'File' : type === 'dataverseDataset' ? 'Dataset' : elementNameReplaced;

        describoInput.setId(inputId);
        describoInput.setName(elementNameReplaced);
        const label = this.getLocalizedLabel(templateElement);
        describoInput.setLabel(label);
        const help = this.getLocalizedHelp(templateElement);
        describoInput.setHelp(help);
        describoInput.setType([actualType]);

        const requiredValue = getJsonElement(templateElement, '_valueConstraints.requiredValue');
        describoInput.setRequired(requiredValue === true);

        const allowsMultiple = allowMultiple || templateElement.minItems !== undefined || templateElement.maxItems !== undefined;
        describoInput.setMultiple(allowsMultiple);
        describoInput.setDeprecated(isDeprecatedField(templateElement));

        processedDescriboProfileValues.classLocalizations.set(elementNameReplaced, new ClassLocalization(label, help ?? ''));
        processedDescriboProfileValues.inputs.push([parentName, describoInput]);

        this.processTemplate(templateElement, processedDescriboProfileValues, elementNameReplaced);
    }

    /**
     * Process array type
     */
    processArray(
        array: any,
        processedDescriboProfileValues: ProcessedDescriboProfileValues,
        inputId: string,
        parentName: string,
        propertyLabels: any
    ): void {
        const items = array.items;
        if (!items) {
            return;
        }
        const inputType = getJsonElement(items, '_ui.inputType');
        if (inputType != null && typeof inputType === 'string') {
            this.processTemplateField(items, true, inputId, processedDescriboProfileValues, parentName);
        } else {
            this.processTemplateElement(items, processedDescriboProfileValues, true, inputId, parentName, propertyLabels);
        }
    }

    /**
     * Process profile metadata
     */
    private processProfileMetadata(cedarTemplate: any, describoProfile: any): void {
        let name = cedarTemplate['schema:name'];
        if (!name || typeof name !== 'string') {
            name = 'Untitled';
        }

        if (this.language === 'hu') {
            const hunName = cedarTemplate.hunName;
            if (hunName && typeof hunName === 'string') {
                name = hunName;
            }
        }
        describoProfile.metadata.name = name;

        let desc = cedarTemplate['schema:description'];
        if (!desc || typeof desc !== 'string') {
            desc = '';
        }

        if (this.language === 'hu') {
            const hunDescription = cedarTemplate.hunDescription;
            if (hunDescription && typeof hunDescription === 'string') {
                desc = hunDescription;
            }
        }
        describoProfile.metadata.description = desc;
    }

    /**
     * Get Describo type from template field (overloaded method)
     */
    getDescriboType(templateField: any): string[] | undefined;
    getDescriboType(cedarFieldType: string | null): string[] | undefined;
    getDescriboType(arg: any): string[] | undefined {
        if (arg == null) {
            return undefined;
        }

        // If it's an object, treat it as templateField
        if (typeof arg === 'object') {
            const fieldType = getJsonElement(arg, '_ui.inputType');
            if (fieldType != null && typeof fieldType === 'string' && this.cedarDescriboFieldTypes.has(fieldType)) {
                return this.cedarDescriboFieldTypes.get(fieldType);
            }
            return undefined;
        }

        // If it's a string, treat it as cedarFieldType
        if (typeof arg === 'string') {
            return this.cedarDescriboFieldTypes.get(arg);
        }

        return undefined;
    }

    /**
     * Get localized label
     */
    getLocalizedLabel(obj: any): string {
        let label = '';
        let engLabel = obj['schema:name'];
        if (!engLabel || typeof engLabel !== 'string') {
            engLabel = '';
        }

        // Absolute fallback: the field name
        const prefLabel = obj['skos:prefLabel'];
        // If we have an english name in skos:prefLabel, use that
        if (prefLabel != null && typeof prefLabel === 'string' && prefLabel.length > 0) {
            engLabel = prefLabel;
        }

        // If we have an hunLabel, use that for hunLabel, otherwise fall back to engLabel
        if (this.language === 'hu') {
            const hunLabel = obj.hunLabel;
            if (hunLabel == null || typeof hunLabel !== 'string' || hunLabel.length === 0) {
                label = engLabel + ' (magyarul)';
            } else {
                label = hunLabel;
            }
        } else {
            label = engLabel;
        }
        return label;
    }

    /**
     * Get localized help text
     */
    getLocalizedHelp(obj: any): string | undefined {
        let help: string | undefined = undefined;
        if (this.language === 'hu') {
            const hunDescription = obj.hunDescription;
            if (hunDescription != null && typeof hunDescription === 'string') {
                help = hunDescription;
            }
        } else {
            const schemaDescription = obj['schema:description'];
            if (schemaDescription != null && typeof schemaDescription === 'string') {
                help = schemaDescription;
            }
        }
        return help;
    }
}

