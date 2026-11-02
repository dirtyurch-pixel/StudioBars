/** A failed API call. `network` is true when the server could not be reached at all. */
export class ApiFail extends Error {
  status: number
  code: string
  network: boolean
  lineIds: string[]
  currentVersion?: number
  constructor(
    message: string,
    opts: {
      status?: number
      code?: string
      network?: boolean
      lineIds?: string[]
      currentVersion?: number
    } = {},
  ) {
    super(message)
    this.status = opts.status ?? 0
    this.code = opts.code ?? 'ERROR'
    this.network = opts.network ?? false
    this.lineIds = opts.lineIds ?? []
    this.currentVersion = opts.currentVersion
  }
}
