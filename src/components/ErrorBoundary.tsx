import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  viewName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in view component:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          id="error-boundary-card"
          className="my-6 p-8 bg-slate-900/80 border border-rose-500/30 rounded-2xl text-center max-w-xl mx-auto shadow-2xl backdrop-blur-sm"
        >
          <div className="w-12 h-12 mx-auto rounded-full bg-rose-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 mb-4">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">
            Something went wrong in {this.props.viewName || 'this view'}
          </h3>
          <p className="text-xs text-slate-400 mb-6 leading-relaxed">
            {this.state.error?.message ||
              'An unexpected rendering error occurred. You can safely reload this module without losing your database observations.'}
          </p>
          <button
            id="error-boundary-reload-btn"
            onClick={this.handleReset}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition shadow-lg shadow-emerald-600/30"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reload this view</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
