use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct Metrics {
    inner: Arc<MetricsInner>,
}

struct MetricsInner {
    http_requests_total: RwLock<HashMap<String, AtomicU64>>,
    http_request_duration_sum: RwLock<HashMap<String, AtomicU64>>,
    http_request_duration_count: RwLock<HashMap<String, AtomicU64>>,
    start_time: Instant,
}

impl Metrics {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(MetricsInner {
                http_requests_total: RwLock::new(HashMap::new()),
                http_request_duration_sum: RwLock::new(HashMap::new()),
                http_request_duration_count: RwLock::new(HashMap::new()),
                start_time: Instant::now(),
            }),
        }
    }

    pub fn uptime_seconds(&self) -> u64 {
        self.inner.start_time.elapsed().as_secs()
    }

    pub async fn record_request(&self, method: &str, path: &str, status: u16, duration_ms: u64) {
        let key = format!("{}:{}:{}", method, normalize_path(path), status);

        {
            let totals = self.inner.http_requests_total.read().await;
            if let Some(counter) = totals.get(&key) {
                counter.fetch_add(1, Ordering::Relaxed);
                drop(totals);
            } else {
                drop(totals);
                let mut totals = self.inner.http_requests_total.write().await;
                totals
                    .entry(key.clone())
                    .or_insert_with(|| AtomicU64::new(0))
                    .fetch_add(1, Ordering::Relaxed);
            }
        }

        {
            let sums = self.inner.http_request_duration_sum.read().await;
            if let Some(sum) = sums.get(&key) {
                sum.fetch_add(duration_ms, Ordering::Relaxed);
                drop(sums);
            } else {
                drop(sums);
                let mut sums = self.inner.http_request_duration_sum.write().await;
                sums.entry(key.clone())
                    .or_insert_with(|| AtomicU64::new(0))
                    .fetch_add(duration_ms, Ordering::Relaxed);
            }
        }

        {
            let counts = self.inner.http_request_duration_count.read().await;
            if let Some(count) = counts.get(&key) {
                count.fetch_add(1, Ordering::Relaxed);
                drop(counts);
            } else {
                drop(counts);
                let mut counts = self.inner.http_request_duration_count.write().await;
                counts
                    .entry(key)
                    .or_insert_with(|| AtomicU64::new(0))
                    .fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    pub async fn render_prometheus(&self, state: &crate::AppState) -> String {
        let mut out = String::new();

        out.push_str("# HELP streamlate_uptime_seconds Time since server start\n");
        out.push_str("# TYPE streamlate_uptime_seconds gauge\n");
        out.push_str(&format!(
            "streamlate_uptime_seconds {}\n",
            self.inner.start_time.elapsed().as_secs()
        ));

        let (active_sessions, connected_abcs, active_listeners) =
            self.get_session_stats(state).await;

        out.push_str("# HELP streamlate_active_sessions Number of active sessions\n");
        out.push_str("# TYPE streamlate_active_sessions gauge\n");
        out.push_str(&format!("streamlate_active_sessions {}\n", active_sessions));

        out.push_str("# HELP streamlate_connected_abcs Number of connected ABCs\n");
        out.push_str("# TYPE streamlate_connected_abcs gauge\n");
        out.push_str(&format!("streamlate_connected_abcs {}\n", connected_abcs));

        out.push_str("# HELP streamlate_active_listeners Number of active listeners\n");
        out.push_str("# TYPE streamlate_active_listeners gauge\n");
        out.push_str(&format!("streamlate_active_listeners {}\n", active_listeners));

        out.push_str(
            "# HELP streamlate_http_requests_total Total HTTP requests by method, path, status\n",
        );
        out.push_str("# TYPE streamlate_http_requests_total counter\n");
        {
            let totals = self.inner.http_requests_total.read().await;
            for (key, count) in totals.iter() {
                let parts: Vec<&str> = key.splitn(3, ':').collect();
                if parts.len() == 3 {
                    out.push_str(&format!(
                        "streamlate_http_requests_total{{method=\"{}\",path=\"{}\",status=\"{}\"}} {}\n",
                        parts[0], parts[1], parts[2],
                        count.load(Ordering::Relaxed)
                    ));
                }
            }
        }

        out.push_str("# HELP streamlate_http_request_duration_milliseconds_sum Sum of request durations\n");
        out.push_str("# TYPE streamlate_http_request_duration_milliseconds_sum counter\n");
        {
            let sums = self.inner.http_request_duration_sum.read().await;
            for (key, sum) in sums.iter() {
                let parts: Vec<&str> = key.splitn(3, ':').collect();
                if parts.len() == 3 {
                    out.push_str(&format!(
                        "streamlate_http_request_duration_milliseconds_sum{{method=\"{}\",path=\"{}\",status=\"{}\"}} {}\n",
                        parts[0], parts[1], parts[2],
                        sum.load(Ordering::Relaxed)
                    ));
                }
            }
        }

        out.push_str("# HELP streamlate_http_request_duration_milliseconds_count Count of request durations\n");
        out.push_str("# TYPE streamlate_http_request_duration_milliseconds_count counter\n");
        {
            let counts = self.inner.http_request_duration_count.read().await;
            for (key, count) in counts.iter() {
                let parts: Vec<&str> = key.splitn(3, ':').collect();
                if parts.len() == 3 {
                    out.push_str(&format!(
                        "streamlate_http_request_duration_milliseconds_count{{method=\"{}\",path=\"{}\",status=\"{}\"}} {}\n",
                        parts[0], parts[1], parts[2],
                        count.load(Ordering::Relaxed)
                    ));
                }
            }
        }

        if let Ok(conn) = state.db.conn() {
            if let Ok(recording_size) = conn.query_row(
                "SELECT COALESCE(SUM(size_bytes), 0) FROM recordings",
                [],
                |row| row.get::<_, i64>(0),
            ) {
                out.push_str(
                    "# HELP streamlate_recording_disk_bytes Total recording disk usage\n",
                );
                out.push_str("# TYPE streamlate_recording_disk_bytes gauge\n");
                out.push_str(&format!(
                    "streamlate_recording_disk_bytes {}\n",
                    recording_size
                ));
            }
        }

        out
    }

    async fn get_session_stats(&self, state: &crate::AppState) -> (i64, i64, i64) {
        if let Ok(conn) = state.db.conn() {
            let active_sessions: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sessions WHERE state IN ('starting', 'active', 'paused', 'passthrough')",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            let connected_abcs: i64 = conn
                .query_row("SELECT COUNT(*) FROM abcs", [], |row| row.get(0))
                .unwrap_or(0);

            (active_sessions, connected_abcs, 0)
        } else {
            (0, 0, 0)
        }
    }
}

fn normalize_path(path: &str) -> String {
    let segments: Vec<&str> = path.split('/').collect();
    let normalized: Vec<&str> = segments
        .iter()
        .enumerate()
        .map(|(i, seg)| {
            if i > 0 && looks_like_id(seg) {
                ":id"
            } else {
                seg
            }
        })
        .collect();
    normalized.join("/")
}

fn looks_like_id(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    if s.len() == 36 && s.chars().filter(|c| *c == '-').count() == 4 {
        return true;
    }
    false
}

pub async fn metrics_middleware(
    State(state): State<crate::AppState>,
    req: Request,
    next: Next,
) -> Response {
    let method = req.method().to_string();
    let path = req.uri().path().to_string();
    let start = Instant::now();

    let request_id = uuid::Uuid::new_v4().to_string();

    tracing::info!(
        request_id = %request_id,
        method = %method,
        path = %path,
        "Request started"
    );

    let response = next.run(req).await;

    let duration = start.elapsed();
    let status = response.status().as_u16();

    tracing::info!(
        request_id = %request_id,
        method = %method,
        path = %path,
        status = %status,
        duration_ms = %duration.as_millis(),
        "Request completed"
    );

    state
        .metrics
        .record_request(&method, &path, status, duration.as_millis() as u64)
        .await;

    response
}

pub async fn metrics_endpoint(
    State(state): State<crate::AppState>,
) -> impl IntoResponse {
    let body = state.metrics.render_prometheus(&state).await;
    (
        [(http::header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")],
        body,
    )
}
