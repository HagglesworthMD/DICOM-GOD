/**
 * App component tests
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../app/App';

describe('App', () => {
    it('renders without crashing', () => {
        render(<App />);
        expect(screen.getByText('DICOM God')).toBeInTheDocument();
    });

    it('renders the study browser', () => {
        render(<App />);
        expect(screen.getByText('Studies')).toBeInTheDocument();
    });

    it('renders the viewport placeholder', () => {
        render(<App />);
        expect(screen.getByText('Viewport 1')).toBeInTheDocument();
    });

    it('shows Open Folder button', () => {
        render(<App />);
        expect(screen.getByText('Open Folder')).toBeInTheDocument();
    });

    it('shows Local Mode toggle', () => {
        render(<App />);
        expect(screen.getByText('Local Mode')).toBeInTheDocument();
    });
});
