"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const env_1 = require("../../src/config/env");
(0, node_test_1.default)('FOUND-002: deve falhar quando env obrigatória está ausente', () => {
    strict_1.default.throws(() => (0, env_1.loadEnv)({
        NODE_ENV: 'development'
    }), /Missing required environment variables: POLYMARKET_CLOB_HOST/);
});
(0, node_test_1.default)('FOUND-002: deve retornar env validada quando obrigatórias existem', () => {
    const env = (0, env_1.loadEnv)({
        NODE_ENV: 'development',
        PORT: '3000',
        POLYMARKET_CLOB_HOST: 'https://clob.polymarket.com',
        POLYMARKET_GAMMA_HOST: 'https://gamma-api.polymarket.com'
    });
    strict_1.default.equal(env.NODE_ENV, 'development');
    strict_1.default.equal(env.PORT, 3000);
    strict_1.default.equal(env.POLYMARKET_CLOB_HOST, 'https://clob.polymarket.com');
});
