module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'test', 'chore', 'docs']
    ],
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case']],
  },
};