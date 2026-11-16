// Keep runtime helpers inside the plugin directory so imported plugins remain standalone.
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
