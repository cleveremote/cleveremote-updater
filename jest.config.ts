/* eslint-disable @typescript-eslint/no-var-requires */
const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig');

module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    verbose: true,
    collectCoverage: true,
    moduleFileExtensions: ['js', 'json', 'ts'],
    collectCoverageFrom: [
        'src/common/**/*.ts',
        'src/modules/**/*.ts',
        '!src/modules/**/*.module.ts'
    ],
    coverageReporters: ['text-summary', 'html', 'lcov', 'cobertura'],
    rootDir: '',
    testMatch: ['**/__tests__/**/*.+(ts|tsx|js)', '**/?(*.)+(spec|test).+(ts|tsx|js)'],
    testPathIgnorePatterns: ['/node_modules/'],
    coverageDirectory: './coverage',
    transform: { '^.+\\.(ts|tsx)$': ['ts-jest', { isolatedModules: true }] },
    reporters: ['default', 'jest-junit'],
    moduleNameMapper: {
        '^src/(.*)$': '<rootDir>/src/$1',
        ...pathsToModuleNameMapper(compilerOptions.paths, { prefix: '<rootDir>/' })
    }
};
