import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('OPTRANE UI error', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="fatal"><span className="eyebrow">RECOVERABLE UI ERROR</span><h1>OPTRANE hit a desktop error.</h1><p>{this.state.error.message}</p><button className="primary" onClick={() => window.location.reload()}>Reload control room</button></main>;
  }
}
