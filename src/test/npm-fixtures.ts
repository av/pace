export function makePackageResult(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    package: {
      name: "test-package",
      version: "1.2.3",
      description: "A test package for testing",
      date: "2025-01-15T10:00:00Z",
      links: {
        npm: "https://www.npmjs.com/package/test-package",
        homepage: "https://test-package.dev",
        repository: "https://github.com/test/test-package",
      },
      publisher: { username: "testauthor" },
      keywords: ["testing", "utility"],
      ...(overrides.package as object | undefined),
    },
    score: {
      final: 0.75,
      detail: {
        quality: 0.8,
        popularity: 0.6,
        maintenance: 0.9,
        ...(overrides.detail as object | undefined),
      },
      ...(overrides.score as object | undefined),
    },
  };
}

export function makeSearchResponse(objects: Record<string, unknown>[]) {
  return { objects, total: objects.length };
}