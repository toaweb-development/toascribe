// Mirrors the types in GIT_STANDARD_2026
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'chore', 'docs', 'refactor', 'style', 'perf', 'test', 'ci', 'revert']],
  },
}
