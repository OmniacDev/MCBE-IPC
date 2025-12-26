type EventCallback<T> = (args: T) => void

export class EventSignal<T> {
  private readonly callbacks: EventCallback<T>[] = []

  subscribe(callback: EventCallback<T>): EventCallback<T> {
    this.callbacks.push(callback)
    return callback
  }

  unsubscribe(callback: EventCallback<T>): void {
    const i = this.callbacks.indexOf(callback)
    if (i !== -1) this.callbacks.splice(i, 1)
  }

  emit(args: T): T {
    [...this.callbacks].forEach(c => c(args))
    return args
  }
}