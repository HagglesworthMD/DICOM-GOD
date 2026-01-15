/**
 * Error Boundary component - catches React errors and shows toast
 */

import { Component, type ReactNode } from 'react';
import { createLogger } from '../core/logger';

const log = createLogger('ErrorBoundary');

interface Props {
    children: ReactNode;
    onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
        log.error('Uncaught error:', error, errorInfo);
        this.props.onError?.(error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="error-boundary-fallback">
                    <h2>Something went wrong</h2>
                    <p>{this.state.error?.message ?? 'Unknown error'}</p>
                    <pre>{this.state.error?.stack}</pre>
                    <button onClick={() => this.setState({ hasError: false, error: null })}>
                        Try again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
