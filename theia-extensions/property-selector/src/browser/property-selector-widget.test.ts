// ******************************************************************************************
// Copyright (C) 2025-2026 SZTAKI, Department of Distributed Systems (https://dsd.sztaki.hu).
//
// SPDX-License-Identifier: Apache-2.0
// ******************************************************************************************

import { parseCsv, PropertySelectorWidget } from './property-selector-widget';
import 'reflect-metadata';
import { MessageService } from '@theia/core';
import { ContainerModule, Container } from '@theia/core/shared/inversify';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react';

describe('Schema CSV Parser Logic', () => {

    it('should parse a valid CSV string correctly', () => {
        const input = `label,comment
        Thing,The most generic type of item.
        Person,A living person.`;

        const result = parseCsv(input);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ label: 'Thing', comment: 'The most generic type of item.' });
        expect(result[1]).toEqual({ label: 'Person', comment: 'A living person.' });
    });

    it('should handle quoted CSV values', () => {
        const input = `label,comment
        "CreativeWork","The most generic kind of creative work, including books, movies, etc."`;

        const result = parseCsv(input);

        expect(result[0].label).toBe('CreativeWork');
        expect(result[0].comment).toBe('The most generic kind of creative work, including books, movies, etc.');
    });

    it('should preserve escaped quotes, commas, and line breaks inside quoted CSV values', () => {
        const input = 'label,comment\r\n"CreativeWork","A ""quoted"", multi-line\ncomment"';

        expect(parseCsv(input)).toEqual([{
            label: 'CreativeWork',
            comment: 'A "quoted", multi-line\ncomment',
        }]);
    });

    it('should reject an unterminated quoted CSV value', () => {
        expect(parseCsv('label,comment\nPerson,"unfinished')).toEqual([]);
    });

    it('should return empty array for empty input', () => {
        expect(parseCsv('')).toEqual([]);
    });

    it('should return empty array if required headers are missing', () => {
        const input = `id,name
        1,John`;
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            expect(parseCsv(input)).toEqual([]);
            expect(consoleError).toHaveBeenCalledWith('CSV missing required headers. Found: [id, name]');
        } finally {
            consoleError.mockRestore();
        }
    });
});

describe('SchemaSelectorWidget', () => {

    let widget: PropertySelectorWidget;
    const originalFetch = global.fetch;

    const MOCK_CSV_RESPONSE = `label,comment
    Person,A human being.
    Event,An event happening at a certain time.
    Place,Entities that have a somewhat fixed, physical extension.`;

    beforeEach(async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                text: () => Promise.resolve(MOCK_CSV_RESPONSE),
            })
        ) as jest.Mock;

        const module = new ContainerModule(bind => {
            bind(MessageService).toConstantValue({
                info: jest.fn()
            } as any);
            bind(PropertySelectorWidget).toSelf();
        });

        const container = new Container();
        container.load(module);

        await act(async () => {
            widget = container.resolve<PropertySelectorWidget>(PropertySelectorWidget);
            // The tests render the widget output directly, so host-level Lumino updates
            // are a mocked boundary. Flush the async fetch before leaving act().
            (widget as any).update = jest.fn();
            await Promise.resolve();
            await Promise.resolve();
        });
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.restoreAllMocks();
    });

    it('should call fetch on initialization', () => {
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should open modal and display fetched data when button is clicked', async () => {
        const { getByText, rerender } = render(widget.render());

        const openBtn = getByText('Add new property');
        fireEvent.click(openBtn);

        rerender(widget.render());

        expect(getByText('Schema.org Properties List')).toBeTruthy();

        await waitFor(() => {
            expect(getByText('Person')).toBeTruthy();
            expect(getByText('A human being.')).toBeTruthy();
        });
    });

    it('should filter properties inside the modal', async () => {
        const { getByText, getByPlaceholderText, queryByText, rerender } = render(widget.render());

        fireEvent.click(getByText('Add new property'));
        rerender(widget.render()); // Update view

        await waitFor(() => expect(getByText('Person')).toBeTruthy());

        const searchInput = getByPlaceholderText('Search properties...');
        fireEvent.change(searchInput, { target: { value: 'Event' } });

        expect(getByText('Event')).toBeTruthy();

        expect(queryByText('Person')).toBeNull();
    });

    it('should close the modal when Close is clicked', async () => {
        const { getByText, queryByText, rerender } = render(widget.render());

        fireEvent.click(getByText('Add new property'));
        rerender(widget.render());

        expect(getByText('Schema.org Properties List')).toBeTruthy();

        const closeBtn = getByText('Close');
        fireEvent.click(closeBtn);

        rerender(widget.render());

        expect(queryByText('Schema.org Properties List')).toBeNull();
    });

    it('should show a fetch failure when the modal is opened', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        (global.fetch as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error('offline')));

        await act(async () => {
            await (widget as any).fetchSchemaProperties();
        });
        const { getByText, rerender } = render(widget.render());
        fireEvent.click(getByText('Add new property'));
        rerender(widget.render());

        expect(getByText('Error: Failed to fetch or parse properties: offline')).toBeTruthy();
        errorSpy.mockRestore();
    });

    it('should retain the newest result when overlapping fetches finish out of order', async () => {
        let resolveSlowResponse: (response: { ok: boolean; text: () => Promise<string> }) => void;
        const slowResponse = new Promise<{ ok: boolean; text: () => Promise<string> }>(resolve => {
            resolveSlowResponse = resolve;
        });
        (global.fetch as jest.Mock)
            .mockImplementationOnce(() => slowResponse)
            .mockImplementationOnce(() => Promise.resolve({
                ok: true,
                text: () => Promise.resolve('label,comment\nNew,The latest result'),
            }));

        const slowFetch = (widget as any).fetchSchemaProperties();
        await (widget as any).fetchSchemaProperties();
        resolveSlowResponse!({
            ok: true,
            text: () => Promise.resolve('label,comment\nOld,The stale result'),
        });
        await slowFetch;

        const { getByText, queryByText, rerender } = render(widget.render());
        fireEvent.click(getByText('Add new property'));
        rerender(widget.render());
        expect(getByText('New')).toBeTruthy();
        expect(queryByText('Old')).toBeNull();
    });
});
