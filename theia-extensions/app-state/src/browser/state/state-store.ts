import { Emitter, type Event } from '@theia/core/lib/common'

export interface StateChange<S> {
  readonly previous: S
  readonly current: S
}

/**
 * Simple generic state holder using Theia's Emitter/Event for change notification.
 */
export class SimpleStateStore<S> {
  private state: S
  private readonly onDidChangeStateEmitter = new Emitter<StateChange<S>>()
  readonly onDidChangeState: Event<StateChange<S>> = this.onDidChangeStateEmitter.event

  constructor(initial: S) {
    this.state = Object.freeze({ ...initial })
  }

  getState(): Readonly<S> {
    return this.state
  }

  /** Replace the whole state. */
  setState(next: S): void {
    const previous = this.state
    this.state = Object.freeze({ ...next })
    this.onDidChangeStateEmitter.fire({ previous, current: this.state })
  }

  /** Partial / reducer-style update. */
  updateState(partial: Partial<S> | ((prev: S) => Partial<S>)): void {
    const previous = this.state
    const patch = typeof partial === 'function' ? partial(previous) : partial
    const current = Object.freeze({ ...previous, ...patch })
    this.state = current
    this.onDidChangeStateEmitter.fire({ previous, current })
  }

  /**
   * Subscribe to a derived slice of state.
   * The selector is applied on every state change; the event only fires when the
   * derived value actually changes (based on the equals function).
   */
  onDidChangeSelector<R>(
    selector: (state: S) => R,
    equals: (a: R, b: R) => boolean = Object.is,
  ): Event<R> {
    const emitter = new Emitter<R>()

    let last = selector(this.state)
    const disposable = this.onDidChangeState(({ current }) => {
      const next = selector(current)
      if (!equals(last, next)) {
        last = next
        emitter.fire(next)
      }
    })

    const originalDispose = emitter.dispose.bind(emitter)
    emitter.dispose = () => {
      disposable.dispose()
      originalDispose()
    }

    return (listener, thisArgs, disposables) => {
      const eventDisposable = emitter.event(listener, thisArgs, disposables)
      listener.call(thisArgs, last)
      return eventDisposable
    }
  }
}
