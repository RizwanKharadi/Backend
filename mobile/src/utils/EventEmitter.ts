type Listener = (...args: unknown[]) => void;

/**
 * Minimal EventEmitter for React Native (Node's `events` module is not available in Metro).
 */
export class EventEmitter {
  private listeners = new Map<string, Set<Listener>>();

  on(event: string, listener: Listener): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return this;
  }

  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string, ...args: unknown[]): boolean {
    const set = this.listeners.get(event);
    if (!set?.size) {
      return false;
    }
    for (const listener of [...set]) {
      listener(...args);
    }
    return true;
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }
}
