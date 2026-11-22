export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'refactor',
        'test',
        'docs',
        'chore',
        'ci',
        'build',
        'perf',
        'security',
        'revert',
      ],
    ],
    'header-max-length': [2, 'always', 72],
  },
};
