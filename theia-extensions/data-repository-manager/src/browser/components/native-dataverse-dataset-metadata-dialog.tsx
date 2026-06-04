import { AbstractDialog, Message } from '@theia/core/lib/browser';
import { Input, Select } from 'antd';
import * as React from 'react';
import { createRoot, Root } from 'react-dom/client';

import { NativeDataverseDatasetMetadata } from '../services/native-dataverse-export-service';
import '../styles/native-dataverse-dataset-metadata-dialog.css';

const DATAVERSE_SUBJECTS = [
    'Other',
    'Social Sciences',
    'Physics',
    'Medicine, Health and Life Sciences',
    'Mathematical Sciences',
    'Law',
    'Engineering',
    'Earth and Environmental Sciences',
    'Computer and Information Science',
    'Chemistry',
    'Business and Management',
    'Astronomy and Astrophysics',
    'Arts and Humanities',
    'Agricultural Sciences'
];

export class NativeDataverseDatasetMetadataDialog extends AbstractDialog<NativeDataverseDatasetMetadata | undefined> {

    private reactRoot: Root | undefined;
    private metadataLanguageValue: '' | NativeDataverseDatasetMetadata['metadataLanguage'];
    private titleValue: string;
    private authorNamesValue: string;
    private contactEmailsValue: string;
    private descriptionsValue: string;
    private subjectValue: string;

    constructor(defaults: NativeDataverseDatasetMetadata) {
        super({ title: 'Required Dataverse Dataset Metadata' });

        this.metadataLanguageValue = defaults.metadataLanguage;
        this.titleValue = defaults.title;
        this.authorNamesValue = defaults.authorNames.join('\n');
        this.contactEmailsValue = defaults.contactEmails.join('\n');
        this.descriptionsValue = defaults.descriptions.join('\n');
        this.subjectValue = defaults.subjects.find(subject => DATAVERSE_SUBJECTS.includes(subject)) ?? '';

        this.contentNode.style.width = '620px';
        this.contentNode.style.maxWidth = '90vw';
        this.contentNode.style.maxHeight = '75vh';
        this.contentNode.style.padding = '0';

        this.appendCloseButton();
        this.appendAcceptButton('Export');
    }

    get value(): NativeDataverseDatasetMetadata | undefined {
        return this.isValid(undefined) ? {
            metadataLanguage: this.metadataLanguageValue as NativeDataverseDatasetMetadata['metadataLanguage'],
            title: this.titleValue.trim(),
            authorNames: this.lines(this.authorNamesValue),
            contactEmails: this.lines(this.contactEmailsValue),
            descriptions: this.lines(this.descriptionsValue),
            subjects: [this.subjectValue]
        } : undefined;
    }

    protected isValid(_value: NativeDataverseDatasetMetadata | undefined): boolean {
        return !!this.metadataLanguageValue
            && !!this.titleValue.trim()
            && this.lines(this.authorNamesValue).length > 0
            && this.lines(this.contactEmailsValue).length > 0
            && this.lines(this.descriptionsValue).length > 0
            && !!this.subjectValue;
    }

    protected render(): void {
        if (!this.reactRoot) {
            this.reactRoot = createRoot(this.contentNode);
        }

        this.reactRoot.render(
            <div className="native-dv-metadata">
                <p className="native-dv-metadata__description">
                    Dataverse requires these citation metadata fields when creating a new dataset.
                    Values found in the RO-Crate root entity are used as defaults.
                </p>
                <div className="native-dv-metadata__form">
                    <label className="native-dv-metadata__field">
                        <span className="native-dv-metadata__label">Dataset Language <span className="native-dv-metadata__required">*</span></span>
                        <Select
                            className="native-dv-metadata__select"
                            value={this.metadataLanguageValue}
                            options={[
                                { value: '', label: 'None' },
                                { value: 'hu', label: 'Hungarian' },
                                { value: 'en', label: 'English' }
                            ]}
                            popupClassName="native-dv-metadata__select-dropdown"
                            onChange={value => {
                                this.metadataLanguageValue = value as NativeDataverseDatasetMetadata['metadataLanguage'];
                                this.refresh();
                            }}
                        />
                    </label>
                    {this.renderInput('Title', this.titleValue, value => { this.titleValue = value; }, true)}
                    {this.renderTextarea('Author Name', this.authorNamesValue, value => { this.authorNamesValue = value; })}
                    {this.renderTextarea('Point of Contact Email', this.contactEmailsValue, value => { this.contactEmailsValue = value; })}
                    {this.renderTextarea('Description Text', this.descriptionsValue, value => { this.descriptionsValue = value; })}
                    <label className="native-dv-metadata__field">
                        <span className="native-dv-metadata__label">Subject <span className="native-dv-metadata__required">*</span></span>
                        <Select
                            className="native-dv-metadata__select"
                            value={this.subjectValue || undefined}
                            placeholder="Select a subject"
                            options={DATAVERSE_SUBJECTS.map(subject => ({ value: subject, label: subject }))}
                            popupClassName="native-dv-metadata__select-dropdown"
                            onChange={value => {
                                this.subjectValue = value;
                                this.refresh();
                            }}
                        />
                    </label>
                </div>
            </div>
        );
    }

    protected renderInput(label: string, value: string, setValue: (value: string) => void, autoFocus = false): React.ReactNode {
        return (
            <label className="native-dv-metadata__field">
                <span className="native-dv-metadata__label">{label} <span className="native-dv-metadata__required">*</span></span>
                <Input
                    className="native-dv-metadata__input"
                    value={value}
                    autoFocus={autoFocus}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                        setValue(event.target.value);
                        this.refresh();
                    }}
                />
            </label>
        );
    }

    protected renderTextarea(label: string, value: string, setValue: (value: string) => void): React.ReactNode {
        return (
            <label className="native-dv-metadata__field">
                <span className="native-dv-metadata__label">{label} <span className="native-dv-metadata__required">*</span></span>
                <Input.TextArea
                    className="native-dv-metadata__textarea"
                    value={value}
                    placeholder="One value per line"
                    onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                        setValue(event.target.value);
                        this.refresh();
                    }}
                />
            </label>
        );
    }

    protected lines(value: string): string[] {
        return Array.from(new Set(value.split(/\r?\n/).map(line => line.trim()).filter(line => !!line)));
    }

    protected refresh(): void {
        this.render();
        this.update();
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.render();
    }

    protected onBeforeDetach(msg: Message): void {
        if (this.reactRoot) {
            this.reactRoot.unmount();
            this.reactRoot = undefined;
        }
        super.onBeforeDetach(msg);
    }
}
