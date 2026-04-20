export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export function httpError(status: number, message: string): HttpError {
  return new HttpError(status, message)
}
