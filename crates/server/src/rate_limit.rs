use dashmap::DashMap;
use std::time::Instant;

pub struct RateLimiter {
    buckets: DashMap<String, TokenBucket>,
}

struct TokenBucket {
    tokens: f64,
    max_tokens: f64,
    refill_rate: f64,
    last_refill: Instant,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            buckets: DashMap::new(),
        }
    }

    pub fn check_rate_limit(&self, key: &str, max_requests: u32, window_seconds: u64) -> bool {
        let max = max_requests as f64;
        let rate = max / window_seconds as f64;

        let mut entry = self.buckets.entry(key.to_string()).or_insert_with(|| {
            TokenBucket {
                tokens: max,
                max_tokens: max,
                refill_rate: rate,
                last_refill: Instant::now(),
            }
        });

        let bucket = entry.value_mut();
        let now = Instant::now();
        let elapsed = now.duration_since(bucket.last_refill).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * bucket.refill_rate).min(bucket.max_tokens);
        bucket.last_refill = now;

        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    pub fn cleanup_old_entries(&self) {
        let now = Instant::now();
        self.buckets.retain(|_, bucket| {
            now.duration_since(bucket.last_refill).as_secs() < 300
        });
    }
}
