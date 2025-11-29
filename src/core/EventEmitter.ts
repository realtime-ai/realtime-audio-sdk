import type { EventListener } from '../types';

 /**
  * Simple EventEmitter implementation
  */
export class EventEmitter<Events> {
  private listeners: Map<keyof Events, Set<(payload: unknown) => void>> = new Map();

  private getHandlerSet<K extends keyof Events>(event: K): Set<(payload: unknown) => void> {
    const existing = this.listeners.get(event);
    if (existing) return existing;
    const created = new Set<(payload: unknown) => void>();
    this.listeners.set(event, created);
    return created;
  }

  private getHandlers<K extends keyof Events>(event: K): Set<(payload: unknown) => void> | undefined {
    return this.listeners.get(event);
  }

  /**
   * Add an event listener
   */
  on<K extends keyof Events>(event: K, listener: Events[K] extends (arg: infer P) => void ? (arg: P) => void : never): void {
    const handlers = this.getHandlerSet(event);
    handlers.add(listener as EventListener);
  }

  /**
   * Remove an event listener
   */
  off<K extends keyof Events>(event: K, listener: Events[K] extends (arg: infer P) => void ? (arg: P) => void : never): void {
    const eventListeners = this.getHandlers(event);
    if (eventListeners) {
      eventListeners.delete(listener as EventListener);
    }
  }

  /**
   * Add a one-time event listener
   */
  once<K extends keyof Events>(event: K, listener: Events[K] extends (arg: infer P) => void ? (arg: P) => void : never): void {
    const onceWrapper = (data: unknown) => {
      (listener as EventListener)(data as never);
      this.off(event, onceWrapper as typeof listener);
    };
    this.on(event, onceWrapper as typeof listener);
  }

  /**
   * Emit an event
   */
  protected emit<K extends keyof Events>(
    event: K,
    data: Events[K] extends (arg: infer P) => void ? P : never
  ): void {
    const eventListeners = this.getHandlers(event);
    if (eventListeners) {
      eventListeners.forEach((listener) => {
        try {
          listener(data as unknown);
        } catch (error) {
          console.error(`Error in event listener for "${String(event)}":`, error);
        }
      });
    }
  }

  /**
   * Remove all listeners for an event or all events
   */
  removeAllListeners<K extends keyof Events>(event?: K): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /**
   * Get listener count for an event
   */
  listenerCount<K extends keyof Events>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
