/**
 * DropZone tests
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DropZone } from '../components/DropZone';

describe('DropZone', () => {
    it('renders children', () => {
        const { getByText } = render(
            <DropZone onFiles={() => { }}>
                <div>Test Content</div>
            </DropZone>
        );
        expect(getByText('Test Content')).toBeInTheDocument();
    });

    it('calls onFiles with dropped files', async () => {
        const onFiles = vi.fn();
        const { container } = render(
            <DropZone onFiles={onFiles}>
                <div>Drop here</div>
            </DropZone>
        );

        const dropzone = container.querySelector('.dropzone')!;

        // Create a mock file
        const file = new File(['test content'], 'test.dcm', { type: 'application/dicom' });

        // Create mock DataTransfer
        const dataTransfer = {
            items: [
                {
                    kind: 'file',
                    getAsFile: () => file,
                },
            ],
        };

        // Fire drop event
        fireEvent.drop(dropzone, { dataTransfer });

        // Wait for async processing
        await new Promise((r) => setTimeout(r, 50));

        expect(onFiles).toHaveBeenCalled();
        const calledFiles = onFiles.mock.calls[0][0];
        expect(calledFiles).toHaveLength(1);
        expect(calledFiles[0].name).toBe('test.dcm');
    });

    it('does not fire when disabled', () => {
        const onFiles = vi.fn();
        const { container } = render(
            <DropZone onFiles={onFiles} disabled>
                <div>Drop here</div>
            </DropZone>
        );

        const dropzone = container.querySelector('.dropzone')!;
        expect(dropzone).toHaveClass('dropzone--disabled');
    });
});
