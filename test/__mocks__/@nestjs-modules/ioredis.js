/**
 * Manual mock for @nestjs-modules/ioredis.
 * Provides the InjectRedis decorator as a no-op for unit tests.
 */
const InjectRedis = () => (_target, _key, _index) => undefined;

module.exports = { InjectRedis };
