declare module 'gltf-validator' {
  interface ValidationReport {
    issues: { numErrors: number; numWarnings: number; messages: unknown[] };
  }
  const validator: {
    validateBytes(data: Uint8Array, options?: Record<string, unknown>): Promise<ValidationReport>;
  };
  export default validator;
}
