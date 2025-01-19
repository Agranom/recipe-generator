/* eslint-disable */
const tsPreset = require('ts-jest/jest-preset');
require('dotenv').config({
  path: '.env.test',
});

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  ...tsPreset,
  setupFiles: ['./check-env.js', 'dotenv/config'],
  testEnvironment: 'node',
  watchPathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/node_modules/', 'globalConfig'],
};
