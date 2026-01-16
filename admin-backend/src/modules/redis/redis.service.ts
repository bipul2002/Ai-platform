import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private redis: Redis;

    constructor(private configService: ConfigService) { }

    onModuleInit() {
        const redisUrl = this.configService.get<string>('REDIS_URL');
        if (redisUrl) {
            this.redis = new Redis(redisUrl);
            console.log('Redis connected successfully');
        } else {
            console.warn('REDIS_URL not found, cache invalidation will be disabled');
        }
    }

    onModuleDestroy() {
        if (this.redis) {
            this.redis.disconnect();
        }
    }

    async get(key: string): Promise<string | null> {
        if (!this.redis) return null;
        return this.redis.get(key);
    }

    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
        if (!this.redis) return;
        if (ttlSeconds) {
            await this.redis.set(key, value, 'EX', ttlSeconds);
        } else {
            await this.redis.set(key, value);
        }
    }

    async del(key: string): Promise<void> {
        if (!this.redis) return;
        await this.redis.del(key);
    }

    async delPattern(pattern: string): Promise<void> {
        if (!this.redis) return;

        // Scan for keys matching pattern (safe for production vs keys)
        const stream = this.redis.scanStream({
            match: pattern,
            count: 100
        });

        for await (const keys of stream) {
            if (keys.length > 0) {
                await this.redis.del(...keys);
            }
        }
    }

    getClient(): Redis {
        return this.redis;
    }
}
