/**
 * Problem the bundler found in a file of the knowledge base.
 */
export interface Problem {
  readonly path: string;
  readonly line?: number;
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

/**
 * Returns whether any problem is an error.
 */
export const hasErrors = (problems: readonly Problem[]): boolean =>
  problems.some((problem) => problem.severity === 'error');

/**
 * Formats problems for a terminal, grouped by file.
 */
export const formatProblems = (problems: readonly Problem[]): string => {
  const byPath = Map.groupBy(problems, (problem) => problem.path);
  return [...byPath]
    .map(([path, fileProblems]) => {
      const lines = fileProblems.map((problem) => {
        const location = problem.line === undefined ? '' : `line ${problem.line}: `;
        return `  ${problem.severity.padEnd(7)}  ${location}${problem.message}`;
      });
      return [path, ...lines].join('\n');
    })
    .join('\n\n');
};

/**
 * Collector of problems that ignores duplicates.
 */
export class ProblemCollector {
  readonly #problems = new Map<string, Problem>();

  get problems(): readonly Problem[] {
    return [...this.#problems.values()];
  }

  add(problem: Problem): void {
    const key = JSON.stringify([problem.path, problem.line, problem.severity, problem.message]);
    if (!this.#problems.has(key)) this.#problems.set(key, problem);
  }

  hasErrorsIn(path: string): boolean {
    return this.problems.some((problem) => problem.path === path && problem.severity === 'error');
  }
}
